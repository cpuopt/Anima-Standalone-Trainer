"""Opt-in phase diagnostics. Never clears caches or retains model/tensor references."""
import atexit
import ctypes
from ctypes import wintypes
import json
import logging
import os
from pathlib import Path
import time
import weakref

import torch

logger = logging.getLogger(__name__)


class WindowsProcessMemory:
    """PDH process GPU counters, summed across adapters (not CUDA-device specific)."""

    def __init__(self, pid=None):
        self.pid = os.getpid() if pid is None else pid
        self.query = ctypes.c_void_p()
        self.dll = ctypes.WinDLL("pdh")
        self.dll.PdhOpenQueryW.argtypes = [wintypes.LPCWSTR, ctypes.c_size_t, ctypes.POINTER(ctypes.c_void_p)]
        self.dll.PdhAddEnglishCounterW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR, ctypes.c_size_t, ctypes.POINTER(ctypes.c_void_p)]
        self.dll.PdhCollectQueryData.argtypes = [ctypes.c_void_p]
        self.dll.PdhGetFormattedCounterArrayW.argtypes = [ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD), ctypes.POINTER(wintypes.DWORD), ctypes.c_void_p]
        self.dll.PdhCloseQuery.argtypes = [ctypes.c_void_p]
        self._check(self.dll.PdhOpenQueryW(None, 0, ctypes.byref(self.query)))
        self.counters = {}
        try:
            for key, counter in (("dedicated_bytes", "Dedicated Usage"), ("shared_bytes", "Shared Usage"), ("committed_bytes", "Total Committed")):
                handle = ctypes.c_void_p()
                self._check(self.dll.PdhAddEnglishCounterW(self.query, "\\GPU Process Memory(*)\\" + counter, 0, ctypes.byref(handle)))
                self.counters[key] = handle
            self._check(self.dll.PdhCollectQueryData(self.query))
        except Exception:
            self.close()
            raise

    @staticmethod
    def _check(status):
        if status:
            raise OSError(f"PDH status 0x{status & 0xffffffff:08x}")

    @staticmethod
    def sum_instances(items, pid):
        values = [value for name, status, value in items
                  if name.startswith(f"pid_{pid}_") and status in (0, 1)]
        return sum(values) if values else None

    def read(self):
        class ValueUnion(ctypes.Union):
            _fields_ = [("largeValue", ctypes.c_longlong), ("doubleValue", ctypes.c_double)]

        class Value(ctypes.Structure):
            _fields_ = [("CStatus", wintypes.DWORD), ("value", ValueUnion)]

        class Item(ctypes.Structure):
            _fields_ = [("name", wintypes.LPWSTR), ("value", Value)]

        self._check(self.dll.PdhCollectQueryData(self.query))
        result = {"scope": "process_all_adapters", "sample_time_ns": time.time_ns()}
        for key, counter in self.counters.items():
            size, count = wintypes.DWORD(), wintypes.DWORD()
            status = self.dll.PdhGetFormattedCounterArrayW(counter, 0x400, ctypes.byref(size), ctypes.byref(count), None)
            if status & 0xffffffff != 0x800007d2:  # PDH_MORE_DATA
                self._check(status)
            if not size.value:
                result[key] = None
                continue
            buffer = ctypes.create_string_buffer(size.value)
            self._check(self.dll.PdhGetFormattedCounterArrayW(counter, 0x400, ctypes.byref(size), ctypes.byref(count), buffer))
            items = ctypes.cast(buffer, ctypes.POINTER(Item))
            result[key] = self.sum_instances(
                [(items[i].name, items[i].value.CStatus, items[i].value.value.largeValue) for i in range(count.value)], self.pid)
        return result

    def close(self):
        if self.query.value:
            self.dll.PdhCloseQuery(self.query)
            self.query = ctypes.c_void_p()


