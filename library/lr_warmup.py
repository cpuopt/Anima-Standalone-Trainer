"""Resolve warmup duration into scheduler ticks without changing saved configuration."""

import math


def resolve_warmup_steps(args, num_processes, updates_per_epoch=None):
    unit = getattr(args, "lr_warmup_unit", "steps")
    if unit not in ("steps", "epochs"):
        raise ValueError("lr_warmup_unit must be steps or epochs")
    if unit == "steps":
        # Preserve the existing integer-step / floating-point ratio semantics.
        value = args.lr_warmup_steps
        return int(value * args.max_train_steps * num_processes) if isinstance(value, float) else value

    epochs = getattr(args, "lr_warmup_epochs", 1.0)
    if isinstance(epochs, bool) or not isinstance(epochs, (int, float)) or not math.isfinite(epochs) or epochs < 0:
        raise ValueError("lr_warmup_epochs must be a finite non-negative number")
    if updates_per_epoch is None or updates_per_epoch <= 0:
        raise ValueError("epoch warmup requires a non-empty training dataloader")
    # AcceleratedScheduler advances num_processes ticks for each optimizer update.
    return math.ceil(epochs * updates_per_epoch) * num_processes
