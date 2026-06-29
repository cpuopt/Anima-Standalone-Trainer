import argparse
import os
import tempfile
import unittest
from multiprocessing import Value

import torch
from PIL import Image
import voluptuous

from library import config_util, train_util


def make_subset(image_dir, *, num_repeats=1, epoch_sample_rate=1.0):
    return train_util.DreamBoothSubset(
        image_dir=image_dir,
        is_reg=False,
        class_tokens=None,
        caption_extension=".caption",
        cache_info=False,
        alpha_mask=False,
        num_repeats=num_repeats,
        shuffle_caption=False,
        caption_separator=",",
        keep_tokens=0,
        keep_tokens_separator=None,
        secondary_separator=None,
        enable_wildcard=False,
        color_aug=False,
        flip_aug=False,
        face_crop_aug_range=None,
        random_crop=False,
        caption_dropout_rate=0.0,
        caption_dropout_every_n_epochs=0,
        caption_tag_dropout_rate=0.0,
        caption_prefix=None,
        caption_suffix=None,
        token_warmup_min=1,
        token_warmup_step=0,
        epoch_sample_rate=epoch_sample_rate,
    )


def write_images(directory, count, sizes=None):
    sizes = sizes or [(64, 64)] * count
    for i in range(count):
        size = sizes[i % len(sizes)]
        path = os.path.join(directory, f"img_{i:03d}.png")
        Image.new("RGB", size, color=(i % 255, (i * 3) % 255, (i * 7) % 255)).save(path)
        with open(os.path.splitext(path)[0] + ".caption", "w", encoding="utf-8") as f:
            f.write(f"caption {i}")


def make_dataset(directory, *, count=10, sizes=None, num_repeats=1, epoch_sample_rate=1.0, batch_size=1):
    write_images(directory, count, sizes)
    dataset = train_util.DreamBoothDataset(
        subsets=[make_subset(directory, num_repeats=num_repeats, epoch_sample_rate=epoch_sample_rate)],
        is_training_dataset=True,
        batch_size=batch_size,
        resolution=(128, 128),
        network_multiplier=1.0,
        enable_bucket=True,
        min_bucket_reso=64,
        max_bucket_reso=128,
        bucket_reso_steps=32,
        bucket_no_upscale=True,
        prior_loss_weight=1.0,
        debug_dataset=False,
        validation_split=0.0,
        validation_seed=None,
        resize_interpolation=None,
    )
    dataset.make_buckets()
    dataset.set_seed(1234)
    return dataset


def bucket_entries(dataset):
    return [image_key for bucket in dataset.bucket_manager.buckets for image_key in bucket]


def first_example(examples):
    return examples[0]


