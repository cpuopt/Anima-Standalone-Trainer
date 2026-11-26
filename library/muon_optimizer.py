"""Single-device Muon with auxiliary AdamW for Anima full fine-tuning."""

import math

import torch


def add_muon_arguments(parser):
    group = parser.add_argument_group("Muon (single-device Anima full fine-tuning)")
    group.add_argument("--use_muon", action="store_true")
    group.add_argument("--muon_lr", type=float, default=0.02)
    group.add_argument("--muon_lr_scale", type=float, default=0.05)
    group.add_argument("--muon_momentum", type=float, default=0.95)
    group.add_argument("--muon_weight_decay", type=float, default=0.01)
    group.add_argument("--muon_ns_steps", type=int, default=5)
    group.add_argument("--muon_adam_lr", type=float)
    group.add_argument("--muon_adam_betas", default="0.9,0.95")
    group.add_argument("--muon_adam_eps", type=float, default=1e-8)


class SingleDeviceMuonWithAdamW(torch.optim.Optimizer):
    def __init__(self, groups):
        try:
            from muon import adam_update, muon_update
        except ImportError as exc:
            raise ImportError("Muon requires muon-optimizer==0.1.0 in the Anima training environment.") from exc
        super().__init__(groups, {})
        self._adam_update = adam_update
        self._muon_update = muon_update

    @torch.no_grad()
    def step(self, closure=None):
        loss = None
        if closure is not None:
            with torch.enable_grad():
                loss = closure()
        for group in self.param_groups:
            for param in group["params"]:
                grad = param.grad
                if grad is None:
                    continue
                state = self.state[param]
                if group["use_muon"]:
                    if not state:
                        state["momentum_buffer"] = torch.zeros_like(param)
                    update = self._muon_update(
                        grad, state["momentum_buffer"], beta=group["momentum"], ns_steps=group["ns_steps"]
                    )
                else:
                    if not state:
                        state["exp_avg"] = torch.zeros_like(param)
                        state["exp_avg_sq"] = torch.zeros_like(param)
                        state["step"] = 0
                    state["step"] += 1
                    update = self._adam_update(
                        grad, state["exp_avg"], state["exp_avg_sq"], state["step"], group["betas"], group["eps"]
                    )
                param.mul_(1 - group["lr"] * group["weight_decay"])
                param.add_(update, alpha=-group["lr"])
        return loss


def build_optimizer(args, param_groups):
    betas = tuple(float(beta.strip()) for beta in args.muon_adam_betas.split(","))
    if len(betas) != 2 or not all(0 <= beta < 1 for beta in betas):
        raise ValueError("--muon_adam_betas requires two values in [0, 1).")
    if not 0 <= args.muon_momentum < 1 or args.muon_ns_steps < 1:
        raise ValueError("Muon requires momentum in [0, 1) and at least one Newton–Schulz step.")
    muon_lr = args.muon_lr * args.muon_lr_scale
    if not all(math.isfinite(x) and x > 0 for x in (args.muon_lr, args.muon_lr_scale, muon_lr, args.muon_adam_eps)):
        raise ValueError("Muon learning rates, scale and Adam epsilon must be positive and finite.")
    if not math.isfinite(args.muon_weight_decay) or args.muon_weight_decay < 0:
        raise ValueError("Muon weight decay must be finite and nonnegative.")
    if args.muon_adam_lr is not None and (not math.isfinite(args.muon_adam_lr) or args.muon_adam_lr < 0):
        raise ValueError("Muon auxiliary AdamW learning rate must be finite and nonnegative.")

    groups = []
    for group in param_groups:
        matrices = []
        auxiliary = []
        for param in group["params"]:
            if not param.requires_grad:
                continue
            name = param.original_name
            if param.ndim == 2 and "llm_adapter" not in name and "adaln_modulation" not in name:
                matrices.append(param)
            else:
                auxiliary.append(param)
        if matrices:
            groups.append(dict(
                params=matrices, use_muon=True, lr=muon_lr * group["lr"] / (args.learning_rate or 1.0),
                momentum=args.muon_momentum, ns_steps=args.muon_ns_steps, weight_decay=args.muon_weight_decay,
            ))
        if auxiliary:
            groups.append(dict(
                params=auxiliary, use_muon=False, lr=group["lr"] if args.muon_adam_lr is None else args.muon_adam_lr,
                betas=betas, eps=args.muon_adam_eps, weight_decay=0.0,
            ))
    if not any(group["use_muon"] for group in groups):
        raise ValueError("Muon requires at least one trainable Anima DiT weight matrix.")
    return SingleDeviceMuonWithAdamW(groups)
