"""Versioned Anima Block adapter settings shared by LoRA, LoHa and LoKr."""
import json
import math
import re

TYPES = ("self_attn", "cross_attn", "mlp", "modulation")


def layer_type(name):
    match = re.fullmatch(r"blocks\.\d+\.(self_attn|cross_attn|mlp|adaln_modulation_[^.]+)\..+", name)
    if not match:
        return None
    kind = match[1]
    return "modulation" if kind.startswith("adaln_modulation_") else kind


class LayerConfigs:
    def __init__(self, raw, model, allow_factor=False):
        self.data = json.loads(raw) if isinstance(raw, str) else raw
        d = self.data
        if not isinstance(d, dict) or d.get("version") != 1 or d.get("mode") not in ("type", "layer"):
            raise ValueError("layer_configs: expected version 1 and mode type/layer")
        self._positive(d.get("default_rank"), "default_rank", integer=True)
        factor = d.get("default_factor", -1)
        self._factor(factor)
        self.names = {name for name, module in model.named_modules()
                      if layer_type(name) and module.__class__.__name__ in
                      ("Linear", "ColumnParallelLinear", "RowParallelLinear")}
        if not self.names:
            raise ValueError("layer_configs: no supported Anima Block layers found")
        for group in ("types", "layers"):
            entries = d.get(group, {})
            if not isinstance(entries, dict):
                raise ValueError(f"layer_configs.{group} must be an object")
            for name, entry in entries.items():
                if name not in (TYPES if group == "types" else self.names):
                    raise ValueError(f"layer_configs: unknown {group} entry {name}")
                if not isinstance(entry, dict) or set(entry) - {"rank", "alpha", "factor", "enabled"}:
                    raise ValueError(f"layer_configs: invalid settings for {name}")
                if "enabled" in entry and not isinstance(entry["enabled"], bool):
                    raise ValueError(f"layer_configs: enabled must be boolean for {name}")
                if "rank" in entry:
                    self._positive(entry["rank"], f"{name}.rank", integer=True)
                if "alpha" in entry:
                    self._positive(entry["alpha"], f"{name}.alpha")
                if "factor" in entry:
                    self._factor(entry["factor"])
                    if not allow_factor:
                        raise ValueError("layer_configs: per-layer Factor requires LoKr/DoKr")

    @staticmethod
    def _positive(value, name, integer=False):
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0 or (integer and not isinstance(value, int)):
            raise ValueError(f"layer_configs: {name} must be a positive {'integer' if integer else 'number'}")

    @staticmethod
    def _factor(value):
        if isinstance(value, bool) or not isinstance(value, int) or (value != -1 and value <= 0):
            raise ValueError("layer_configs: Factor must be -1 or a positive integer")

    def resolve(self, name):
        if name not in self.names:
            return None
        d = self.data
        values = {"rank": d["default_rank"], "enabled": True, "factor": d.get("default_factor", -1)}
        values.update(d.get("types", {}).get(layer_type(name), {}))
        values.update(d.get("layers", {}).get(name, {}))
        values.setdefault("alpha", values["rank"])
        return values
