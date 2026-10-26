"""Exercise the vendored filename/save statements without loading models or CUDA."""
import ast
from pathlib import Path
import types
import unittest
from unittest.mock import Mock
import os


SOURCE = Path(__file__).resolve().parents[1] / 'vendor/sd-scripts/library/moss_image_train_utils.py'


class SampleNameTests(unittest.TestCase):
    def filename(self, epoch=None, steps=500, index=0, seed=42, output_name='my_moss_lora'):
        tree = ast.parse(SOURCE.read_text(encoding='utf-8'))
        function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == '_sample_image_inference')
        start = next(i for i, n in enumerate(function.body)
                     if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'ts_str' for t in n.targets))
        end = next(i for i in range(start, len(function.body)) if isinstance(function.body[i], ast.Expr)
                   and isinstance(function.body[i].value, ast.Call)
                   and isinstance(function.body[i].value.func, ast.Attribute)
                   and function.body[i].value.func.attr == 'save')
        image = Mock()
        scope = dict(args=types.SimpleNamespace(output_name=output_name), epoch=epoch, steps=steps,
                     seed=seed, prompt_dict={'enum': index}, save_dir='sample', image=image, os=os,
                     time=types.SimpleNamespace(localtime=lambda: None, strftime=lambda *args: '20261026143025'))
        exec(compile(ast.Module(body=function.body[start:end + 1], type_ignores=[]), str(SOURCE), 'exec'), scope)
        name = scope['img_filename']
        image.save.assert_called_once_with(os.path.join('sample', name))
        return name

    def test_step_and_epoch(self):
        self.assertEqual(self.filename(), 'my_moss_lora_00_000500_20261026143025_42.png')
        self.assertEqual(self.filename(epoch=3, index=1), 'my_moss_lora_01_e000003_20261026143025_42.png')

    def test_seed_zero_missing_seed_and_optional_prefix(self):
        self.assertEqual(self.filename(seed=0), 'my_moss_lora_00_000500_20261026143025_0.png')
        self.assertEqual(self.filename(seed=None, output_name=None), '00_000500_20261026143025.png')

    def test_filename_sort_groups_prompt_before_training_progress(self):
        for epochs in [False, True]:
            names = [(self.filename(epoch=step if epochs else None, steps=step, index=index), index, step)
                     for step in [100, 2, 20] for index in [1, 0]]
            self.assertEqual([(index, step) for _, index, step in sorted(names)],
                             [(0, 2), (0, 20), (0, 100), (1, 2), (1, 20), (1, 100)])


if __name__ == '__main__':
    unittest.main()
