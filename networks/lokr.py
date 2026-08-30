# LoKr (Low-rank Kronecker Product) network module
# Reference: https://arxiv.org/abs/2309.14859
#
# Based on the LyCORIS project by KohakuBlueleaf
# https://github.com/KohakuBlueleaf/LyCORIS

import math
import os
import logging
import json
from typing import Dict, List, Optional

import torch
import torch.nn as nn
import torch.nn.functional as F

from .network_base import (
    ArchConfig,
    AdditionalNetwork,
    detect_arch_config,
    _parse_kv_pairs,
    _parse_anima_kwargs,
    _parse_common_create_network_kwargs,
    _apply_loraplus_from_kwargs,
    _is_tp_active,
)
from library.utils import setup_logging
from library.i18n import tr

setup_logging()
logger = logging.getLogger(__name__)


def _to_bool(value, default=False):
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in ("1", "true", "yes", "y", "on")


def factorization(dimension: int, factor: int = -1) -> tuple:
    """Return a tuple of two values whose product equals dimension,
    optimized for balanced factors.

    In LoKr, the first value is for the weight scale (smaller),
    and the second value is for the weight (larger).

    Examples:
        factor=-1: 128 -> (8, 16), 512 -> (16, 32), 1024 -> (32, 32)
        factor=4:  128 -> (4, 32), 512 -> (4, 128)
    """
    if factor > 0 and (dimension % factor) == 0:
        m = factor
        n = dimension // factor
        if m > n:
            n, m = m, n
        return m, n
    if factor < 0:
        factor = dimension
    m, n = 1, dimension
    length = m + n
    while m < n:
        new_m = m + 1
        while dimension % new_m != 0:
            new_m += 1
        new_n = dimension // new_m
        if new_m + new_n > length or new_m > factor:
            break
        else:
            m, n = new_m, new_n
    if m > n:
        n, m = m, n
    return m, n


def _infer_lokr_factor_from_weights(weights_sd):
    """Recover the global LoKr factor from saved tensor shapes, for checkpoints with no
    metadata (.pt / .ckpt / --no_metadata). Returns a factor that reproduces every saved
    module's factorization, else -1. A wrong guess can only fail louder downstream
    (load_state_dict size check) — it can never silently mis-load, because the merge path
    no longer depends on factor. Tucker modules are skipped (ambiguous w2 orientation)."""
    mods = []
    for key in list(weights_sd.keys()):
        if not key.endswith(".lokr_w1"):
            continue
        name = key[: -len(".lokr_w1")]
        if (name + ".lokr_t2") in weights_sd:
            continue
        w1 = weights_sd[key]
        out_l, in_m = int(w1.shape[0]), int(w1.shape[1])
        if (name + ".lokr_w2") in weights_sd:
            w2 = weights_sd[name + ".lokr_w2"]
            out_k, in_n = int(w2.shape[0]), int(w2.shape[1])
        else:
            w2a = weights_sd.get(name + ".lokr_w2_a")
            w2b = weights_sd.get(name + ".lokr_w2_b")
            if w2a is None or w2b is None:
                continue
            out_k, in_n = int(w2a.shape[0]), int(w2b.shape[1])
        mods.append((in_m * in_n, out_l * out_k, in_m, in_n, out_l, out_k))
    candidates = set()
    for (_, _, in_m, in_n, out_l, out_k) in mods:
        candidates.update((in_m, in_n, out_l, out_k))
    for cand in sorted(candidates):
        if cand > 0 and all(
            factorization(idim, cand) == (im, iN) and factorization(odim, cand) == (ol, ok)
            for (idim, odim, im, iN, ol, ok) in mods
        ):
            return cand
    return -1


def make_kron(w1, w2, scale):
    """Compute Kronecker product of w1 and w2, scaled by scale."""
    if w1.dim() != w2.dim():
        for _ in range(w2.dim() - w1.dim()):
            w1 = w1.unsqueeze(-1)
    w2 = w2.contiguous()
    rebuild = torch.kron(w1, w2)
    if scale != 1:
        rebuild = rebuild * scale
    return rebuild


