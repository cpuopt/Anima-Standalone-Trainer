import argparse
import os
import sys

import torch
from safetensors import safe_open
from safetensors.torch import load_file, save_file

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from library import anima_utils
from networks import lora_anima


def read_metadata(path):
    try:
        with safe_open(path, framework="pt") as f:
            return f.metadata() or {}
    except Exception:
        return {}


def convert(input_path, output_path, dit_path, force=False):
    metadata = read_metadata(input_path)
    if metadata.get("ss_dora_scale_format") == "comfy_weight_norm" and not force:
        raise ValueError(
            f"{input_path} is already marked as ComfyUI dora_scale format. "
            "Use --force only if you know it still needs conversion."
        )

    weights_sd = load_file(input_path, device="cpu")
    if not any(key.endswith(".dora_scale") for key in weights_sd):
        raise ValueError(f"{input_path} does not contain any .dora_scale tensors")

    dit = anima_utils.load_anima_dit(
        dit_path,
        dtype=torch.float32,
        transformer_dtype=torch.float32,
        device="cpu",
        disable_mmap=True,
    )
    network, _ = lora_anima.create_network_from_weights(
        1.0,
        input_path,
        None,
        [],
        dit,
        weights_sd=weights_sd,
        use_dora=True,
        metadata={},
    )
    converted = network._state_dict_to_comfy_dora_scale(weights_sd)

    out_metadata = dict(metadata)
    out_metadata["ss_dora_scale_format"] = "comfy_weight_norm"
    save_file(converted, output_path, out_metadata)
    return output_path


def main():
    parser = argparse.ArgumentParser(description="Convert Anima DoRA dora_scale tensors to ComfyUI-compatible scale format.")
    parser.add_argument("input", help="Input Anima DoRA safetensors trained before the Comfy dora_scale export fix.")
    parser.add_argument("output", nargs="?", help="Output safetensors path. Defaults to <input>-comfy.safetensors")
    parser.add_argument("--dit_path", required=True, help="Base Anima DiT safetensors used for training.")
    parser.add_argument("--force", action="store_true", help="Convert even if metadata says the file is already ComfyUI formatted.")
    args = parser.parse_args()

    input_path = os.path.abspath(args.input)
    if args.output:
        output_path = os.path.abspath(args.output)
    else:
        root, ext = os.path.splitext(input_path)
        output_path = root + "-comfy" + ext

    convert(input_path, output_path, os.path.abspath(args.dit_path), args.force)
    print(f"saved ComfyUI-compatible DoRA: {output_path}")


if __name__ == "__main__":
    main()
