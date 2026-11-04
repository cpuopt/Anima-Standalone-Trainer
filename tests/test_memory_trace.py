import gc
import json
import logging
import tempfile
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import weakref

import torch

from library.memory_trace import MemoryTrace, WindowsProcessMemory, cpu_prompt_outputs, model_inventory, content_inventory


class MemoryTraceTests(unittest.TestCase):
    def test_cache_batches_are_sampled_to_file_and_never_printed(self):
        with tempfile.TemporaryDirectory() as directory:
            trace = MemoryTrace(SimpleNamespace(memory_trace=True, memory_monitor=False,
                                               logging_dir=directory), 'cpu')
            with patch('library.memory_trace.time.monotonic', return_value=100), \
                 patch('library.memory_trace.logger.info') as console:
                for i in range(1000):
                    trace.mark('text_variants.batch.after', detail=True, cached_variants=i + 1)
                console.assert_not_called()
            trace.close()
            records = [json.loads(line) for line in trace.path.read_text().splitlines()]
            self.assertEqual(len(records), 23)  # first 3 plus each 50th
            self.assertEqual(records[-1]['cached_variants'], 1000)

    def test_monitor_only_is_silent_and_reuses_inventory_between_phase_boundaries(self):
        with tempfile.TemporaryDirectory() as directory:
            trace = MemoryTrace(SimpleNamespace(logging_dir=directory), 'cpu')
            with patch('library.memory_trace.time.monotonic') as clock, \
                 patch('library.memory_trace.model_inventory', return_value={}) as inventory, \
                 patch('library.memory_trace.logger.info') as console:
                for now in (100, 101, 102, 105):
                    clock.return_value = now
                    trace.mark('forward.after', detail=True)
                self.assertEqual(inventory.call_count, 2)
                clock.return_value = 106
                trace.mark('sample.after_restore')
                self.assertEqual(inventory.call_count, 3)
                console.assert_not_called()
            trace.close()

    def test_skipped_diagnostic_node_does_not_synchronize_for_monitor_update(self):
        with tempfile.TemporaryDirectory() as directory:
            trace = MemoryTrace(SimpleNamespace(memory_trace=True, memory_trace_sync=True,
                                               logging_dir=directory), 'cpu')
            trace.cuda = True
            trace.device = torch.device('cuda:0')
            trace.microstep = 4  # not one of the first three or a 50th batch
            with patch('torch.cuda.synchronize') as sync, patch('torch.cuda.reset_peak_memory_stats') as reset, \
                 patch('torch.cuda.memory_allocated', return_value=100), \
                 patch('torch.cuda.memory_reserved', return_value=300), \
                 patch('torch.cuda.max_memory_allocated', return_value=200), \
                 patch('torch.cuda.max_memory_reserved', return_value=400), \
                 patch('torch.cuda.mem_get_info', return_value=(1000, 2000)), \
                 patch('torch.cuda.memory_stats', return_value={}):
                trace.mark('forward.after', detail=True)
                sync.assert_not_called()
                reset.assert_not_called()
            trace.close()

    def test_disabled_trace_does_not_touch_cuda_or_create_files(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict('os.environ', {}, clear=True), \
             patch('torch.cuda.memory_allocated', side_effect=AssertionError('unexpected CUDA call')):
            trace = MemoryTrace(SimpleNamespace(logging_dir=directory, memory_monitor=False), 'cpu')
            trace.mark('ignored')
            trace.begin_step(0, {})
            trace.close()
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_pid_filter_ignores_other_processes_invalid_status_and_prefix_collisions(self):
        entries = [('pid_12_luid_a_phys_0', 0, 100), ('pid_12_luid_b_phys_0', 1, 200),
                   ('pid_123_luid_a_phys_0', 0, 9999), ('pid_12_luid_c_phys_0', 5, 800)]
        self.assertEqual(WindowsProcessMemory.sum_instances(entries, 12), 300)
        self.assertIsNone(WindowsProcessMemory.sum_instances(entries, 42))

    def test_json_has_shapes_deltas_and_bounded_records_and_closes(self):
        with tempfile.TemporaryDirectory() as directory:
            trace = MemoryTrace(SimpleNamespace(memory_trace=True, logging_dir=directory), 'cpu')
            if trace.windows:
                trace.windows.close()
            trace.windows = SimpleNamespace(read=lambda: {'shared_bytes': 100}, close=lambda: None)
            trace.mark('before')
            trace.windows.read = lambda: {'shared_bytes': 350}
            trace.begin_step(3, {'latents': torch.zeros(2, 16, 1, 4, 8), 'input_ids_list': [torch.zeros(2, 8)]})
            trace.mark('after')
            path = trace.path
            trace.close()
            records = [json.loads(line) for line in path.read_text().splitlines()]
            self.assertEqual(records[1]['delta_shared_bytes'], 250)
            self.assertEqual(records[1]['latents_shape'], [2, 16, 1, 4, 8])
            self.assertEqual(records[2]['previous_stage'], 'batch.begin')
            self.assertNotIn('previous', records[2])
            self.assertIsNone(trace.file)

    def test_trace_failure_never_masks_training(self):
        with tempfile.TemporaryDirectory() as directory:
            trace = MemoryTrace(SimpleNamespace(memory_trace=True, logging_dir=directory), 'cpu')
            if trace.windows:
                trace.windows.close()
            trace.windows = SimpleNamespace(read=lambda: (_ for _ in ()).throw(OSError('counter lost')), close=lambda: None)
            trace.mark('counter_failed')
            trace.close()
            self.assertEqual(json.loads(trace.path.read_text())['windows_error'], 'counter lost')
            self.assertEqual(json.loads(trace.error_path.read_text())['stage'], 'windows.snapshot')

    def test_initialization_reports_and_errors_never_use_console(self):
        with tempfile.TemporaryDirectory() as directory, patch('library.memory_trace.logger.info') as info, \
             patch('library.memory_trace.logger.warning') as warning:
            trace = MemoryTrace(SimpleNamespace(memory_trace=True, logging_dir=directory), 'cpu')
            trace.mark('startup')
            trace.record_error('test.failure', OSError('diagnostic failure'))
            trace.record_error('test.failure', OSError('diagnostic failure'))
            trace.close()
            info.assert_not_called()
            warning.assert_not_called()
            errors = [json.loads(line) for line in trace.error_path.read_text().splitlines()]
            self.assertEqual(len([item for item in errors if item['stage'] == 'test.failure']), 1)

    def test_interval_counts_microbatches_not_optimizer_steps(self):
        with tempfile.TemporaryDirectory() as directory:
            trace = MemoryTrace(SimpleNamespace(memory_trace=True, logging_dir=directory, memory_trace_every_n_steps=5), 'cpu')
            for i in range(6):
                trace.begin_step(i // 2, {})
                trace.mark('forward', detail=True)
            trace.mark('sample.always')
            trace.close()
            stages = [json.loads(line)['stage'] for line in trace.path.read_text().splitlines()]
            self.assertEqual(stages.count('forward'), 4)  # first three, then fifth
            self.assertEqual(stages[-1], 'sample.always')

    def test_prompt_cache_drops_autograd_and_inventory_does_not_pin_models(self):
        tensor = torch.ones(2, requires_grad=True) * 2
        cached = cpu_prompt_outputs([tensor, None])
        self.assertFalse(cached[0].requires_grad)
        self.assertIsNone(cached[0].grad_fn)
        self.assertEqual(cached[0].device.type, 'cpu')
        model = torch.nn.Linear(2, 3)
        reference = weakref.ref(model)
        inventory = model_inventory({'dit': model})
        self.assertEqual(inventory['dit']['cpu/torch.float32'], (6 + 3) * 4)
        del model
        gc.collect()
        self.assertIsNone(reference())

    def test_contents_deduplicates_shared_storages_and_accounts_optimizer_and_grads(self):
        model = torch.nn.Linear(2, 3)
        alias = torch.nn.Module()
        alias.register_parameter('weight', model.weight)
        optimizer = torch.optim.Adam(model.parameters())
        model(torch.ones(1, 2)).sum().backward()
        optimizer.step()
        contents = content_inventory({'dit': model, 'network': alias}, optimizer)
        self.assertEqual(contents['dit']['cpu'], 36)
        self.assertEqual(contents['network'], {})
        self.assertEqual(contents['gradients']['cpu'], 36)
        self.assertGreater(contents['optimizer']['cpu'], 36)

    def test_cuda_mark_records_interval_peaks_and_optional_sync_without_real_gpu(self):
        with tempfile.TemporaryDirectory() as directory:
            trace = MemoryTrace(SimpleNamespace(memory_trace=True, memory_trace_sync=True,
                                               memory_monitor=False, logging_dir=directory), 'cpu')
            trace.cuda = True
            trace.device = torch.device('cuda:0')
            with patch('torch.cuda.synchronize') as sync, patch('torch.cuda.reset_peak_memory_stats') as reset, \
                 patch('torch.cuda.memory_allocated', return_value=100), \
                 patch('torch.cuda.memory_reserved', return_value=300), \
                 patch('torch.cuda.max_memory_allocated', return_value=200), \
                 patch('torch.cuda.max_memory_reserved', return_value=400), \
                 patch('torch.cuda.mem_get_info', return_value=(1000, 2000)), \
                 patch('torch.cuda.memory_stats', return_value={'inactive_split_bytes.all.current': 80}):
                trace.mark('forward.after')
                sync.assert_called_once_with(trace.device)
                reset.assert_called_once_with(trace.device)
            trace.close()
            record = json.loads(trace.path.read_text())
            self.assertEqual(record['cached_unused_bytes'], 200)
            self.assertEqual(record['peak_allocated_bytes'], 200)
            self.assertEqual(record['inactive_split_bytes'], 80)


if __name__ == '__main__':
    unittest.main()