class MemoryTrace:
    def __init__(self, args, device):
        self.enabled = bool(getattr(args, "memory_trace", False) or os.environ.get("ANIMA_MEMORY_TRACE") == "1")
        self.monitor = bool(getattr(args, "memory_monitor", True))
        self.model_refs = {}
        self.optimizer_ref = None
        self.last_monitor_time = 0.0
        self.error_path = None
        self.last_error_times = {}
        self.last_inventory_time = float('-inf')
        self.cached_inventory = {}
        self.cache_batches = 0
        self.status_path = None
        self.status_tmp = None
        self.device = torch.device(device)
        self.every = max(1, int(getattr(args, "memory_trace_every_n_steps", 50)))
        self.synchronize = bool(getattr(args, "memory_trace_sync", False))
        self.microstep = 0
        self.step_context = {}
        self.last = None
        self.windows = None
        self.file = None
        self.cuda = False
        if not self.enabled and not self.monitor:
            return
        self.cuda = self.device.type == "cuda" and torch.cuda.is_available()
        if self.cuda and self.device.index is None:
            self.device = torch.device("cuda", torch.cuda.current_device())
        try:
            directory = Path(getattr(args, "logging_dir", None) or getattr(args, "output_dir", None) or ".")
            self.error_path = directory / f"memory_errors_pid{os.getpid()}.jsonl"
            directory.mkdir(parents=True, exist_ok=True)
            self.status_path = directory / f"memory_status_pid{os.getpid()}.json"
            self.status_tmp = self.status_path.with_suffix('.tmp')
            if self.enabled:
                self.path = directory / f"memory_trace_{time.time_ns()}_pid{os.getpid()}.jsonl"
                self.file = self.path.open("a", encoding="utf-8", buffering=1)
        except Exception as error:
            self.record_error("trace.open", error)
        if os.name == "nt":
            try:
                self.windows = WindowsProcessMemory()
            except Exception as error:
                self.record_error("windows.open", error)
        atexit.register(self.close)

    def begin_step(self, step, batch):
        if not self.enabled and not self.monitor:
            return
        self.microstep += 1
        self.step_context = {"step": step, "microstep": self.microstep}
        for key in ("latents", "images"):
            value = batch.get(key)
            if value is not None:
                self.step_context[key + "_shape"] = list(value.shape)
        self.step_context["token_shapes"] = [list(t.shape) for t in (batch.get("input_ids_list") or [])]
        self.mark("batch.begin", detail=True)

    def mark(self, stage, detail=False, models=None, **context):
        if models:
            for name, model in models.items():
                if model is None:
                    continue
                for old_name in list(self.model_refs):
                    if old_name != name and self.model_refs[old_name]() is model:
                        del self.model_refs[old_name]
                self.model_refs[name] = weakref.ref(model)
        # Caching precedes the training loop, so microstep stays zero throughout
        # it. Count cache batches independently rather than treating every batch
        # as one of the first three training batches.
        if stage == "text_variants.batch.after":
            self.cache_batches += 1
            sample_index = self.cache_batches
        else:
            sample_index = self.microstep
        detailed = self.enabled and not (detail and sample_index > 3 and sample_index % self.every)
        now = time.monotonic()
        update_monitor = self.monitor and (not detail or now - self.last_monitor_time >= 1)
        if not detailed and not update_monitor:
            return
        try:
            record = {"time_ns": time.time_ns(), "pid": os.getpid(), "rank": os.environ.get("RANK", "0"),
                      "stage": stage, "device": str(self.device), "trace_enabled": self.enabled, **self.step_context, **context}
            if self.cuda:
                if detailed and self.synchronize:
                    torch.cuda.synchronize(self.device)
                allocated = torch.cuda.memory_allocated(self.device)
                reserved = torch.cuda.memory_reserved(self.device)
                free, total = torch.cuda.mem_get_info(self.device)
                record.update(allocated_bytes=allocated, reserved_bytes=reserved,
                              cached_unused_bytes=reserved - allocated,
                              peak_allocated_bytes=torch.cuda.max_memory_allocated(self.device),
                              peak_reserved_bytes=torch.cuda.max_memory_reserved(self.device),
                              device_free_bytes=free, device_total_bytes=total)
                stats = torch.cuda.memory_stats(self.device)
                record["inactive_split_bytes"] = stats.get("inactive_split_bytes.all.current")
                record["allocator_active_bytes"] = stats.get("active_bytes.all.current")
                record["allocation_retries"] = stats.get("num_alloc_retries")
            if self.windows:
                try:
                    record["windows"] = self.windows.read()
                except Exception as error:
                    record["windows_error"] = str(error)
                    self.record_error("windows.snapshot", error)
                    self.windows.close()
                    self.windows = None
            if update_monitor or models:
                # Enumerating model storages is more expensive than allocator
                # counters. Refresh phase boundaries immediately, training at
                # most every five seconds; reuse only numeric summaries.
                if models or not detail or now - self.last_inventory_time >= 5:
                    live_models = {name: ref() for name, ref in self.model_refs.items()}
                    self.cached_inventory = {
                        "models": model_inventory(live_models),
                        "contents": content_inventory(live_models, self.optimizer_ref() if self.optimizer_ref else None),
                        "contents_time_ns": time.time_ns(),
                    }
                    self.last_inventory_time = now
                record.update(self.cached_inventory)
            current = record.get("windows", {}).get("shared_bytes")
            if self.last:
                record["previous_stage"] = self.last["stage"]
                for key in ("allocated_bytes", "reserved_bytes"):
                    if key in record and key in self.last:
                        record["delta_" + key] = record[key] - self.last[key]
                previous = self.last.get("windows", {}).get("shared_bytes")
                if current is not None and previous is not None:
                    record["delta_shared_bytes"] = current - previous
            self.last = record
            if self.file and detailed:
                self.file.write(json.dumps(record, ensure_ascii=False) + "\n")
            if update_monitor and self.status_path:
                record["cuda_visible_devices"] = os.environ.get("CUDA_VISIBLE_DEVICES", "")
                self.status_tmp.write_text(json.dumps(record, ensure_ascii=False), encoding='utf-8')
                os.replace(self.status_tmp, self.status_path)
                self.last_monitor_time = now
            # Peaks are scoped to the interval since the preceding emitted marker.
            if self.cuda and detailed:
                torch.cuda.reset_peak_memory_stats(self.device)
        except Exception as error:
            self.record_error(stage, error)

    def record_error(self, stage, error):
        # Diagnostics, including failures, stay out of the training console.
        # Rate-limit repeated failures (e.g. unavailable counters or full disk).
        now = time.monotonic()
        if not self.error_path or now - self.last_error_times.get(stage, float('-inf')) < 60:
            return
        self.last_error_times[stage] = now
        try:
            with self.error_path.open('a', encoding='utf-8') as output:
                output.write(json.dumps({'time_ns': time.time_ns(), 'pid': os.getpid(),
                                         'stage': stage, 'error': str(error)}, ensure_ascii=False) + '\n')
        except OSError:
            pass

    def close(self):
        if self.windows:
            self.windows.close()
            self.windows = None
        if self.file:
            self.file.close()
            self.file = None
        if self.status_path:
            try:
                self.status_path.unlink(missing_ok=True)
            except OSError:
                pass
        if self.status_tmp:
            try:
                self.status_tmp.unlink(missing_ok=True)
            except OSError:
                pass

    def register_optimizer(self, optimizer):
        self.optimizer_ref = weakref.ref(optimizer)


