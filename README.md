[IMPORTANT]
> ** Commit [ad401a8](https://github.com/gazingstars123/Anima-Standalone-Trainer/commit/ad401a86f15a7064d5cd914d1c4886cb9dc73c9b) should help stabilize distributed training on Windows. If you're still facing issues and previous fixes did not help, try setting GLOO_SOCKET_IFNAME to different networking devices**

# Anima Standalone Trainer

A lightweight, decoupled training environment for circlestone-labs' Anima model, with LoRA, LoHa, LoKr, DoRA, and DoKr adapter training support. Windows and Linux support. Built upon the [original Anima Standalone Trainer](https://github.com/gazingstars123/Anima-Standalone-Trainer) and [sd-scripts](https://github.com/kohya-ss/sd-scripts).

<img width="2554" height="1234" alt="image" src="https://github.com/user-attachments/assets/cb5ff930-ce8c-49d6-a77a-3da393fe719d" />

## Differences from the Original Repository

This fork contains the original repository through commit [`8cc2c08`](https://github.com/gazingstars123/Anima-Standalone-Trainer/commit/8cc2c08ad8e8ba8e3b9a8c99ab64872dc200a4ae), plus the extensions below. The comparison was last reviewed against upstream `main` at [`79c30b3`](https://github.com/gazingstars123/Anima-Standalone-Trainer/commit/79c30b349503296c207e54a26b3d74b8d5a64747) on 2026-07-25.

| Area | This fork | Original repository |
| --- | --- | --- |
| Anima LoRA training | Supported | Supported |
| Anima LoHa / LoKr | Training, checkpoint reload, and sd-scripts/ComfyUI conversion | Not available |
| Anima DoRA v1 | Single-GPU training with ComfyUI-compatible `dora_scale` weights | Not available |
| Anima DoKr | Single-GPU LoKr weight-decomposition training with ComfyUI-compatible `dora_scale` weights | Not available |
| Per-epoch dataset subsampling | `epoch_sample_rate` with deterministic epoch-based resampling | Not available |
| Muon full-finetune optimizer | Not included | Experimental support through a separate training script |
| DiT checkpoint prefixes | Handles the original `net.` prefix | Also handles `model.diffusion_model.` |
| WSL GPU monitoring | Uses the existing `nvidia-smi` path | Can fall back to Windows host `nvidia-smi.exe` |

### Features added in this fork

- **LoHa and LoKr for Anima:** select `networks.loha` or `networks.lokr` in the Web UI or training configuration. Dedicated controls are provided for LoKr full-matrix mode, factor, modulation dimension, rank/module dropout, and Tucker decomposition. Enable **Full Matrix** or pass `full_matrix=true` to train complete LoKr matrices directly; rank does not affect the matrix structure in this mode. Advanced module selection, per-module dimensions and learning rates, LoRA+, checkpoint structure validation, and LoKr factor recovery are also supported. See [Anima_lora_configs.toml](./Anima_lora_configs.toml).
- **DoRA v1 for Anima LoRA:** enable **Use DoRA** in the Web UI or pass `use_dora=true`. Saved safetensors use ComfyUI-compatible `dora_scale` keys. Enable **Save DoRA Scale in FP32** or pass `dora_scale_fp32=true` to keep `dora_scale` and `alpha` in FP32 while saving the LoRA up/down weights at the global save precision. A conversion utility for checkpoints created before the compatible export fix is available at [networks/convert_anima_dora_to_comfy.py](./networks/convert_anima_dora_to_comfy.py).
- **DoKr for Anima LoKr:** select `networks.lokr` and enable **Use DoKr**, or pass `use_dora=true`. DoKr retains the LoKr tensors and adds a per-output-channel `dora_scale`. Safetensors are exported in the same ComfyUI-compatible scale convention as Anima DoRA; `dora_scale_fp32=true` keeps the magnitude and alpha tensors in FP32.
- **Per-epoch dataset subsampling:** set `epoch_sample_rate` from `0.0` to `1.0` on a dataset subset. The active images and buckets are rebuilt deterministically for each epoch, including with persistent DataLoader workers. See [training-ui/templates/dataset_template.toml](./training-ui/templates/dataset_template.toml).
- **Safer adapter and UI behavior:** incompatible or partially loaded checkpoints now fail explicitly; LoKr reload/merge and fp16 AdaLN paths are hardened; ComfyUI AdaLN key conversion is corrected; and training/sample launch is blocked when UI autosave fails.
- **Localized training logs:** trainer-owned logs support Simplified Chinese, English, and Japanese. Simplified Chinese is the default.

### Current limitations

- LoHa and LoKr do not support TP/SP training, and the bundled `anima_gen.py` does not yet generate with LoHa/LoKr checkpoints.
- DoRA v1 and DoKr support ordinary Linear layers on a single GPU only. TP/SP and max-norm regularization are not supported.
- The following later upstream changes are intentionally not included yet:
  - Experimental Muon optimizer support ([`1eeb4b2`](https://github.com/gazingstars123/Anima-Standalone-Trainer/commit/1eeb4b264a50ea32cd157fb4fbe802c5dbeda35f)).
  - Loading DiT checkpoints with the `model.diffusion_model.` prefix ([`426147f`](https://github.com/gazingstars123/Anima-Standalone-Trainer/commit/426147f185dde6df52d33d9cc080ac53438ffdd2)).
  - WSL GPU monitoring through Windows host `nvidia-smi.exe` ([`79c30b3`](https://github.com/gazingstars123/Anima-Standalone-Trainer/commit/79c30b349503296c207e54a26b3d74b8d5a64747)).


## Prerequisites

- **Python 3.10+** (Python 3.12 recommended)
- **Node.js** (Required for the Web UI)
- **CUDA fitting your system** (CUDA 12.7+ recommended)

## Installation

### 1. Clone the repository
```bash
git clone https://github.com/cpuopt/Anima-Standalone-Trainer.git
cd Anima-Standalone-Trainer
```

### 2. Set up the environment

Run the provided setup script for your operating system:

**Windows:**
```powershell
.\setup_env.bat
```

**Linux:**
```bash
./setup_env.sh
```

*This will create a virtual environment (`venv`), install all Python dependencies (assuming you have met the prereqisites), and set up the Web UI.*

This script will probably install Torch and Torchvision version below.
Depends on your system, you may want to install another version of Pytorch with CUDA.

```cmd
pip install torch==2.7.0 torchvision==0.22.0 --index-url https://download.pytorch.org/whl/cu128
```

## Launching the UI

To start the training server and open the web interface:

**Windows:**
```cmd
.\training-ui\start_training_ui_anima.bat
```

**Linux:**
```bash
./training-ui/start_linux.sh
```
Once launched, open your browser to: `http://localhost:3000`

## Training Log Language

Training logs default to Simplified Chinese. In the Web UI, open **Global Settings → Application → Training Log Language** to select:

- `zh_CN` — Simplified Chinese (default)
- `en` — English
- `ja` — Japanese

For command-line training, use `--console_log_language`, or set the `ANIMA_LOG_LANGUAGE` environment variable:

```bash
python anima_train_network.py --console_log_language en --config_file="./config.toml"
```

Messages emitted by PyTorch, Accelerate, Transformers, and other third-party libraries are not translated by this project and may remain in English.

## First Time Setup

After launching the UI for the first time, you'll need to configure your model paths:

1. Click the ** Global Settings** (gear icon) in the bottom-left corner
2. Set the following paths:
   - **DiT Model Path** — Path to your Anima DiT safetensors file (e.g. `C:\model\anima.safetensors`)
   - **VAE Path** — Path to the VAE model (e.g. `C:\model\qwen_image_vae.safetensors`)  
   - **TE Path** — Path to the CLIP text encoder (e.g. `C:\model\text_encoders\qwen_3_06b_base.safetensors`)
   - **Venv Path** - Path to your local venv, venv can be reused if you redownload the repo
3. Click **Save**

These paths are saved globally and shared across all training jobs.

## Release

**v2.0.0. Linux support, Multi-GPU inference**

**v1.1.0. Improving caching and others I/O performance.**

## Multi-GPU

Tested on torch2.7+cu128 and torch2.10+cu130 with [this fix](https://github.com/pytorch/pytorch/pull/175316) applied on Windows when encountered **libuv** error.

Seems to works best with torch<=2.3 and cuda <= 12.4 without directly applying the fix.

\**NEW\**

Adding support for multi-gpu inference

<img width="1052" height="848" alt="image" src="https://github.com/user-attachments/assets/54192c8f-1501-4a38-b745-3b26499aca5f" />


## Update

To update, simply run this command

```cmd
git pull
```

## Misc

Some features and settings from sd-scripts may not be available or working properly at the momment.

Built and tested on Windows 11, RTX 5080 + RTX 3090, 96GB DDR5, Python 3.12.1, CUDA 13.1, Pytorch 2.10 


