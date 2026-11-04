"""Shared parser contract and real training method tests without GPU dependencies."""
import ast
import json
import math
import os
from pathlib import Path
import random
import re
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch

from library.caption_split import split_caption

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = json.loads((ROOT / 'tests/fixtures/caption_split.json').read_text(encoding='utf-8'))


def training_function(name):
    # Compile the actual method body, avoiding imports of torch/model dependencies.
    tree = ast.parse((ROOT / 'library/train_util.py').read_text(encoding='utf-8'))
    node = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == name)
    for arg in node.args.args:
        arg.annotation = None
    namespace = dict(random=random, re=re, math=math, os=os)
    exec(compile(ast.Module(body=[node], type_ignores=[]), '<training-method>', 'exec'), namespace)
    return namespace[name]


class CaptionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.process = staticmethod(training_function('process_caption'))
        cls.read = staticmethod(training_function('read_caption'))

    def setUp(self):
        self.dataset = SimpleNamespace(current_epoch=1, current_step=0, max_train_steps=100, replacements={})
        self.subset = SimpleNamespace(shuffle_caption=True, caption_prefix=None, caption_suffix=None,
            caption_dropout_rate=0, caption_dropout_every_n_epochs=0, enable_wildcard=False,
            token_warmup_step=0, token_warmup_min=1, caption_tag_dropout_rate=0,
            keep_tokens=0, keep_tokens_separator=None, caption_separator=',', secondary_separator=None)

    def run_caption(self, text):
        return self.process(self.dataset, self.subset, text)

    def test_shared_contract(self):
        for case in FIXTURES:
            with self.subTest(case=case['name']):
                self.assertEqual(split_caption(case['input']), case['expected'])

    def test_examples_and_multiline_survive_repeated_shuffle(self):
        for case in FIXTURES[:6]:
            expected = case['expected']
            outputs = set()
            for seed in range(10):
                with patch('random.shuffle', side_effect=random.Random(seed).shuffle):
                    output = self.run_caption(case['input'])
                suffix = expected['separator'] + expected['natural_language']
                self.assertTrue(output.endswith(suffix))
                self.assertCountEqual(output[:-len(suffix)].split(', '), expected['tags'].split(', '))
                outputs.add(output)
            if len(expected['tags'].split(',')) > 1:
                self.assertGreater(len(outputs), 1)

    def test_keep_tokens_dropout_and_warmup(self):
        text = 'trigger, red hair, solo\nNatural language, untouched.'
        self.subset.keep_tokens = 1
        self.subset.caption_tag_dropout_rate = 1
        self.assertEqual(self.run_caption(text), 'trigger\nNatural language, untouched.')
        self.subset.caption_tag_dropout_rate = 0
        self.subset.token_warmup_step = 10
        self.assertEqual(len(self.run_caption(text).split('\n')[0].split(',')), 2)
        self.subset.caption_dropout_rate = 1
        self.assertEqual(self.run_caption(text), '')

    def test_explicit_regions_and_secondary_separator(self):
        self.subset.keep_tokens_separator = '|||'
        self.subset.secondary_separator = ';'
        self.subset.caption_tag_dropout_rate = 1
        self.assertEqual(self.run_caption('trigger|||solo, red hair|||end\nNatural|||language; unchanged.'),
                         'trigger, end\nNatural|||language; unchanged.')

    def test_wildcards_do_not_touch_description_or_choose_line(self):
        self.subset.enable_wildcard = True
        with patch('random.choice', side_effect=lambda values: values[0]):
            self.assertEqual(self.run_caption('{solo|pair}\nDescription {must|stay}.'), 'solo\nDescription {must|stay}.')
            self.subset.shuffle_caption = False
            self.assertEqual(self.run_caption('solo\npair'), 'solo')

    def test_prefix_suffix_and_pure_prose(self):
        self.subset.caption_prefix = 'trigger'
        self.subset.caption_suffix = 'suffix'
        self.assertEqual(self.run_caption('A girl with white hair looks forward.'), 'trigger A girl with white hair looks forward. suffix')

    def test_reader_preserves_physical_lines_and_legacy_mode(self):
        with tempfile.TemporaryDirectory() as directory:
            image = str(Path(directory) / 'image.png')
            text = '\r\nFirst description.\r\n\r\n  Last description.\r\n'
            Path(directory, 'image.txt').write_bytes(text.encode())
            self.assertEqual(self.read(image, '.txt', False, True), text)
            self.assertEqual(self.read(image, '.txt', True, True), text)
            self.assertEqual(self.read(image, '.txt', False, False), '')

    def test_epoch_dropout_and_cache_restriction_remain(self):
        self.subset.caption_dropout_every_n_epochs = 1
        self.assertEqual(self.run_caption('solo\nDescription.'), '')
        tree = ast.parse((ROOT / 'library/train_util.py').read_text(encoding='utf-8'))
        node = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == 'is_text_encoder_output_cacheable')
        self.assertIn('subset.shuffle_caption', ast.unparse(node))


if __name__ == '__main__':
    unittest.main()