def _rebuild_lokr_weight_from_state(sd: Dict[str, torch.Tensor], target_shape=None) -> torch.Tensor:
    """Rebuild a LoKr delta from one module's state dict.

    ``sd`` uses local (prefix-stripped) names such as ``lokr_w1``.  The scale is
    derived from the checkpoint tensors rather than constructor-time settings so
    conversion and merge paths also work for factor-inferred checkpoints.
    """
    w1 = sd["lokr_w1"]
    alpha = sd.get("alpha")
    if isinstance(alpha, torch.Tensor):
        alpha = float(alpha.detach().float().item())
    elif alpha is not None:
        alpha = float(alpha)

    if "lokr_w2" in sd:
        w2 = sd["lokr_w2"]
        scale = 1.0
    elif "lokr_t2" in sd:
        w2a = sd["lokr_w2_a"]
        w2b = sd["lokr_w2_b"]
        w2 = rebuild_tucker(sd["lokr_t2"], w2a, w2b)
        dim = int(w2a.shape[0])
        scale = (alpha if alpha is not None else dim) / dim
    else:
        w2a = sd["lokr_w2_a"]
        w2b = sd["lokr_w2_b"]
        w2 = w2a @ w2b
        dim = int(w2a.shape[1])
        scale = (alpha if alpha is not None else dim) / dim

    diff = make_kron(w1, w2, scale)
    if target_shape is not None and tuple(diff.shape) != tuple(target_shape):
        diff = diff.reshape(target_shape)
    return diff


def _weight_row_norm(weight: torch.Tensor) -> torch.Tensor:
    weight = weight.to(torch.float32)
    return torch.linalg.vector_norm(weight.reshape(weight.shape[0], -1), dim=1).reshape(
        weight.shape[0], *([1] * (weight.dim() - 1))
    )


def _merge_dokr_weight(weight: torch.Tensor, diff_weight: torch.Tensor, dora_scale: torch.Tensor) -> torch.Tensor:
    """Return the DoKr effective weight using LyCORIS absolute-magnitude semantics."""
    compute_device = weight.device
    weight_fp32 = weight.to(device=compute_device, dtype=torch.float32)
    diff_fp32 = diff_weight.to(device=compute_device, dtype=torch.float32)
    direction = weight_fp32 + diff_fp32
    direction_norm = _weight_row_norm(direction).detach().clamp_min(torch.finfo(torch.float32).eps)
    magnitude = dora_scale.to(device=compute_device, dtype=torch.float32).reshape(direction_norm.shape)
    return direction * (magnitude / direction_norm)


def _raw_dokr_scale_to_comfy(
    weight: torch.Tensor, diff_weight: torch.Tensor, raw_scale: torch.Tensor
) -> torch.Tensor:
    """Convert LyCORIS absolute magnitude to the scale expected by ComfyUI."""
    base_norm = _weight_row_norm(weight).clamp_min(torch.finfo(torch.float32).eps)
    direction_norm = _weight_row_norm(weight.to(torch.float32) + diff_weight.to(torch.float32)).clamp_min(
        torch.finfo(torch.float32).eps
    )
    raw_scale = raw_scale.to(torch.float32).reshape(direction_norm.shape)
    return raw_scale * base_norm / direction_norm


def _comfy_dokr_scale_to_raw(
    weight: torch.Tensor, diff_weight: torch.Tensor, comfy_scale: torch.Tensor
) -> torch.Tensor:
    """Convert a ComfyUI-exported scale back to LyCORIS absolute magnitude."""
    base_norm = _weight_row_norm(weight).clamp_min(torch.finfo(torch.float32).eps)
    direction_norm = _weight_row_norm(weight.to(torch.float32) + diff_weight.to(torch.float32)).clamp_min(
        torch.finfo(torch.float32).eps
    )
    comfy_scale = comfy_scale.to(torch.float32).reshape(direction_norm.shape)
    return comfy_scale * direction_norm / base_norm


def rebuild_tucker(t, wa, wb):
    """Rebuild weight from Tucker decomposition: einsum("i j ..., i p, j r -> p r ...", t, wa, wb).

    Compatible with LyCORIS convention.
    """
    return torch.einsum("i j ..., i p, j r -> p r ...", t, wa, wb)


