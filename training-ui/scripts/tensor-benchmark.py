"""Dense GEMM throughput through PyTorch/cuBLAS; one JSON record per line."""
import argparse
import json
import os
import statistics
import sys

MODES = ("bf16", "fp16", "tf32", "fp32", "fp8", "int8")


def low_precision_gemm(torch, mode, n, device):
    """No conversions or output allocations inside the timed callable."""
    if mode == "fp8":
        a = (torch.randn((n, n), device=device, dtype=torch.float32) * 0.1).to(torch.float8_e4m3fn)
        b = (torch.randn((n, n), device=device, dtype=torch.float32) * 0.1).to(torch.float8_e4m3fn).t()
        c = torch.empty((n, n), device=device, dtype=torch.bfloat16)
        scale = torch.ones((), device=device, dtype=torch.float32)

        def run():
            torch._scaled_mm(a, b, scale, scale, out_dtype=torch.bfloat16,
                             use_fast_accum=False, out=c)

        details = {"kernel": "torch._scaled_mm", "input_dtype": "float8_e4m3fn",
                   "output_dtype": "bfloat16", "scaling": "per_tensor_identity",
                   "use_fast_accum": False, "layout": "A row-major, B column-major"}
    else:
        a = torch.randint(-8, 8, (n, n), device=device, dtype=torch.int8)
        b = torch.randint(-8, 8, (n, n), device=device, dtype=torch.int8)
        c = torch.empty((n, n), device=device, dtype=torch.int32)

        def run():
            torch._int_mm(a, b, out=c)

        details = {"kernel": "torch._int_mm", "input_dtype": "int8",
                   "output_dtype": "int32", "accumulation_dtype": "int32",
                   "layout": "A row-major, B row-major"}
    return run, c, details


def emit(**record):
    print(json.dumps(record, ensure_ascii=False, allow_nan=False), flush=True)


def precision(torch, tf32):
    # Do not mix PyTorch's new precision API with the legacy flags.
    if hasattr(torch.backends.cuda.matmul, "fp32_precision"):
        torch.backends.cuda.matmul.fp32_precision = "tf32" if tf32 else "ieee"
    else:
        torch.backends.cuda.matmul.allow_tf32 = tf32


