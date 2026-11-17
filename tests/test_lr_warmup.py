import ast
import math
from pathlib import Path
from types import SimpleNamespace
import unittest

from library.lr_warmup import resolve_warmup_steps


class WarmupTests(unittest.TestCase):
    def test_legacy_steps_and_ratio_are_unchanged(self):
        for value, processes, expected in [(100, 1, 100), (100, 4, 100), (0.1, 4, 400), (0, 1, 0)]:
            args = SimpleNamespace(lr_warmup_steps=value, max_train_steps=1000)
            self.assertEqual(resolve_warmup_steps(args, processes), expected)

    def test_epoch_conversion_with_accumulation_and_distributed_padding(self):
        for batches, processes, accumulation in [(101, 1, 4), (101, 4, 3), (5, 8, 2)]:
            updates = math.ceil(math.ceil(batches / processes) / accumulation)
            args = SimpleNamespace(lr_warmup_unit='epochs', lr_warmup_epochs=2.5, lr_warmup_steps=999)
            self.assertEqual(resolve_warmup_steps(args, processes, updates), math.ceil(2.5 * updates) * processes)

    def test_invalid_epoch_duration(self):
        for value in [-1, float('nan'), float('inf'), '2', True]:
            with self.assertRaises(ValueError):
                resolve_warmup_steps(SimpleNamespace(lr_warmup_unit='epochs', lr_warmup_epochs=value), 1, 20)

    def test_real_scheduler_linear_ramp_and_resume(self):
        # Load just the production factory to avoid unrelated model/GPU imports.
        import torch
        from transformers.optimization import SchedulerType, TYPE_TO_SCHEDULER_FUNCTION
        import logging
        tree = ast.parse((Path(__file__).resolve().parents[1] / 'library/train_util.py').read_text(encoding='utf-8'))
        factory = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'get_scheduler_fix')
        scope = dict(Optimizer=torch.optim.Optimizer, is_schedulefree_optimizer=lambda *_: False,
                     SchedulerType=SchedulerType, TYPE_TO_SCHEDULER_FUNCTION=TYPE_TO_SCHEDULER_FUNCTION,
                     DiffusersSchedulerType=SimpleNamespace(PIECEWISE_CONSTANT=SimpleNamespace(value='piecewise_constant')),
                     logger=logging.getLogger(__name__))
        exec(compile(ast.Module(body=[factory], type_ignores=[]), '<scheduler>', 'exec'), scope)
        for name, processes in [(name, processes) for name in ['constant', 'linear', 'cosine'] for processes in [1, 4]]:
            args = SimpleNamespace(lr_scheduler=name, max_train_steps=20, lr_warmup_steps=999,
                lr_warmup_unit='epochs', lr_warmup_epochs=2, lr_decay_steps=0,
                lr_scheduler_num_cycles=1, lr_scheduler_power=1, lr_scheduler_timescale=None,
                lr_scheduler_min_lr_ratio=0, lr_scheduler_args=[], lr_scheduler_type=None)
            optimizer = torch.optim.SGD([torch.nn.Parameter(torch.zeros(1))], lr=1)
            scheduler = scope['get_scheduler_fix'](args, optimizer, processes, 3)
            self.assertEqual(scheduler.get_last_lr(), [0])
            for step in range(1, 7):
                optimizer.step()
                for _ in range(processes):
                    scheduler.step()
                self.assertAlmostEqual(scheduler.get_last_lr()[0], step / 6)
            state = scheduler.state_dict()
            restored = scope['get_scheduler_fix'](args, optimizer, processes, 3)
            restored.load_state_dict(state)
            self.assertEqual(restored.last_epoch, scheduler.last_epoch)
            self.assertEqual(restored.get_last_lr(), scheduler.get_last_lr())
            for _ in range(processes):
                scheduler.step()
                restored.step()
            self.assertEqual(restored.get_last_lr(), scheduler.get_last_lr())

    def test_zero_and_empty_dataloader(self):
        args = SimpleNamespace(lr_warmup_unit='epochs', lr_warmup_epochs=0)
        self.assertEqual(resolve_warmup_steps(args, 4, 10), 0)
        for updates in [None, 0]:
            with self.assertRaises(ValueError):
                resolve_warmup_steps(args, 1, updates)


if __name__ == '__main__':
    unittest.main()