class LoKrModule(torch.nn.Module):
    """LoKr module for training. Replaces forward method of the original Linear/Conv2d."""

    def __init__(
        self,
        lora_name,
        org_module: torch.nn.Module,
        multiplier=1.0,
        lora_dim=4,
        alpha=1,
        dropout=None,
        rank_dropout=None,
        module_dropout=None,
        factor=-1,
        use_tucker=False,
        use_dora=False,
        **kwargs,
    ):
        super().__init__()
        self.lora_name = lora_name
        self.lora_dim = lora_dim

        is_conv2d = org_module.__class__.__name__ == "Conv2d"
        if is_conv2d:
            in_dim = org_module.in_channels
            out_dim = org_module.out_channels
            kernel_size = org_module.kernel_size
            self.is_conv = True
            self.stride = org_module.stride
            self.padding = org_module.padding
            self.dilation = org_module.dilation
            self.groups = org_module.groups
            self.kernel_size = kernel_size

            self.tucker = use_tucker and any(k != 1 for k in kernel_size)

            if kernel_size == (1, 1):
                self.conv_mode = "1x1"
            elif self.tucker:
                self.conv_mode = "tucker"
            else:
                self.conv_mode = "flat"
        else:
            in_dim = org_module.in_features
            out_dim = org_module.out_features
            self.is_conv = False
            self.tucker = False
            self.conv_mode = None
            self.kernel_size = None

        self.in_dim = in_dim
        self.out_dim = out_dim
        self.use_dora = _to_bool(use_dora)
        if self.use_dora and org_module.__class__.__name__ != "Linear":
            raise ValueError(
                f"DoKr only supports ordinary Linear layers, got {org_module.__class__.__name__} for {lora_name}."
            )

        factor = int(factor)
        self.use_w2 = False

        in_m, in_n = factorization(in_dim, factor)
        out_l, out_k = factorization(out_dim, factor)
        self.lokr_w1 = nn.Parameter(torch.empty(out_l, in_m))

        if self.conv_mode in ("tucker", "flat"):
            k_size = kernel_size
            if lora_dim >= max(out_k, in_n) / 2:
                self.use_w2 = True
                self.lokr_w2 = nn.Parameter(torch.empty(out_k, in_n, *k_size))
                logger.warning(
                    f"LoKr: lora_dim {lora_dim} is large for dim={max(in_dim, out_dim)} "
                    f"and factor={factor}, using full matrix mode for Conv2d."
                )
            elif self.tucker:
                self.lokr_t2 = nn.Parameter(torch.empty(lora_dim, lora_dim, *k_size))
                self.lokr_w2_a = nn.Parameter(torch.empty(lora_dim, out_k))
                self.lokr_w2_b = nn.Parameter(torch.empty(lora_dim, in_n))
            else:
                k_prod = 1
                for k in k_size:
                    k_prod *= k
                self.lokr_w2_a = nn.Parameter(torch.empty(out_k, lora_dim))
                self.lokr_w2_b = nn.Parameter(torch.empty(lora_dim, in_n * k_prod))
        else:
            if lora_dim < max(out_k, in_n) / 2:
                self.lokr_w2_a = nn.Parameter(torch.empty(out_k, lora_dim))
                self.lokr_w2_b = nn.Parameter(torch.empty(lora_dim, in_n))
            else:
                self.use_w2 = True
                self.lokr_w2 = nn.Parameter(torch.empty(out_k, in_n))
                logger.warning(
                    f"LoKr: lora_dim {lora_dim} is large for dim={max(in_dim, out_dim)} "
                    f"and factor={factor}, using full matrix mode."
                )

        if isinstance(alpha, torch.Tensor):
            alpha = alpha.detach().cpu().float().item()
        alpha = lora_dim if alpha is None or alpha == 0 else alpha
        if self.use_w2:
            alpha = lora_dim  # both matrices full → scale = 1
        self.scale = alpha / self.lora_dim
        self.register_buffer("alpha", torch.tensor(alpha))

        torch.nn.init.kaiming_uniform_(self.lokr_w1, a=math.sqrt(5))
        if self.use_w2:
            torch.nn.init.constant_(self.lokr_w2, 0)
        else:
            if self.tucker:
                torch.nn.init.kaiming_uniform_(self.lokr_t2, a=math.sqrt(5))
            torch.nn.init.kaiming_uniform_(self.lokr_w2_a, a=math.sqrt(5))
            torch.nn.init.constant_(self.lokr_w2_b, 0)  # ΔW = kron(w1, 0) = 0 at init

        self.multiplier = multiplier
        self.org_module = org_module  # remove in applying
        if self.use_dora:
            # Keep the frozen base module reachable without registering it as a child
            # module (a list is intentional). DoKr needs its weight for normalization.
            self.org_module_ref = [org_module]
            self.enabled = True
            with torch.no_grad():
                self.dora_scale = nn.Parameter(_weight_row_norm(org_module.weight).float())
        self.dropout = dropout
        self.rank_dropout = rank_dropout
        self.module_dropout = module_dropout

    def apply_to(self):
        self.org_forward = self.org_module.forward
        self.org_module.forward = self.forward
        del self.org_module

    def get_diff_weight(self):
        """Return materialized weight delta.

        Returns:
            - Linear: 2D tensor (out_dim, in_dim)
            - Conv2d 1x1: 2D tensor (out_dim, in_dim) — caller should unsqueeze for F.conv2d
            - Conv2d 3x3+ Tucker/full: 4D tensor (out_dim, in_dim, k1, k2)
            - Conv2d 3x3+ flat: 4D tensor (out_dim, in_dim, k1, k2) — reshaped from 2D
        """
        w1 = self.lokr_w1

        if self.use_w2:
            w2 = self.lokr_w2
        elif self.tucker:
            w2 = rebuild_tucker(self.lokr_t2, self.lokr_w2_a, self.lokr_w2_b)
        else:
            w2 = self.lokr_w2_a @ self.lokr_w2_b

        result = make_kron(w1, w2, self.scale)

        if self.conv_mode == "flat" and result.dim() == 2:
            result = result.reshape(self.out_dim, self.in_dim, *self.kernel_size)

        return result

    def forward(self, x):
        org_forwarded = self.org_forward(x)

        if self.use_dora and not getattr(self, "enabled", True):
            return org_forwarded

        if self.module_dropout is not None and self.training:
            if torch.rand(1) < self.module_dropout:
                return org_forwarded

        # Neuron dropout: regularize the adapter's input activations only (the frozen
        # base path above already used the full x). Mirrors lora_anima.py; without this a
        # set network_dropout was logged as active (network_base.py) but never applied.
        if self.dropout is not None and self.dropout > 0 and self.training:
            x = F.dropout(x, p=self.dropout)

        diff_weight = self.get_diff_weight()

        if self.rank_dropout is not None and self.training:
            drop = (torch.rand(diff_weight.size(0), device=diff_weight.device) > self.rank_dropout).to(diff_weight.dtype)
            drop = drop.view(-1, *([1] * (diff_weight.dim() - 1)))
            diff_weight = diff_weight * drop
            # rank_dropout == 1.0 (the UI permits it) drops everything; guard the
            # 1/(1-p) division so the degenerate "drop all" case yields 0, not a crash.
            scale = 1.0 / (1.0 - self.rank_dropout) if self.rank_dropout < 1.0 else 0.0
        else:
            scale = 1.0

        # Adapter params stay fp32; the AdaLN fp32-stability path (anima_models.py) runs
        # with autocast off and feeds fp16 x, so F.linear(fp16, fp32) would crash. Cast the
        # delta to x's dtype — the patched-LoRA matmul is meant to stay in x's dtype.
        diff_weight = diff_weight.to(x.dtype)

        if self.is_conv:
            if self.conv_mode == "1x1":
                diff_weight = diff_weight.unsqueeze(2).unsqueeze(3)
                return org_forwarded + F.conv2d(
                    x, diff_weight, stride=self.stride, padding=self.padding,
                    dilation=self.dilation, groups=self.groups
                ) * self.multiplier * scale
            else:
                # Conv2d 3x3+: diff_weight is already 4D from get_diff_weight
                return org_forwarded + F.conv2d(
                    x, diff_weight, stride=self.stride, padding=self.padding,
                    dilation=self.dilation, groups=self.groups
                ) * self.multiplier * scale
        else:
            diff_output = F.linear(x, diff_weight) * scale
            if not self.use_dora:
                return org_forwarded + diff_output * self.multiplier

            org_module = self.org_module_ref[0]
            base_weight = org_module.weight.to(device=diff_weight.device, dtype=torch.float32)
            direction_weight = base_weight + diff_weight.to(torch.float32) * float(scale)
            direction_norm = _weight_row_norm(direction_weight).detach().clamp_min(
                torch.finfo(torch.float32).eps
            )
            dora_factor = (
                self.dora_scale.to(device=x.device, dtype=torch.float32).reshape(direction_norm.shape)
                / direction_norm.to(x.device)
            ).to(org_forwarded.dtype)
            dora_factor = dora_factor.reshape(*([1] * (org_forwarded.dim() - 1)), self.out_dim)

            base_without_bias = org_forwarded
            if org_module.bias is not None:
                base_without_bias = base_without_bias - org_module.bias.to(
                    device=org_forwarded.device, dtype=org_forwarded.dtype
                )
            dokr_output = dora_factor * (base_without_bias + diff_output)
            return org_forwarded + (dokr_output - base_without_bias) * float(self.multiplier)

    @property
    def device(self):
        return next(self.parameters()).device

    @property
    def dtype(self):
        return next(self.parameters()).dtype


