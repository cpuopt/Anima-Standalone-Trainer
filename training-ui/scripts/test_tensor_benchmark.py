"""CPU-only checks for timing arithmetic and unsupported hardware paths."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace as NS
import unittest
from unittest.mock import MagicMock, patch

spec = importlib.util.spec_from_file_location("tensor_benchmark", Path(__file__).with_name("tensor-benchmark.py"))
benchmark = importlib.util.module_from_spec(spec)
spec.loader.exec_module(benchmark)


class BenchmarkTest(unittest.TestCase):
    def torch(self, capability=(8, 9), free=10**10):
        torch = MagicMock()
        torch.backends.cuda.matmul = NS(fp32_precision="ieee")
        torch.cuda.get_device_capability.return_value = capability
        torch.cuda.is_bf16_supported.return_value = True
        torch.cuda.mem_get_info.return_value = (free, free)
        torch.empty.return_value.element_size.return_value = 2
        torch.cuda.Event.return_value.elapsed_time.return_value = 10.0
        torch.isfinite.return_value.all.return_value.item.return_value = True
        return torch

    def test_median_and_tflops_use_per_operation_gpu_time(self):
        torch = self.torch()
        result = benchmark.measure(torch, "bf16", 2048, "cuda:0")
        # Pilot: 10ms / 5 = 2ms. Calibrated batches: 100 iterations.
        self.assertEqual(result["iterations"], 100)
        self.assertEqual(result["median_ms"], 0.1)
        self.assertAlmostEqual(result["tflops"], 2 * 2048**3 / (0.1 * 1e9))
        self.assertEqual(torch.mm.call_count, 10 + 5 + 5 * 100)
        self.assertEqual(len(result["samples_ms"]), 5)

    def test_custom_rounds_use_mean_latency_and_report_progress(self):
        torch = self.torch()
        torch.cuda.Event.return_value.elapsed_time.side_effect = [10.0, 10.0, 20.0, 60.0]
        progress = []
        result = benchmark.measure(torch, "bf16", 2048, "cuda:0", 3,
                                   lambda current, total: progress.append((current, total)))
        self.assertEqual(result["repeats"], 3)
        self.assertEqual(result["samples_ms"], [0.1, 0.2, 0.6])
        self.assertAlmostEqual(result["mean_ms"], 0.3)
        self.assertEqual(result["median_ms"], 0.2)
        self.assertAlmostEqual(result["tflops"], 2 * 2048**3 / (0.3 * 1e9))
        self.assertEqual(progress, [(1, 3), (2, 3), (3, 3)])
        for invalid in (0, -1, 51, 2.5, True):
            with self.assertRaises(ValueError):
                benchmark.measure(torch, "bf16", 2048, "cuda:0", invalid)

    def test_unsupported_modes_and_memory_skip_before_allocation(self):
        for mode, capability, free in [("bf16", (7, 5), 10**10), ("tf32", (7, 5), 10**10),
                                        ("fp16", (6, 1), 10**10), ("fp16", (8, 9), 1)]:
            with self.subTest(mode=mode, capability=capability, free=free):
                torch = self.torch(capability, free)
                result = benchmark.measure(torch, mode, 4096, "cuda:0")
                self.assertEqual(result["status"], "skipped")
                torch.randn.assert_not_called()

    def test_precision_modes_and_explicit_tf32_override(self):
        torch = self.torch()
        benchmark.precision(torch, True)
        self.assertEqual(torch.backends.cuda.matmul.fp32_precision, "tf32")
        benchmark.precision(torch, False)
        self.assertEqual(torch.backends.cuda.matmul.fp32_precision, "ieee")
        torch.backends.cuda.matmul = NS(allow_tf32=True)
        benchmark.precision(torch, False)
        self.assertFalse(torch.backends.cuda.matmul.allow_tf32)
        with patch.dict("os.environ", {"NVIDIA_TF32_OVERRIDE": "0"}):
            self.assertEqual(benchmark.measure(torch, "tf32", 2048, "cuda:0")["status"], "skipped")

    def test_invalid_results_never_produce_a_score(self):
        torch = self.torch()
        torch.isfinite.return_value.all.return_value.item.return_value = False
        with self.assertRaisesRegex(RuntimeError, "非有限"):
            benchmark.measure(torch, "fp16", 2048, "cuda:0")

    def test_low_precision_kernels_use_preallocated_outputs_and_correct_units(self):
        for mode, api, unit in [("fp8", "_scaled_mm", "TFLOPS"), ("int8", "_int_mm", "TOPS")]:
            with self.subTest(mode=mode):
                torch = self.torch()
                result = benchmark.measure(torch, mode, 2048, "cuda:0", 2)
                kernel = getattr(torch, api)
                self.assertEqual(result["unit"], unit)
                self.assertEqual(result["kernel"], "torch." + api)
                self.assertEqual(result["repeats"], 2)
                self.assertEqual(kernel.call_count, 1 + 10 + 5 + 2 * 100)
                self.assertIn("out", kernel.call_args.kwargs)
                self.assertEqual(result["input_dtype"], "float8_e4m3fn" if mode == "fp8" else "int8")
                if mode == "int8":
                    self.assertNotIn("tflops", result)
                    self.assertEqual(result["tops"], result["throughput"])
                else:
                    self.assertFalse(kernel.call_args.kwargs["use_fast_accum"])
                torch.mm.assert_not_called()

    def test_low_precision_unavailable_hardware_api_and_kernel_skip(self):
        for mode, capability in [("fp8", (8, 6)), ("int8", (7, 0))]:
            torch = self.torch(capability)
            self.assertEqual(benchmark.measure(torch, mode, 2048, "cuda:0")["status"], "skipped")
        for mode, api in [("fp8", "_scaled_mm"), ("int8", "_int_mm")]:
            torch = self.torch()
            setattr(torch, api, None)
            self.assertEqual(benchmark.measure(torch, mode, 2048, "cuda:0")["status"], "skipped")
            torch = self.torch()
            getattr(torch, api).side_effect = TypeError("out keyword unsupported")
            result = benchmark.measure(torch, mode, 2048, "cuda:0")
            self.assertEqual(result["status"], "skipped")
            self.assertIn("out keyword unsupported", result["reason"])
            torch = self.torch()
            getattr(torch, api).side_effect = RuntimeError("CUDA out of memory")
            with self.assertRaisesRegex(RuntimeError, "out of memory"):
                benchmark.measure(torch, mode, 2048, "cuda:0")


if __name__ == "__main__":
    unittest.main()