class EpochSampleRateTests(unittest.TestCase):
    def test_config_accepts_and_inherits_epoch_sample_rate(self):
        sanitizer = config_util.ConfigSanitizer(True, False, False, True)
        user_config = {
            "general": {"resolution": [128, 128], "epoch_sample_rate": 0.25},
            "datasets": [{"subsets": [{"image_dir": "images"}]}],
        }

        blueprint = config_util.BlueprintGenerator(sanitizer).generate(user_config, argparse.Namespace())

        subset_params = blueprint.dataset_group.datasets[0].subsets[0].params
        self.assertEqual(0.25, subset_params.epoch_sample_rate)

    def test_config_rejects_out_of_range_epoch_sample_rate(self):
        sanitizer = config_util.ConfigSanitizer(True, False, False, True)

        for rate in (-0.1, 1.1):
            with self.subTest(rate=rate):
                user_config = {
                    "general": {"resolution": [128, 128]},
                    "datasets": [{"subsets": [{"image_dir": "images", "epoch_sample_rate": rate}]}],
                }
                with self.assertRaises(voluptuous.MultipleInvalid):
                    sanitizer.sanitize_user_config(user_config)

    def test_epoch_sampling_is_deterministic_per_seed_and_epoch(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            dataset = make_dataset(tmpdir, count=20, epoch_sample_rate=0.5)
            dataset.set_current_epoch(1)
            epoch_1 = set(bucket_entries(dataset))
            dataset.set_current_epoch(2)
            epoch_2 = set(bucket_entries(dataset))

            dataset_2 = make_dataset(tmpdir, count=0, epoch_sample_rate=0.5)
            dataset_2.set_current_epoch(1)
            epoch_1_again = set(bucket_entries(dataset_2))

        self.assertEqual(10, len(epoch_1))
        self.assertEqual(epoch_1, epoch_1_again)
        self.assertNotEqual(epoch_1, epoch_2)

    def test_sampling_happens_before_repeats(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            dataset = make_dataset(tmpdir, count=10, num_repeats=2, epoch_sample_rate=0.5)
            dataset.set_current_epoch(1)
            entries = bucket_entries(dataset)

        self.assertEqual(5, len(set(entries)))
        self.assertEqual(10, len(entries))

    def test_mixed_resolution_buckets_and_getitem_stay_consistent(self):
        sizes = [(64, 64), (128, 64), (64, 128), (128, 128)]
        with tempfile.TemporaryDirectory() as tmpdir:
            dataset = make_dataset(tmpdir, count=12, sizes=sizes, epoch_sample_rate=0.5)
            dataset.set_caching_mode("latents")
            dataset.set_current_epoch(1)
            entries = bucket_entries(dataset)

            self.assertEqual(6, len(set(entries)))
            self.assertEqual(len(dataset.buckets_indices), len(dataset))
            for i in range(len(dataset)):
                example = dataset[i]
                self.assertGreater(len(example["absolute_paths"]), 0)
                self.assertIsNotNone(example["bucket_reso"])

    def test_dataset_group_refreshes_lengths_and_rejects_empty_sampling(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            dataset = make_dataset(tmpdir, count=5, epoch_sample_rate=0.0)
            group = train_util.DatasetGroup([dataset])

            with self.assertRaisesRegex(ValueError, "epoch_sample_rate"):
                group.set_current_epoch(1)

    def test_dataloader_uses_updated_epoch_length_with_shared_epoch(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            dataset = make_dataset(tmpdir, count=20, epoch_sample_rate=0.5)
            dataset.set_caching_mode("latents")
            group = train_util.DatasetGroup([dataset])
            current_epoch = Value("i", 1)
            group.set_epoch_shared_value(current_epoch)
            group.set_current_epoch(1)
            dataloader = torch.utils.data.DataLoader(
                group,
                batch_size=1,
                shuffle=False,
                num_workers=0,
                collate_fn=first_example,
            )

            epoch_1 = {path for batch in dataloader for path in batch["absolute_paths"]}
            current_epoch.value = 2
            train_util.set_current_epoch_for_dataloader(dataloader, 2)
            epoch_2 = {path for batch in dataloader for path in batch["absolute_paths"]}

        self.assertEqual(10, len(epoch_1))
        self.assertEqual(10, len(epoch_2))
        self.assertNotEqual(epoch_1, epoch_2)

    def test_persistent_worker_dataloader_syncs_epoch_from_shared_value(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            dataset = make_dataset(tmpdir, count=20, epoch_sample_rate=0.5)
            dataset.set_caching_mode("latents")
            group = train_util.DatasetGroup([dataset])
            current_epoch = Value("i", 1)
            group.set_epoch_shared_value(current_epoch)
            group.set_current_epoch(1)
            dataloader = torch.utils.data.DataLoader(
                group,
                batch_size=1,
                shuffle=False,
                num_workers=1,
                persistent_workers=True,
                collate_fn=first_example,
            )

            try:
                epoch_1 = {path for batch in dataloader for path in batch["absolute_paths"]}
                current_epoch.value = 2
                train_util.set_current_epoch_for_dataloader(dataloader, 2)
                epoch_2 = {path for batch in dataloader for path in batch["absolute_paths"]}
            finally:
                if hasattr(dataloader, "_iterator") and dataloader._iterator is not None:
                    dataloader._iterator._shutdown_workers()

        self.assertEqual(10, len(epoch_1))
        self.assertEqual(10, len(epoch_2))
        self.assertNotEqual(epoch_1, epoch_2)


if __name__ == "__main__":
    unittest.main()
