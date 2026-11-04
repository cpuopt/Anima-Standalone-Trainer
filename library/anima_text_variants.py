"""Deterministic, disk-backed caption encodings for each (epoch, image, repeat)."""
from collections import Counter
from contextlib import contextmanager
import copy
import hashlib
import inspect
import json
import logging
import math
import os
from pathlib import Path
import random
from types import SimpleNamespace

from safetensors import safe_open
from tqdm import tqdm

logger = logging.getLogger(__name__)
VERSION = 1


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()[:24]


def model_identity(path):
    resolved = Path(path).resolve()
    stat = resolved.stat()
    return [str(resolved), stat.st_size, stat.st_mtime_ns]


def tokenizer_identity(strategy):
    result = [type(strategy).__module__, type(strategy).__qualname__,
              strategy.qwen3_max_length, strategy.t5_max_length]
    for name in ('qwen3_tokenizer', 't5_tokenizer'):
        tokenizer = getattr(strategy, name, None)
        if tokenizer is not None:
            result.append(fingerprint([type(tokenizer).__qualname__, tokenizer.get_vocab(),
                                       tokenizer.special_tokens_map, getattr(tokenizer, 'init_kwargs', {})]))
    return result


class VariantIndex:
    """Pickle-safe descriptors; never contains a model or tensor."""
    def __init__(self, roots, epochs):
        self.roots = roots
        self.epochs = epochs

    def path_for(self, image_key, epoch, occurrence):
        if not 1 <= epoch <= self.epochs:
            raise ValueError(f"Text variant epoch {epoch} exceeds cached range 1..{self.epochs}; rebuild cache")
        return str(Path(self.roots[image_key]) / f"e{epoch:06d}_r{occurrence:06d}.safetensors")


def deterministic_caption(dataset, subset, caption, seed, epoch, occurrence, image_key, global_dropout=0):
    # Cache preparation runs before workers start. Restore global RNG so caching
    # never changes training's random sequence; avoid mutating dataset/subset state.
    local_dataset, local_subset = copy.copy(dataset), copy.copy(subset)
    local_dataset.current_epoch = epoch
    if global_dropout > 0:
        local_subset.caption_dropout_rate = global_dropout
    rng_state = random.getstate()
    try:
        random.seed(int(fingerprint([seed, image_key, epoch, occurrence]), 16))
        return local_dataset.process_caption(local_subset, caption)
    finally:
        random.setstate(rng_state)


def epoch_count(args, group, accelerator):
    if args.max_train_epochs is not None:
        return max(1, int(args.max_train_epochs))
    batches_per_rank = math.ceil(len(group) / accelerator.num_processes)
    updates = max(1, math.ceil(batches_per_rank / args.gradient_accumulation_steps))
    return max(1, math.ceil(args.max_train_steps / updates))


def valid_variant(path, identity, strategy):
    if not Path(path).is_file():
        return False
    try:
        with safe_open(path, framework="pt") as handle:
            if (handle.metadata() or {}).get("variant_identity") != identity:
                return False
        return strategy.is_disk_cached_outputs_expected(path)
    except Exception:
        return False


@contextmanager
def preserve_random_state():
    state = random.getstate()
    try:
        yield
    finally:
        random.setstate(state)


@preserve_random_state()
def cache_variants(group, models, accelerator, args, tokenize_strategy, encoding_strategy, caching_strategy):
    if getattr(args, 'resolution_schedule', None):
        raise ValueError("Per-use Anima text variants currently require a fixed resolution schedule")
    epochs = epoch_count(args, group, accelerator)
    model = model_identity(args.qwen3_path)
    tokenizer = tokenizer_identity(tokenize_strategy)
    encoding_code = inspect.getsource(type(encoding_strategy))
    batch_size = max(1, caching_strategy.batch_size or 1)
    for dataset_no, original_dataset in enumerate(group.datasets):
        dataset = getattr(original_dataset, 'dreambooth_dataset_delegate', original_dataset)
        roots = {}
        caption_code = inspect.getsource(type(dataset).process_caption)
        caption_split_code = Path(__file__).with_name('caption_split.py').read_text(encoding='utf-8')
        for key, info in dataset.image_data.items():
            subset = dataset.image_to_subset[key]
            if subset.token_warmup_step > 0:
                raise ValueError("Per-use text variants do not support token_warmup_step; disable it before caching")
            identity = fingerprint([VERSION, model, tokenizer, encoding_code, args.seed, str(Path(info.absolute_path).resolve()),
                                    info.caption, vars(subset), dataset.replacements, caption_code, caption_split_code,
                                    getattr(args, 'caption_dropout_rate', 0.0)])
            roots[key] = str(Path(info.absolute_path).parent / 'cache_text_encoder' / 'variants' / identity)
        index = VariantIndex(roots, epochs)
        pending = []
        planned = 0
        reused = 0
        encoded = 0

        def flush():
            nonlocal encoded
            if not pending:
                return
            # The strategy performs atomic, metadata-tagged writes for these infos.
            caching_strategy.cache_batch_outputs(tokenize_strategy, models, encoding_strategy, pending)
            encoded += len(pending)
            pending.clear()
            from library.memory_trace import trace_mark
            trace_mark(args, 'text_variants.batch.after', detail=True, cached_variants=encoded)

        for epoch in tqdm(range(1, epochs + 1), desc=f'Text variants dataset {dataset_no}'):
            epoch_dataset = copy.copy(dataset)
            epoch_dataset.current_epoch = epoch
            active = Counter(epoch_dataset._iter_active_image_keys(epoch_dataset._uses_epoch_sampling))
            for key, multiplicity in active.items():
                info = dataset.image_data[key]
                subset = dataset.image_to_subset[key]
                for occurrence in range(info.num_repeats * multiplicity):
                    serial = planned
                    planned += 1
                    if serial % accelerator.num_processes != accelerator.process_index:
                        continue
                    path = index.path_for(key, epoch, occurrence)
                    identity = fingerprint([Path(roots[key]).name, epoch, occurrence])
                    if valid_variant(path, identity, caching_strategy):
                        reused += 1
                        continue
                    caption = deterministic_caption(dataset, subset, info.caption, args.seed, epoch, occurrence, key,
                                                    getattr(args, 'caption_dropout_rate', 0.0))
                    Path(path).parent.mkdir(parents=True, exist_ok=True)
                    pending.append(SimpleNamespace(caption=caption, text_encoder_outputs_npz=path,
                                                   variant_identity=identity))
                    if len(pending) >= batch_size:
                        flush()
        flush()
        # Publish only after every rank has completed its share. Missing cache
        # entries later raise an error instead of silently reusing the wrong tags.
        accelerator.wait_for_everyone()
        dataset._anima_variant_cache = index
        logger.info("Text variants dataset=%s epochs=%s planned=%s encoded_here=%s reused_here=%s",
                    dataset_no, epochs, planned, encoded, reused)
