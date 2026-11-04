"""CPU regression tests for prompt dropout and training/sampling state isolation."""
from contextlib import nullcontext
import random
import tempfile
from types import SimpleNamespace
import unittest
import weakref
from unittest.mock import patch

import numpy as np
import torch

from library import anima_train_utils as sampling
from library.strategy_anima import AnimaTextEncodingStrategy


class Tokenizer:
    def tokenize(self, text):
        value = {'': 1, 'sample prompt': 9, 'negative prompt': 3}[text]
        ids = torch.full((1, 3), value, dtype=torch.long)
        mask = torch.ones_like(ids)
        return [ids, mask, ids.clone(), mask.clone()]


class Encoder(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.anchor = torch.nn.Parameter(torch.zeros(()))

    def forward(self, input_ids, attention_mask):
        return SimpleNamespace(last_hidden_state=input_ids.float().unsqueeze(-1))


class DIT(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.t_embedding_norm = torch.nn.Linear(1, 1)
        self.use_llm_adapter = False
        self.blocks_to_swap = 0


class VAE(Encoder):
    def decode(self, latents, scale):
        return torch.zeros(1, 3, 1, 8, 8)


class SamplingTests(unittest.TestCase):
    def test_prompt_tensors_are_released_before_vae_decode(self):
        references = []

        def generate(*values, **kwargs):
            references.extend([weakref.ref(values[4]), weakref.ref(values[9])])
            return torch.zeros(1, 16, 1, 8, 8)

        testcase = self

        class CheckingVAE(VAE):
            def decode(self, latents, scale):
                testcase.assertTrue(all(ref() is None for ref in references))
                return super().decode(latents, scale)

        with patch.object(sampling, 'do_sample', new=generate), patch.object(sampling, 'clean_memory_on_device'):
            sampling._sample_image_inference(
                SimpleNamespace(device=torch.device('cpu')), SimpleNamespace(discrete_flow_shift=1.0),
                DIT(), Encoder(), CheckingVAE(), [], Tokenizer(), AnimaTextEncodingStrategy(),
                '', {'prompt': 'sample prompt', 'negative_prompt': 'negative prompt', 'scale': 7.5},
                1, 20, None, None, save_image=False)

    def test_sampling_never_drops_uncached_positive_or_negative_conditions(self):
        tokenizer, encoder = Tokenizer(), Encoder()
        strategy = AnimaTextEncodingStrategy(dropout_rate=1.0)
        args = SimpleNamespace(discrete_flow_shift=1.0)
        accelerator = SimpleNamespace(device=torch.device('cpu'))
        for cache_prompt in (False, True):
            with self.subTest(cache_prompt=cache_prompt):
                cache = {}
                if cache_prompt:
                    cache['sample prompt'] = strategy.encode_tokens(
                        tokenizer, [encoder], tokenizer.tokenize('sample prompt'), enable_dropout=False)
                captured = []

                def generate(*values, **kwargs):
                    captured.append((values[4].clone(), values[9].clone()))
                    return torch.zeros(1, 16, 1, 8, 8)

                with patch.object(sampling, 'do_sample', side_effect=generate), \
                     patch.object(sampling, 'clean_memory_on_device'), \
                     patch('random.random', return_value=0.0):
                    sampling._sample_image_inference(
                        accelerator, args, DIT(), encoder, VAE(), [], tokenizer, strategy,
                        '', {'prompt': 'sample prompt', 'negative_prompt': 'negative prompt', 'scale': 7.5},
                        1, 20, cache, None, save_image=False)
                self.assertTrue(torch.all(captured[0][0] == 9))
                self.assertTrue(torch.all(captured[0][1] == 3))
        # Training must still apply the configured dropout.
        with patch('random.random', return_value=0.0):
            outputs = strategy.encode_tokens(tokenizer, [encoder], tokenizer.tokenize('sample prompt'))
        self.assertTrue(torch.all(outputs[0] == 1))

    def test_context_disables_dropout_and_restores_mixed_modes_even_after_failure(self):
        model = torch.nn.Sequential(torch.nn.Dropout(1.0), torch.nn.Linear(1, 1))
        model.train()
        model[1].eval()
        for failure in (False, True):
            with self.subTest(failure=failure):
                try:
                    with sampling.sampling_context(model, None, model[0]):
                        self.assertFalse(any(module.training for module in model.modules()))
                        self.assertTrue(torch.equal(model[0](torch.ones(4)), torch.ones(4)))
                        if failure:
                            raise RuntimeError('sampling failed')
                except RuntimeError:
                    pass
                self.assertTrue(model.training)
                self.assertTrue(model[0].training)
                self.assertFalse(model[1].training)

    def test_context_restores_all_rngs_without_reusing_state_between_images(self):
        for failure in (False, True):
            python_rng, numpy_rng, cpu_rng = random.getstate(), np.random.get_state(), torch.get_rng_state()
            cuda_rng = torch.cuda.get_rng_state_all() if torch.cuda.is_available() else None
            try:
                with sampling.sampling_context():
                    random.seed(42)
                    np.random.seed(42)
                    torch.manual_seed(42)
                    self.assertNotEqual(random.random(), random.random())
                    self.assertFalse(torch.equal(torch.rand(4), torch.rand(4)))
                    if failure:
                        raise RuntimeError('sampling failed')
            except RuntimeError:
                pass
            self.assertEqual(random.getstate(), python_rng)
            actual_numpy = np.random.get_state()
            self.assertEqual(actual_numpy[0], numpy_rng[0])
            np.testing.assert_array_equal(actual_numpy[1], numpy_rng[1])
            self.assertEqual(actual_numpy[2:], numpy_rng[2:])
            self.assertTrue(torch.equal(torch.get_rng_state(), cpu_rng))
            if cuda_rng is not None:
                for actual, expected in zip(torch.cuda.get_rng_state_all(), cuda_rng):
                    self.assertTrue(torch.equal(actual, expected))

    def test_regular_entry_isolates_entire_pass_and_restores_after_errors(self):
        dit, encoder, vae = DIT(), Encoder(), VAE()
        network = torch.nn.Sequential(torch.nn.Dropout(1.0))
        args = SimpleNamespace(sample_at_first=True, sample_prompts=__file__, output_dir='',
                               sample_every_n_steps=1, sample_every_n_epochs=None)
        accelerator = SimpleNamespace(process_index=0, num_processes=1, device=torch.device('cpu'),
            unwrap_model=lambda model: model, autocast=nullcontext, wait_for_everyone=lambda: None)
        for failure in (False, True):
            calls = []

            def generate(*values, **kwargs):
                self.assertFalse(any(model.training for model in (dit, encoder, vae, network)))
                calls.append(torch.rand(4))
                if failure:
                    raise RuntimeError('expected test failure')

            cpu_rng = torch.get_rng_state()
            with tempfile.TemporaryDirectory() as directory:
                args.output_dir = directory
                with patch.object(sampling.train_util, 'load_prompts', return_value=[{'enum': 0}, {'enum': 1}]), \
                     patch.object(sampling, '_sample_image_inference', side_effect=generate), \
                     patch.object(sampling, 'clean_memory_on_device'):
                    if failure:
                        with self.assertRaisesRegex(RuntimeError, 'expected test failure'):
                            sampling.sample_images(accelerator, args, 0, 0, dit, vae, [], encoder, None, None, network=network)
                    else:
                        sampling.sample_images(accelerator, args, 0, 0, dit, vae, [], encoder, None, None, network=network)
                        self.assertEqual(len(calls), 2)
                        self.assertFalse(torch.equal(calls[0], calls[1]))
            self.assertTrue(all(model.training for model in (dit, encoder, vae, network)))
            self.assertTrue(torch.equal(cpu_rng, torch.get_rng_state()))
            self.assertEqual(next(vae.parameters()).device, torch.device('cpu'))


if __name__ == '__main__':
    unittest.main()