class LoKrInfModule(LoKrModule):
    """LoKr module for inference. Supports merge_to and get_weight."""

    def __init__(
        self,
        lora_name,
        org_module: torch.nn.Module,
        multiplier=1.0,
        lora_dim=4,
        alpha=1,
        **kwargs,
    ):
        factor = kwargs.pop("factor", -1)
        use_tucker = kwargs.pop("use_tucker", False)
        use_dora = kwargs.pop("use_dora", False)
        super().__init__(
            lora_name,
            org_module,
            multiplier,
            lora_dim,
            alpha,
            factor=factor,
            use_tucker=use_tucker,
            use_dora=use_dora,
        )

        self.org_module_ref = [org_module]
        self.enabled = True
        self.network: AdditionalNetwork = None

    def set_network(self, network):
        self.network = network

    def merge_to(self, sd, dtype, device):
        # org_module_ref survives apply_to() which del's self.org_module
        org_module = self.org_module_ref[0]
        org_sd = org_module.state_dict()
        weight = org_sd["weight"]
        org_dtype = weight.dtype
        org_device = weight.device
        weight = weight.to(torch.float)

        if dtype is None:
            dtype = org_dtype
        if device is None:
            device = org_device

        sd_on_device = {
            key: value.to(torch.float32).to(device) if isinstance(value, torch.Tensor) else value
            for key, value in sd.items()
        }
        diff_weight = _rebuild_lokr_weight_from_state(sd_on_device, weight.shape)
        weight = weight.to(device)
        if self.use_dora:
            dora_scale = sd_on_device.get("dora_scale", self.dora_scale.detach().to(device))
            merged = _merge_dokr_weight(weight, diff_weight, dora_scale)
            weight = weight + (merged - weight) * float(self.multiplier)
        else:
            weight = weight + self.multiplier * diff_weight

        org_sd["weight"] = weight.to(dtype)
        org_module.load_state_dict(org_sd)

    def get_weight(self, multiplier=None):
        if multiplier is None:
            multiplier = self.multiplier

        w1 = self.lokr_w1.to(torch.float)

        if self.use_w2:
            w2 = self.lokr_w2.to(torch.float)
        elif self.tucker:
            w2 = rebuild_tucker(
                self.lokr_t2.to(torch.float),
                self.lokr_w2_a.to(torch.float),
                self.lokr_w2_b.to(torch.float),
            )
        else:
            w2 = (self.lokr_w2_a @ self.lokr_w2_b).to(torch.float)

        diff_weight = make_kron(w1, w2, self.scale)

        if self.use_dora:
            org_weight = self.org_module_ref[0].weight.detach().to(
                device=diff_weight.device, dtype=torch.float32
            )
            if tuple(diff_weight.shape) != tuple(org_weight.shape):
                diff_weight = diff_weight.reshape(org_weight.shape)
            merged = _merge_dokr_weight(org_weight, diff_weight, self.dora_scale)
            return (merged - org_weight) * float(multiplier)

        weight = diff_weight * multiplier

        if self.is_conv:
            if self.conv_mode == "1x1":
                weight = weight.unsqueeze(2).unsqueeze(3)
            elif self.conv_mode == "flat" and weight.dim() == 2:
                weight = weight.reshape(self.out_dim, self.in_dim, *self.kernel_size)

        return weight

    def default_forward(self, x):
        return super().forward(x)

    def forward(self, x):
        if not self.enabled:
            return self.org_forward(x)
        return self.default_forward(x)


