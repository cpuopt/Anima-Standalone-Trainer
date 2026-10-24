# Krea 2 依赖安装与模型下载

本项目使用独立的 Musubi Tuner 环境训练 Krea 2 LoRA / LoKR。依赖安装与模型下载是两个步骤，安装脚本不会自动下载大模型权重。

## 1. 安装 Musubi 依赖

需要 Python **3.12**。Windows 在项目根目录执行：

```powershell
cd C:\Users\rby20\Desktop\Anima-Standalone-Trainer
py -3.12 --version
.\setup_krea2.bat
```

默认创建项目内的 `venv-krea2`，按锁文件安装 PyTorch 2.7.1 + CUDA 12.8 及其他依赖，再安装本地 `vendor/musubi-tuner`，不修改 Anima 环境。

如需指定 CUDA 版本或环境目录：

```powershell
.\setup_krea2.bat --cuda cu130 --venv D:\venvs\krea2
```

CUDA 选项为 `cu124`、`cu128`、`cu130`、`cu132`，默认 `cu128`。使用自定义环境后，后文中的 `venv-krea2` 路径应相应替换。

可验证依赖与 CUDA：

```powershell
.\venv-krea2\Scripts\python.exe -c "import torch; import musubi_tuner.krea2_train_network; print('CUDA available:', torch.cuda.is_available())"
```

`CUDA available: True` 表示当前环境能使用 CUDA；这不代表模型权重已下载或完整训练验证已完成。首次使用可选择 SDPA，默认依赖不包含 FlashAttention、xformers 等可选组件。

## 2. 下载工具与访问权限

使用 [Hugging Face 官方 CLI `hf`](https://huggingface.co/docs/huggingface_hub/guides/cli)。安装好上面的环境后，可通过 `venv-krea2/Scripts/hf.exe` 使用它。

Krea 官方权重需要获得对应仓库的访问权限。先在浏览器中使用自己的 Hugging Face 账号访问：

- [Krea-2-Raw](https://huggingface.co/krea/Krea-2-Raw)：训练及 RAW 采样使用。
- [Krea-2-Turbo](https://huggingface.co/krea/Krea-2-Turbo)：仅使用 Turbo 独立采样时需要。

按仓库页面要求完成访问申请和许可确认，再在终端登录同一个账号：

```powershell
.\venv-krea2\Scripts\hf.exe auth login
```

## 3. Windows 下载命令

以下命令在项目根目录执行，下载到 `D:\models\krea2`。可以修改 `--local-dir` 为自己的模型目录。

```powershell
# RAW DiT：训练必需
.\venv-krea2\Scripts\hf.exe download krea/Krea-2-Raw raw.safetensors --local-dir D:\models\krea2

# 文本编码器：训练及生成必需
.\venv-krea2\Scripts\hf.exe download Comfy-Org/Qwen3-VL text_encoders/qwen3vl_4b_bf16.safetensors --local-dir D:\models\krea2

# VAE：训练及生成必需
.\venv-krea2\Scripts\hf.exe download Comfy-Org/Qwen-Image-Edit_ComfyUI split_files/vae/qwen_image_vae.safetensors --local-dir D:\models\krea2

# Turbo DiT：可选，仅 Turbo 独立采样需要
.\venv-krea2\Scripts\hf.exe download krea/Krea-2-Turbo turbo.safetensors --local-dir D:\models\krea2
```

这些命令只下载指定文件，不下载整个仓库。带目录的文件保留仓库中的相对路径，因此最终主要文件为：

```text
D:\models\krea2\
  raw.safetensors
  turbo.safetensors                    # 可选
  text_encoders\
    qwen3vl_4b_bf16.safetensors
  split_files\vae\
    qwen_image_vae.safetensors
```

使用原始 bf16 权重；本项目的 Dynamic Scaled FP8 在运行时处理，不应将预量化 FP8 DiT 填入这些模型路径。

## 4. Linux 对应命令

在项目根目录执行，需可用的 `python3.12`。可用 `KREA2_PYTHON` 指定另一个 Python 3.12 可执行文件。

```bash
bash setup_krea2.sh

./venv-krea2/bin/hf auth login

./venv-krea2/bin/hf download krea/Krea-2-Raw raw.safetensors --local-dir ./models/krea2
./venv-krea2/bin/hf download Comfy-Org/Qwen3-VL text_encoders/qwen3vl_4b_bf16.safetensors --local-dir ./models/krea2
./venv-krea2/bin/hf download Comfy-Org/Qwen-Image-Edit_ComfyUI split_files/vae/qwen_image_vae.safetensors --local-dir ./models/krea2

# 可选：Turbo 独立采样
./venv-krea2/bin/hf download krea/Krea-2-Turbo turbo.safetensors --local-dir ./models/krea2
```

## 5. 在 UI 中配置

打开 UI 的 **设置**，将实际路径填入 Krea 2 模型路径区域，保存全局设置。Windows 使用上述下载目录时：

| UI 设置 | 填写内容 |
| --- | --- |
| Krea 2 Python 环境 | `C:\Users\rby20\Desktop\Anima-Standalone-Trainer\venv-krea2` |
| Krea 2 RAW DiT | `D:\models\krea2\raw.safetensors` |
| Krea 2 Turbo DiT | `D:\models\krea2\turbo.safetensors`，不用 Turbo 可留空 |
| Qwen3-VL-4B Text Encoder | `D:\models\krea2\text_encoders\qwen3vl_4b_bf16.safetensors` |
| Qwen-Image VAE | `D:\models\krea2\split_files\vae\qwen_image_vae.safetensors` |

Python 环境填写环境目录；四个模型项填写具体 `.safetensors` 文件路径。若 UI 运行在服务器上，应填写服务器能访问的路径；Linux 使用对应的绝对路径。

## 6. 常见问题

- **找不到 `hf.exe` / `hf`**：确认 `setup_krea2` 安装成功，并检查是否使用了 `--venv` 自定义环境目录。优先使用该环境中的完整可执行文件路径。
- **下载返回 401 / 403 或 gated repository**：确认已获得对应 RAW / Turbo 仓库的访问权限，且 CLI 登录的是获得权限的账号。
- **网络中断**：重新执行相同下载命令，保留下载目录及其缓存，避免使用 `--force-download` 强制重下。
- **找不到文本编码器或 VAE**：核对 `text_encoders/` 和 `split_files/vae/` 两层仓库相对路径，没有自动平铺到下载目录根部。
- **下载完成但不能训练**：还需配置数据集和 caption，并检查 Python 环境、CUDA 与模型路径。模型文件存在不等于已通过训练验证。

本指南未执行实际模型下载。模型来源、支持范围与训练说明参见 [Krea 2 说明](KREA2.md)。
