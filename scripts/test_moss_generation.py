"""CPU-only lifecycle tests with fake GPU calls, not real model/GPU validation."""
import copy
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
import weakref

import moss_runtime


class Resource:
    pass


class Tensor:
    def cpu(self):
        return self

    def to(self, device):
        return self


class GenerationTests(unittest.TestCase):
    def run_generation(self, failure=None, quantized=False):
        events, refs = [], {}

        def resource(name):
            value = Resource()
            refs[name] = weakref.ref(value)
            events.append('load_' + name)
            return value

        def encode_load(args, device):
            self.assertEqual(device, 'cuda')
            self.assertFalse(args.text_encoder_cpu)
            self.assertEqual(args.convrot_int8_text_encoder, quantized)
            return resource('encoder')

        def encode(args, tokenizer, encoder, device, cache):
            self.assertEqual(device, 'cuda')
            self.assertIs(refs['encoder'](), encoder)
            events.append('encode')
            if failure == 'encode':
                raise RuntimeError('encode failed')
            cache[args.prompt] = Tensor()
            return Tensor(), Tensor()

        def dit_load(args, device):
            self.assertIsNone(refs['encoder'](), 'Text encoder still resident when loading DiT')
            self.assertEqual(device, 'cuda')
            return resource('dit')

        def sample(*args):
            events.append('sample')
            if failure == 'sample':
                raise RuntimeError('sample failed')
            return Tensor()

        def vae_load(args, device):
            self.assertIsNone(refs['dit'](), 'DiT still resident when loading VAE')
            return resource('vae')

        def decode(*args):
            events.append('decode')
            if failure == 'decode':
                raise RuntimeError('decode failed')
            return Tensor()

        torch = types.ModuleType('torch')
        torch.device = lambda value: value
        torch.cuda = types.SimpleNamespace(reset_peak_memory_stats=lambda: None, max_memory_allocated=lambda: 0)
        inference = types.ModuleType('moss_image_minimal_inference')
        inference.load_text_encoder = encode_load
        inference.prepare_text_inputs = encode
        inference.check_inputs = lambda args: None
        inference.load_dit_model = dit_load
        inference.generate_latents = sample
        inference.load_vae = vae_load
        inference.decode_latents = decode
        utils = types.ModuleType('library.moss_image_utils')
        utils.load_tokenizer = lambda _: Resource()
        device_utils = types.ModuleType('library.device_utils')
        device_utils.clean_memory_on_device = lambda device: events.append('clean_' + device)
        library = types.ModuleType('library')
        library.moss_image_utils = utils

        with tempfile.TemporaryDirectory() as directory:
            inference.save_image = lambda pixels, args, name: str(Path(directory) / name)
            prompt = dict(prompt='fox', negative_prompt='', height=512, width=512, seed=0, sample_steps=2, scale=3)
            spec = dict(dit='dit', text_encoder='encoder', vae='vae', flow_shift=5, output=directory,
                        multiplier=1, prompts=[prompt, copy.deepcopy(prompt)], convrot_int8_text_encoder=quantized)
            with patch.dict(sys.modules, {'torch': torch, 'moss_image_minimal_inference': inference,
                                         'library': library, 'library.moss_image_utils': utils,
                                         'library.device_utils': device_utils}):
                if failure:
                    with self.assertRaisesRegex(RuntimeError, failure + ' failed'):
                        moss_runtime.generate(spec)
                else:
                    moss_runtime.generate(spec)
                    self.assertEqual(len(list(Path(directory).glob('*.json'))), 2)
            self.assertEqual(events[-1], 'clean_cuda', 'Missing final CUDA cleanup')
            for name, ref in refs.items():
                self.assertIsNone(ref(), name + ' retained after generation')
            return events

    def test_gpu_encoding_once_per_batch_and_stage_release(self):
        for quantized in [False, True]:
            with self.subTest(quantized=quantized):
                events = self.run_generation(quantized=quantized)
                self.assertEqual(events.count('load_encoder'), 1)
                self.assertEqual(events.count('encode'), 2)
                self.assertLess(events.index('encode'), events.index('load_dit'))
                self.assertEqual(events.count('clean_cuda'), 3)

    def test_cleanup_on_encoding_sampling_and_decode_failure(self):
        for stage in ['encode', 'sample', 'decode']:
            with self.subTest(stage=stage):
                self.run_generation(failure=stage)


if __name__ == '__main__':
    unittest.main()