class LoKrNetwork(AdditionalNetwork):
    """AdditionalNetwork with DoKr checkpoint conversion and precision handling."""

    def __init__(self, *args, use_dora=False, dora_scale_fp32=False, **kwargs):
        self.use_dora = _to_bool(use_dora)
        self.dora_scale_fp32 = _to_bool(dora_scale_fp32)
        self.dora_scale_format = None
        super().__init__(*args, **kwargs)
        if self.use_dora:
            logger.info(tr("dokr_enabled"))
            if self.dora_scale_fp32:
                logger.info(tr("dokr_scale_fp32_enabled"))

    @staticmethod
    def _metadata_for_file(file):
        if file is None or os.path.splitext(str(file))[1] != ".safetensors":
            return {}
        try:
            from safetensors import safe_open

            with safe_open(file, framework="pt") as f:
                return f.metadata() or {}
        except Exception:
            return {}

    @staticmethod
    def _local_module_state(state_dict, prefix, device):
        local = {}
        prefix_dot = prefix + "."
        for key, value in state_dict.items():
            if key.startswith(prefix_dot):
                local[key[len(prefix_dot) :]] = (
                    value.detach().to(device=device, dtype=torch.float32)
                    if isinstance(value, torch.Tensor)
                    else value
                )
        return local

    def _convert_dora_scales(self, state_dict, to_comfy):
        if not self.use_dora:
            return state_dict
        converted = dict(state_dict)
        for lora in self.text_encoder_loras + self.unet_loras:
            if not isinstance(lora, LoKrModule) or not lora.use_dora:
                continue
            prefix = lora.lora_name
            dora_key = f"{prefix}.dora_scale"
            if dora_key not in converted:
                continue
            org_weight = lora.org_module_ref[0].weight.detach().to(torch.float32)
            local = self._local_module_state(converted, prefix, org_weight.device)
            try:
                diff_weight = _rebuild_lokr_weight_from_state(local, org_weight.shape)
            except KeyError:
                continue
            if to_comfy:
                converted[dora_key] = _raw_dokr_scale_to_comfy(
                    org_weight, diff_weight, local["dora_scale"]
                )
            else:
                converted[dora_key] = _comfy_dokr_scale_to_raw(
                    org_weight, diff_weight, local["dora_scale"]
                )
        return converted

    def load_weights(self, file):
        metadata = self._metadata_for_file(file)
        if os.path.splitext(file)[1] == ".safetensors":
            from safetensors.torch import load_file

            weights_sd = load_file(file)
        else:
            weights_sd = torch.load(file, map_location="cpu")
        if metadata.get("ss_dora_scale_format") == "comfy_weight_norm":
            weights_sd = self._convert_dora_scales(weights_sd, to_comfy=False)
        return self._load_state_dict_checked(weights_sd, file)

    def merge_to(self, text_encoders, unet, weights_sd, dtype=None, device=None):
        if self.use_dora and self.dora_scale_format == "comfy_weight_norm":
            weights_sd = self._convert_dora_scales(weights_sd, to_comfy=False)
        return super().merge_to(text_encoders, unet, weights_sd, dtype, device)

    def save_weights(self, file, dtype, metadata):
        if metadata is not None and len(metadata) == 0:
            metadata = None

        state_dict = self.state_dict()
        if self.use_dora and os.path.splitext(file)[1] == ".safetensors":
            state_dict = self._convert_dora_scales(state_dict, to_comfy=True)
            if metadata is None:
                metadata = {}
            metadata["ss_dora_scale_format"] = "comfy_weight_norm"

        if dtype is not None:
            for key, value in list(state_dict.items()):
                target_dtype = dtype
                if self.use_dora and self.dora_scale_fp32 and (
                    key.endswith(".dora_scale") or key.endswith(".alpha")
                ):
                    target_dtype = torch.float32
                state_dict[key] = value.detach().clone().to("cpu").to(target_dtype)

        if os.path.splitext(file)[1] == ".safetensors":
            from safetensors.torch import save_file
            from library import train_util

            if metadata is None:
                metadata = {}
            model_hash, legacy_hash = train_util.precalculate_safetensors_hashes(state_dict, metadata)
            metadata["sshs_model_hash"] = model_hash
            metadata["sshs_legacy_hash"] = legacy_hash
            save_file(state_dict, file, metadata)
        else:
            torch.save(state_dict, file)