def model_inventory(models):
    result = {}
    for name, model in models.items():
        if model is None:
            continue
        totals = {}
        seen = set()
        for tensor in list(model.parameters()) + list(model.buffers()):
            if id(tensor) in seen:
                continue
            seen.add(id(tensor))
            key = f"{tensor.device}/{tensor.dtype}"
            totals[key] = totals.get(key, 0) + tensor.numel() * tensor.element_size()
        result[name] = totals
    return result


def content_inventory(models, optimizer=None):
    """Deduplicate actual storages across model groups, grads and optimizer state."""
    seen, result = set(), {}

    def add(name, tensors):
        totals = {}
        for tensor in tensors:
            if not isinstance(tensor, torch.Tensor) or tensor.device.type == 'meta':
                continue
            storage = tensor.untyped_storage()
            key = (str(tensor.device), storage.data_ptr(), storage.nbytes())
            if key in seen:
                continue
            seen.add(key)
            device = str(tensor.device)
            totals[device] = totals.get(device, 0) + storage.nbytes()
        result[name] = totals

    for name, model in models.items():
        if model is not None:
            add(name, list(model.parameters()) + list(model.buffers()))
    add('gradients', (p.grad for model in models.values() if model is not None for p in model.parameters() if p.grad is not None))

    def tensors(value):
        if isinstance(value, torch.Tensor):
            yield value
        elif isinstance(value, dict):
            for v in value.values():
                yield from tensors(v)
        elif isinstance(value, (list, tuple)):
            for v in value:
                yield from tensors(v)

    add('optimizer', tensors(optimizer.state) if optimizer is not None else [])
    return result


def trace_mark(args, stage, **context):
    tracer = getattr(args, "_memory_trace", None)
    if tracer is not None:
        tracer.mark(stage, **context)


def cpu_prompt_outputs(outputs):
    """Long-lived sample caches must not pin GPU embeddings or autograd graphs."""
    return [value.detach().cpu() if isinstance(value, torch.Tensor) else value for value in outputs]
