import hashlib
import os
from pathlib import Path
import pickle
import random
import tempfile
from types import SimpleNamespace
import unittest
from multiprocessing import Value

import torch

from library.anima_text_variants import cache_variants, deterministic_caption, fingerprint
from library.strategy_anima import AnimaTextEncoderOutputsCachingStrategy, AnimaTextEncodingStrategy
from library import strategy_base
from library.train_util import DatasetGroup, set_current_epoch_for_dataloader
from tests.test_epoch_sample_rate import make_dataset, bucket_entries, first_example


class Tokenizer:
    qwen3_max_length = t5_max_length = 8

    def tokenize(self, text):
        texts = [text] if isinstance(text, str) else text
        ids = torch.tensor([[int(hashlib.sha256(t.encode()).hexdigest()[:6], 16) % 100] * 8 for t in texts])
        masks = torch.ones_like(ids)
        return [ids, masks, ids.clone(), masks.clone()]


class Encoder(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.anchor = torch.nn.Parameter(torch.zeros(()))
        self.calls = 0

    def forward(self, input_ids, attention_mask):
        self.calls += 1
        return SimpleNamespace(last_hidden_state=input_ids.float().unsqueeze(-1))


class VariantTests(unittest.TestCase):
    def setUp(self):
        self.saved_strategies = [(cls, cls.get_strategy()) for cls in (
            strategy_base.TokenizeStrategy, strategy_base.TextEncodingStrategy,
            strategy_base.TextEncoderOutputsCachingStrategy)]

    def tearDown(self):
        # Strategies are singleton class attributes, including None before setup.
        for cls, saved in self.saved_strategies:
            cls._strategy = saved

    def prepare(self, directory, sample_rate=1):
        dataset = make_dataset(directory, count=3, num_repeats=2, batch_size=2, epoch_sample_rate=sample_rate)
        dataset.subsets[0].shuffle_caption = True
        dataset.subsets[0].keep_tokens = 1
        for info in dataset.image_data.values():
            info.caption = 'subject, blue hair, dress, standing, smile, boots\nA person beside a tree.'
        dataset.set_current_epoch(1)
        tokenizer = Tokenizer()
        strategy = AnimaTextEncoderOutputsCachingStrategy(True, 2, False)
        encoder = Encoder()
        encoding = AnimaTextEncodingStrategy()
        dataset.tokenize_strategy = tokenizer
        dataset.text_encoder_output_caching_strategy = strategy
        model_file = Path(directory) / 'encoder.bin'
        model_file.write_bytes(b'test model identity')
        args = SimpleNamespace(qwen3_path=str(model_file), seed=1234, max_train_epochs=3,
                               gradient_accumulation_steps=1, caption_dropout_rate=0)
        group = SimpleNamespace(datasets=[dataset])
        accelerator = SimpleNamespace(num_processes=1, process_index=0, wait_for_everyone=lambda: None)
        return dataset, tokenizer, strategy, encoder, encoding, args, group, accelerator

    def test_every_use_has_its_own_cache_and_runtime_reads_without_encoding(self):
        with tempfile.TemporaryDirectory() as directory:
            dataset, tokenizer, strategy, encoder, encoding, args, group, accelerator = self.prepare(directory)
            rng = random.getstate()
            cache_variants(group, [encoder], accelerator, args, tokenizer, encoding, strategy)
            self.assertEqual(random.getstate(), rng)
            self.assertEqual(dataset.current_epoch, 1)
            self.assertEqual(len(list(Path(directory).rglob('e*_r*.safetensors'))), 3 * 3 * 2)
            pickle.loads(pickle.dumps(dataset._anima_variant_cache))
            calls = encoder.calls
            for epoch in (1, 2, 3):
                dataset.set_current_epoch(epoch)
                for i in range(len(dataset)):
                    example = dataset[i]
                    self.assertIsNotNone(example['text_encoder_outputs_list'])
                    self.assertTrue(all(ids is None for ids in (example['input_ids_list'] or [])))
                    entry = dataset.buckets_indices[i]
                    bucket = dataset.bucket_manager.buckets[entry.bucket_index]
                    start = entry.batch_index * entry.bucket_batch_size
                    counts = {key: bucket[:start].count(key) for key in bucket}
                    for j, key in enumerate(bucket[start:start + entry.bucket_batch_size]):
                        expected_caption = deterministic_caption(dataset, dataset.image_to_subset[key],
                            dataset.image_data[key].caption, args.seed, epoch, counts[key], key)
                        expected = tokenizer.tokenize(expected_caption)[0][0].float()
                        actual = example['text_encoder_outputs_list'][0][j, :, 0]
                        self.assertTrue(torch.equal(expected, actual), f'wrong variant for epoch={epoch} repeat={counts[key]}')
                        counts[key] += 1
            self.assertEqual(encoder.calls, calls)
            # Resume/restart reuses the same paths and never calls the encoder again.
            cache_variants(group, [encoder], accelerator, args, tokenizer, encoding, strategy)
            self.assertEqual(encoder.calls, calls)

    def test_epoch_sampling_caches_only_selected_uses_and_handles_persistent_epoch_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            dataset, tokenizer, strategy, encoder, encoding, args, group, accelerator = self.prepare(directory, 0.5)
            cache_variants(group, [encoder], accelerator, args, tokenizer, encoding, strategy)
            expected = 0
            for epoch in (1, 2, 3):
                dataset.set_current_epoch(epoch)
                expected += len(bucket_entries(dataset))
                for i in range(len(dataset)):
                    self.assertIsNotNone(dataset[i]['text_encoder_outputs_list'])
            self.assertEqual(len(list(Path(directory).rglob('e*_r*.safetensors'))), expected)

    def test_caption_processing_is_seeded_protects_prefix_and_preserves_natural_language(self):
        with tempfile.TemporaryDirectory() as directory:
            dataset, _, _, _, _, _, _, _ = self.prepare(directory)
            key, info = next(iter(dataset.image_data.items()))
            subset = dataset.image_to_subset[key]
            values = [deterministic_caption(dataset, subset, info.caption, 1234, 1, n, key) for n in range(8)]
            self.assertGreater(len(set(values)), 1)
            self.assertTrue(all(v.startswith('subject,') and v.endswith('A person beside a tree.') for v in values))
            self.assertEqual(values[0], deterministic_caption(dataset, subset, info.caption, 1234, 1, 0, key))
            self.assertEqual(deterministic_caption(dataset, subset, info.caption, 1234, 1, 0, key, 1), '')

    def test_invalid_or_missing_variants_are_not_silently_reused(self):
        with tempfile.TemporaryDirectory() as directory:
            dataset, tokenizer, strategy, encoder, encoding, args, group, accelerator = self.prepare(directory)
            cache_variants(group, [encoder], accelerator, args, tokenizer, encoding, strategy)
            paths = sorted(Path(directory).rglob('e*_r*.safetensors'))
            paths[0].write_bytes(b'broken')
            calls = encoder.calls
            cache_variants(group, [encoder], accelerator, args, tokenizer, encoding, strategy)
            self.assertGreater(encoder.calls, calls)
            entry = dataset.buckets_indices[0]
            key = dataset.bucket_manager.buckets[entry.bucket_index][entry.batch_index * entry.bucket_batch_size]
            bucket = dataset.bucket_manager.buckets[entry.bucket_index]
            start = entry.batch_index * entry.bucket_batch_size
            occurrence = bucket[:start].count(key)
            os.unlink(dataset._anima_variant_cache.path_for(key, 1, occurrence))
            with self.assertRaisesRegex(FileNotFoundError, 'Missing per-use'):
                dataset[0]

    def test_caption_change_invalidates_cache_and_warmup_is_explicitly_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            dataset, tokenizer, strategy, encoder, encoding, args, group, accelerator = self.prepare(directory)
            cache_variants(group, [encoder], accelerator, args, tokenizer, encoding, strategy)
            old_roots = dataset._anima_variant_cache.roots.copy()
            key = next(iter(dataset.image_data))
            dataset.image_data[key].caption += ' Additional description.'
            cache_variants(group, [encoder], accelerator, args, tokenizer, encoding, strategy)
            self.assertNotEqual(old_roots[key], dataset._anima_variant_cache.roots[key])
            dataset.subsets[0].token_warmup_step = 1
            with self.assertRaisesRegex(ValueError, 'token_warmup_step'):
                cache_variants(group, [encoder], accelerator, args, tokenizer, encoding, strategy)

    def test_persistent_worker_selects_the_new_epoch_variants(self):
        with tempfile.TemporaryDirectory() as directory:
            dataset, tokenizer, strategy, encoder, encoding, args, _, accelerator = self.prepare(directory, 0.5)
            group = DatasetGroup([dataset])
            current_epoch = Value('i', 1)
            group.set_epoch_shared_value(current_epoch)
            cache_variants(group, [encoder], accelerator, args, tokenizer, encoding, strategy)
            loader = torch.utils.data.DataLoader(group, batch_size=1, num_workers=1,
                persistent_workers=True, collate_fn=first_example)
            try:
                for epoch in (1, 2, 3):
                    current_epoch.value = epoch
                    set_current_epoch_for_dataloader(loader, epoch)
                    expected = [group[i]['text_encoder_outputs_list'][0] for i in range(len(group))]
                    actual = [example['text_encoder_outputs_list'][0] for example in loader]
                    self.assertEqual(len(actual), len(expected))
                    self.assertTrue(all(torch.equal(a, b) for a, b in zip(actual, expected)))
            finally:
                if loader._iterator is not None:
                    loader._iterator._shutdown_workers()

    def test_trainer_accepts_variants_with_shuffle_and_preserves_subset_dropout(self):
        from anima_train_network import AnimaNetworkTrainer, setup_parser
        with tempfile.TemporaryDirectory() as directory:
            dataset, _, _, _, _, _, _, _ = self.prepare(directory)
            dataset.subsets[0].caption_dropout_rate = 0.25
            args = setup_parser().parse_args(['--cache_text_encoder_variants', '--network_train_unet_only'])
            group = DatasetGroup([dataset])
            trainer = AnimaNetworkTrainer()
            trainer.assert_extra_args(args, group, None)
            self.assertTrue(args.cache_text_encoder_outputs_to_disk)
            self.assertTrue(args.cache_text_encoder_outputs)
            self.assertTrue(dataset.subsets[0].shuffle_caption)
            self.assertEqual(dataset.subsets[0].caption_dropout_rate, 0.25)
            self.assertEqual(trainer.get_text_encoding_strategy(args).dropout_rate, 0)


if __name__ == '__main__':
    unittest.main()