def create_network(
    multiplier: float,
    network_dim: Optional[int],
    network_alpha: Optional[float],
    vae,
    text_encoder,
    unet,
    neuron_dropout: Optional[float] = None,
    **kwargs,
):
    """Create a LoKr network. Called by train_network.py via network_module.create_network()."""
    if _is_tp_active(unet):
        raise NotImplementedError(
            "LoKr does not support TP/SP yet; use networks.lora_anima for multi-GPU runs."
        )

    if network_dim is None:
        network_dim = 4
    if network_alpha is None:
        network_alpha = 1.0

    text_encoders = text_encoder if isinstance(text_encoder, list) else [text_encoder]
    arch_config = detect_arch_config(unet, text_encoders)
    type_dims, emb_dims, train_block_indices = _parse_anima_kwargs(kwargs, unet)
    common = _parse_common_create_network_kwargs(kwargs, arch_config)
    factor = int(kwargs.get("factor", -1))
    use_dora = _to_bool(kwargs.get("use_dora", False))
    dora_scale_fp32 = _to_bool(kwargs.get("dora_scale_fp32", False))

    network = LoKrNetwork(
        text_encoders,
        unet,
        use_dora=use_dora,
        dora_scale_fp32=dora_scale_fp32,
        arch_config=arch_config,
        multiplier=multiplier,
        lora_dim=network_dim,
        alpha=network_alpha,
        dropout=neuron_dropout,
        rank_dropout=common["rank_dropout"],
        module_dropout=common["module_dropout"],
        module_class=LoKrModule,
        module_kwargs={"factor": factor, "use_tucker": common["use_tucker"], "use_dora": use_dora},
        conv_lora_dim=common["conv_lora_dim"],
        conv_alpha=common["conv_alpha"],
        train_llm_adapter=common["train_llm_adapter"],
        exclude_patterns=common["exclude_patterns"],
        include_patterns=common["include_patterns"],
        reg_dims=common["reg_dims"],
        reg_lrs=common["reg_lrs"],
        type_dims=type_dims,
        emb_dims=emb_dims,
        train_block_indices=train_block_indices,
        verbose=common["verbose"],
    )
    _apply_loraplus_from_kwargs(network, kwargs)
    return network