def measure(torch, mode, n, device, repeats=5, on_round=None):
    if not isinstance(repeats, int) or isinstance(repeats, bool) or not 1 <= repeats <= 50:
        raise ValueError("测试轮数必须为 1–50 的整数")
    major, minor = torch.cuda.get_device_capability(device)
    if mode == "bf16" and (major < 8 or not torch.cuda.is_bf16_supported()):
        return {"status": "skipped", "reason": "此 GPU 不支持原生 BF16 Tensor Core"}
    if mode == "tf32" and major < 8:
        return {"status": "skipped", "reason": "TF32 需要 Ampere 或更新架构"}
    if mode == "fp16" and (major, minor) < (7, 0):
        return {"status": "skipped", "reason": "此 GPU 不支持 FP16 Tensor Core"}
    if mode == "tf32" and os.environ.get("NVIDIA_TF32_OVERRIDE") == "0":
        return {"status": "skipped", "reason": "NVIDIA_TF32_OVERRIDE=0 禁用了 TF32"}
    if mode == "fp8":
        if (major, minor) < (8, 9):
            return {"status": "skipped", "reason": "原生 FP8 需要 Ada（SM 8.9）或更新架构"}
        if not hasattr(torch, "float8_e4m3fn") or not callable(getattr(torch, "_scaled_mm", None)):
            return {"status": "skipped", "reason": "当前 PyTorch 缺少 FP8 E4M3 / _scaled_mm 接口"}
    if mode == "int8":
        if (major, minor) < (7, 2):
            return {"status": "skipped", "reason": "此 GPU 不支持 INT8 Tensor Core（需要 SM 7.2 或更新架构）"}
        if not callable(getattr(torch, "_int_mm", None)):
            return {"status": "skipped", "reason": "当前 PyTorch 缺少 _int_mm 接口"}
    low_precision = mode in ("fp8", "int8")
    precision(torch, mode == "tf32")
    if low_precision:
        # Probe the actual out= API/kernel: private APIs differ between Torch builds.
        try:
            probe, _, _ = low_precision_gemm(torch, mode, 32, device)
            probe()
            torch.cuda.synchronize(device)
            del probe
        except (RuntimeError, NotImplementedError, TypeError) as error:
            if "out of memory" in str(error).lower():
                raise
            return {"status": "skipped", "reason": f"当前 PyTorch / CUDA 不支持 {mode.upper()} 原生内核或 out 接口：{str(error)[:800]}"}
        # Inputs: 1 byte each; outputs: BF16 (2 bytes) or INT32 (4 bytes).
        # FP8 conversion needs an additional FP32 temporary during setup.
        required = n * n * (8 if mode == "fp8" else 6)
    else:
        dtype = {"bf16": torch.bfloat16, "fp16": torch.float16,
                 "tf32": torch.float32, "fp32": torch.float32}[mode]
        required = 3 * n * n * torch.empty((), dtype=dtype).element_size()
    free, _ = torch.cuda.mem_get_info(device)
    if required > free * 0.65:
        return {"status": "skipped", "reason": "可用显存不足，请选择更小矩阵"}
    if low_precision:
        run, c, details = low_precision_gemm(torch, mode, n, device)
    else:
        a = torch.randn((n, n), device=device, dtype=dtype) * 0.01
        b = torch.randn((n, n), device=device, dtype=dtype) * 0.01
        c = torch.empty_like(a)

        def run():
            torch.mm(a, b, out=c)

        details = {"kernel": "torch.mm", "input_dtype": str(dtype), "output_dtype": str(dtype)}
    for _ in range(10):
        run()
    torch.cuda.synchronize(device)
    start, end = torch.cuda.Event(enable_timing=True), torch.cuda.Event(enable_timing=True)

    def batch(count):
        start.record()
        for _ in range(count):
            run()
        end.record()
        end.synchronize()
        return start.elapsed_time(end) / count

    pilot = batch(5)
    iterations = max(5, min(200, int(200 / max(pilot, 0.001))))
    samples = []
    for round_index in range(repeats):
        if on_round:
            on_round(round_index + 1, repeats)
        samples.append(batch(iterations))
    if not torch.isfinite(c).all().item():
        raise RuntimeError("矩阵结果包含非有限值")
    median = statistics.median(samples)
    mean = statistics.mean(samples)
    if min(samples) <= 0:
        raise RuntimeError("CUDA 计时无效")
    throughput = 2 * n ** 3 / (mean * 1e9)
    unit = "TOPS" if mode == "int8" else "TFLOPS"
    return {"status": "completed", "mean_ms": mean, "median_ms": median, "min_ms": min(samples),
            "max_ms": max(samples), "samples_ms": samples,
            "throughput": throughput, "unit": unit,
            ("tops" if mode == "int8" else "tflops"): throughput,
            "iterations": iterations, "warmup": 10, "repeats": repeats, **details}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--gpu", type=int, default=0)
    parser.add_argument("--sizes", default="2048,4096,8192")
    parser.add_argument("--repeats", type=int, default=5)
    args = parser.parse_args()
    if not 1 <= args.repeats <= 50:
        raise ValueError("测试轮数必须为 1–50 的整数")
    sizes = [int(n) for n in args.sizes.split(",")]
    if not sizes or any(n not in (2048, 4096, 8192) for n in sizes):
        raise ValueError("不支持的矩阵规模")
    import torch
    if not torch.cuda.is_available() or torch.version.hip:
        raise RuntimeError("需要 NVIDIA CUDA 版 PyTorch 和可用 GPU；请先检测模型环境")
    if args.gpu < 0 or args.gpu >= torch.cuda.device_count():
        raise ValueError("GPU 编号无效")
    device = torch.device("cuda", args.gpu)
    torch.cuda.set_device(device)
    torch.manual_seed(1234)
    torch.backends.cuda.matmul.allow_fp16_reduced_precision_reduction = False
    torch.backends.cuda.matmul.allow_bf16_reduced_precision_reduction = False
    if hasattr(torch.backends.cuda.matmul, "allow_fp16_accumulation"):
        torch.backends.cuda.matmul.allow_fp16_accumulation = False
    props = torch.cuda.get_device_properties(device)
    emit(type="metadata", gpu=props.name, device=args.gpu, vram_bytes=props.total_memory,
         capability=list(torch.cuda.get_device_capability(device)), torch=torch.__version__,
         cuda=torch.version.cuda, python=sys.version.split()[0], sizes=sizes, repeats=args.repeats, modes=MODES,
         aggregation="arithmetic_mean_latency",
         method="Dense GEMM / torch.mm, torch._scaled_mm, torch._int_mm / cuBLAS / CUDA Events / 2MNK",
         reduced_precision_reduction=False,
         note="非稀疏吞吐量；Tensor Core 路径由 cuBLAS 选择，未通过 profiler 核实。FP32 为 IEEE 基线；不代表整机训练速度或厂商峰值。")
    with torch.inference_mode():
        for mode in MODES:
            for n in sizes:
                emit(type="progress", mode=mode, size=n)
                try:
                    result = measure(torch, mode, n, device, args.repeats,
                                     lambda current, total: emit(type="progress", mode=mode, size=n,
                                                                 round=current, repeats=total))
                except (RuntimeError, NotImplementedError) as error:
                    result = {"status": "failed", "reason": str(error)[:1000]}
                finally:
                    torch.cuda.empty_cache()
                emit(type="result", mode=mode, size=n, **result)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit(type="error", error=str(error))
        sys.exit(1)