def create_network_from_weights(multiplier, file, vae, text_encoder, unet, weights_sd=None, for_inference=False, **kwargs):
    """Create a LoKr network from saved weights. Called by train_network.py."""
    if _is_tp_active(unet):
        raise NotImplementedError(
            "LoKr does not support TP/SP yet; use networks.lora_anima for multi-GPU runs."
        )

    metadata = LoKrNetwork._metadata_for_file(file)
    if weights_sd is None:
        if os.path.splitext(file)[1] == ".safetensors":
            from safetensors.torch import load_file

            weights_sd = load_file(file)
        else:
            weights_sd = torch.load(file, map_location="cpu")

    modules_dim = {}
    modules_alpha = {}
    train_llm_adapter = False
    use_tucker = False
    use_dora = _to_bool(kwargs.get("use_dora", False))
    for key, value in weights_sd.items():
        if "." not in key:
            continue

        lora_name = key.split(".")[0]
        if key.endswith(".dora_scale"):
            use_dora = True
        if "alpha" in key:
            modules_alpha[lora_name] = value
        elif "lokr_w2_a" in key:
            # Tucker: w2_a = (rank, out_k); non-Tucker: w2_a = (out_k, rank)
            if lora_name + ".lokr_t2" in weights_sd:
                dim = value.shape[0]
            else:
                dim = value.shape[1]
            modules_dim[lora_name] = dim
        elif "lokr_w2" in key and "lokr_w2_a" not in key and "lokr_w2_b" not in key:
            # full-matrix mode
            if lora_name not in modules_dim:
                modules_dim[lora_name] = max(value.shape[0], value.shape[1])

        if "lokr_t2" in key:
            use_tucker = True

        if "llm_adapter" in lora_name:
            train_llm_adapter = True

    text_encoders = text_encoder if isinstance(text_encoder, list) else [text_encoder]
    arch_config = detect_arch_config(unet, text_encoders)
    # LoKr state_dict does not store `factor`. Recover it (in priority order) from explicit
    # kwargs, the safetensors metadata (ss_network_args), or — for .pt/.ckpt/--no_metadata
    # checkpoints — by inferring it from the saved tensor shapes. A bare default of -1 would
    # mis-shape lokr_w1/lokr_w2 and pick the wrong alpha/scale for a non-default factor.
    if "factor" in kwargs:
        factor = int(kwargs["factor"])
    else:
        factor = None
        if file is not None and str(file).endswith(".safetensors"):
            try:
                from safetensors import safe_open

                with safe_open(file, framework="pt") as f:
                    _meta = f.metadata() or {}
                _net_args = json.loads(_meta["ss_network_args"]) if _meta.get("ss_network_args") else {}
                if "factor" in _net_args:
                    factor = int(_net_args["factor"])
            except Exception:
                factor = None
        if factor is None:
            factor = _infer_lokr_factor_from_weights(weights_sd)

    module_class = LoKrInfModule if for_inference else LoKrModule
    module_kwargs = {"factor": factor, "use_tucker": use_tucker, "use_dora": use_dora}
    dora_scale_fp32 = _to_bool(kwargs.get("dora_scale_fp32", False))

    network = LoKrNetwork(
        text_encoders,
        unet,
        use_dora=use_dora,
        dora_scale_fp32=dora_scale_fp32,
        arch_config=arch_config,
        multiplier=multiplier,
        modules_dim=modules_dim,
        modules_alpha=modules_alpha,
        module_class=module_class,
        module_kwargs=module_kwargs,
        train_llm_adapter=train_llm_adapter,
    )
    network.dora_scale_format = metadata.get("ss_dora_scale_format")
    return network, weights_sd


def merge_weights_to_tensor(
    model_weight: torch.Tensor,
    lora_name: str,
    lora_sd: Dict[str, torch.Tensor],
    lora_weight_keys: set,
    multiplier: float,
    calc_device: torch.device,
    dora_scale_format: Optional[str] = None,
) -> torch.Tensor:
    """Merge LoKr weights directly into a model weight tensor.

    Supports standard LoKr, DoKr, non-Tucker Conv2d 3x3, and Tucker Conv2d 3x3.
    ``dora_scale_format`` must be ``comfy_weight_norm`` for checkpoints exported
    by this trainer; absent/None uses LyCORIS absolute-magnitude semantics.
    No Module/Network creation needed. Consumed keys are removed from lora_weight_keys.
    Returns model_weight unchanged if no matching LoKr keys found.
    """
    w1_key = lora_name + ".lokr_w1"
    w2_key = lora_name + ".lokr_w2"
    w2a_key = lora_name + ".lokr_w2_a"
    w2b_key = lora_name + ".lokr_w2_b"
    t2_key = lora_name + ".lokr_t2"
    alpha_key = lora_name + ".alpha"
    dora_key = lora_name + ".dora_scale"

    if w1_key not in lora_weight_keys:
        return model_weight

    w1 = lora_sd[w1_key].to(calc_device)

    has_tucker = t2_key in lora_weight_keys

    if w2a_key in lora_weight_keys:
        w2a = lora_sd[w2a_key].to(calc_device)
        w2b = lora_sd[w2b_key].to(calc_device)
        # Tucker: w2a = (rank, out_k); non-Tucker: w2a = (out_k, rank)
        dim = w2a.shape[0] if has_tucker else w2a.shape[1]
        consumed_keys = [w1_key, w2a_key, w2b_key, alpha_key]
        if has_tucker:
            consumed_keys.append(t2_key)
    elif w2_key in lora_weight_keys:
        w2a = None
        w2b = None
        dim = None
        consumed_keys = [w1_key, w2_key, alpha_key]
    else:
        return model_weight

    alpha = lora_sd.get(alpha_key, None)
    if alpha is not None and isinstance(alpha, torch.Tensor):
        alpha = alpha.item()

    if w2a is not None:
        if alpha is None:
            alpha = dim
        scale = alpha / dim
    else:
        scale = 1.0  # full-matrix

    original_dtype = model_weight.dtype
    if original_dtype.itemsize == 1:  # fp8
        model_weight = model_weight.to(torch.float16)
        w1 = w1.to(torch.float16)
        if w2a is not None:
            w2a, w2b = w2a.to(torch.float16), w2b.to(torch.float16)

    if w2a is not None:
        if has_tucker:
            t2 = lora_sd[t2_key].to(calc_device)
            if original_dtype.itemsize == 1:
                t2 = t2.to(torch.float16)
            w2 = rebuild_tucker(t2, w2a, w2b)
        else:
            w2 = w2a @ w2b
    else:
        w2 = lora_sd[w2_key].to(calc_device)
        if original_dtype.itemsize == 1:
            w2 = w2.to(torch.float16)

    diff_weight = make_kron(w1, w2, scale)
    if diff_weight.shape != model_weight.shape:
        diff_weight = diff_weight.reshape(model_weight.shape)

    has_dora = dora_key in lora_weight_keys
    if has_dora:
        dora_scale = lora_sd[dora_key].to(calc_device, dtype=torch.float32)
        base_weight = model_weight.to(calc_device, dtype=torch.float32)
        diff_fp32 = diff_weight.to(calc_device, dtype=torch.float32)
        if dora_scale_format == "comfy_weight_norm":
            base_norm = _weight_row_norm(base_weight).clamp_min(torch.finfo(torch.float32).eps)
            factor = dora_scale.reshape(base_norm.shape) / base_norm
            merged_weight = (base_weight + diff_fp32) * factor
        else:
            merged_weight = _merge_dokr_weight(base_weight, diff_fp32, dora_scale)
        model_weight = base_weight + (merged_weight - base_weight) * float(multiplier)
        consumed_keys.append(dora_key)
    else:
        model_weight = model_weight + multiplier * diff_weight

    if original_dtype.itemsize == 1 or has_dora:
        model_weight = model_weight.to(original_dtype)

    for key in consumed_keys:
        lora_weight_keys.discard(key)

    return model_weight
