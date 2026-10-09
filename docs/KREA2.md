# Krea 2 LoRA

本项目通过独立的 Musubi Tuner 后端提供 Krea 2 训练。固定源码版本为
`f8a1b03794a49239a3539015075f5123d6c07d66`（0.3.6），原始源码保存在
`vendor/musubi-tuner`，版本和许可证说明见 `vendor/MUSUBI_VERSION.json`。
Musubi 是社区训练工具，Krea 官方推理代码是 [krea-ai/krea-2](https://github.com/krea-ai/krea-2)。
上游将 Krea 2 支持标为实验性，不能视作已经完成本机训练验证。

## 安装和模型

使用 Python 3.12，在项目根目录执行：

```powershell
./setup_krea2.bat
# 指定 CUDA 版本或环境目录：
./setup_krea2.bat --cuda cu130 --venv D:/venvs/krea2
```

Linux 使用 `bash setup_krea2.sh`，可通过 `KREA2_PYTHON` 指定 Python 3.12。
默认 CUDA 为 cu128；另有 cu124、cu130、cu132 锁文件。安装器创建独立的
`venv-krea2`，按锁文件同步依赖并安装本地 Musubi，不修改 Anima 环境。
FlashAttention、xformers 和 Windows torch.compile 所需的 Triton 不在默认依赖中，需自行准备。
首次加载文本编码器可能联网下载 tokenizer 等小文件。

在 UI 的 Global Settings 中配置 Krea 2 Python Environment 和以下单文件权重：

| 设置 | 文件来源 |
| --- | --- |
| RAW | [Krea-2-Raw](https://huggingface.co/krea/Krea-2-Raw) 的 `raw.safetensors` |
| Turbo（仅手动 Turbo 生成需要） | [Krea-2-Turbo](https://huggingface.co/krea/Krea-2-Turbo) 的 `turbo.safetensors` |
| Text Encoder | [Comfy-Org/Qwen3-VL](https://huggingface.co/Comfy-Org/Qwen3-VL) 的 `text_encoders/qwen3vl_4b_bf16.safetensors` |
| VAE | [Comfy-Org/Qwen-Image-Edit_ComfyUI](https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI) 的 `split_files/vae/qwen_image_vae.safetensors` |

使用原始 bf16 权重，显存优化选择 UI 的 Dynamic Scaled FP8；不要配置预量化 FP8 DiT。
文本编码器必须是 safetensors 文件，不能直接指定 Hugging Face 模型目录。
本项目不会自动下载大模型。

## 相对 Anima 的功能范围

以下结论来自固定版本的 [Krea 2 文档](../vendor/musubi-tuner/docs/krea2.md)、
`networks/lora_krea2.py`、共享 LoRA 实现及架构识别代码。

| 功能 | Krea 2 UI / 后端 |
| --- | --- |
| 普通 LoRA，rank/alpha，neuron dropout | 支持；原生模块 `musubi_tuner.networks.lora_krea2` |
| LoRA+、rank dropout、module dropout | 支持；对应 LR ratio 和两个 dropout 控件 |
| 模块 include/exclude 正则 | 支持；Network Args 中传 `include_patterns=[...]` / `exclude_patterns=[...]` |
| DoRA / DoKr | 此 Krea 2 模块无对应实现，隐藏并拒绝相关参数 |
| LoHa / LoKr | 上游虽有共享模块，其架构识别不包含 Krea 2；本项目不开放 |
| Anima layer config / 分层 rank / AdaLN 专用参数 | 未移植，隐藏并拒绝 |
| LLM adapter / embedding / 文本编码器 LoRA | 不开放；仅训练 DiT LoRA |
| 全量微调、ConvRot / Turbo LoRA | 此接入不开放 |
| 多 GPU / TP / SP | 此接入仅支持单 GPU |
| 多图片目录、重复次数、多分辨率、bucket | 支持；分辨率为 16 的倍数且至少 256 |
| caption shuffle/dropout/prefix、flip、alpha mask、正则图 | 当前静态缓存流程不开放，隐藏并拒绝 |
| epoch_sample_rate / progressive resolution | 不开放；不沿用 Anima 动态数据流程 |
| FP8 scaled / block swap / gradient checkpointing / CPU checkpoint offload | 支持；block swap 范围 0–26 |
| SDPA / FlashAttention / xformers | 支持；额外 attention 库需安装；Sage 不开放用于训练 |
| AdamW / AdamW8bit / Adafactor、LR scheduler、梯度累积、seed | 支持；其他 Anima optimizer 不开放 |
| 初始化 LoRA、保存与恢复训练状态、TensorBoard | 支持 |

Network Args 使用空格分隔的 `key=value`；正则列表用 Python 列表语法，例如
`exclude_patterns=['.*text.*']`。允许的额外参数只有 `loraplus_lr_ratio`、
`rank_dropout`、`module_dropout`、`include_patterns`、`exclude_patterns`。
不支持的参数在保存或启动前报错，避免被默默忽略。

## 训练与生成

New 中选 Krea 2，再配置 Dataset。默认：1024 分辨率、batch 1、rank/alpha 32、
bf16、AdamW8bit、LR 1e-4、constant、gradient checkpointing、scaled FP8、
block swap 26、`krea2_shift` 和 `weighting_scheme=none`。这些是显存优化起点，
并非已经在本机测得的显存或质量保证。

Train 依次执行异步环境检查、latent 缓存、文本编码缓存、RAW LoRA 训练。
环境检查最长 60 秒，期间状态查询和 Stop 仍可使用；检查失败或超时会在日志中报告，后续阶段不会启动。
任一阶段失败或点击 Stop，后续阶段不会启动。配置和命令快照为任务目录中的
`_krea2_config.toml`、`_krea2_dataset.toml`、`_krea2_launch.json`。
缓存位于任务独立的 `cache/krea2`；目录、图片路径/大小/修改时间、caption 内容、
分辨率/bucket、VAE/文本编码器路径/大小/修改时间或源码版本变化都会产生新缓存。
原地修改权重或图片后请确保修改时间发生变化。旧缓存保留，需用户自行清理。
同一图片目录内不允许不同扩展名的图片使用同一个文件名 stem，以免上游缓存覆盖。
当前支持 PNG、JPG/JPEG、WEBP、BMP；目录中出现 AVIF/JXL 会在启动前报错，需先转换为支持的格式。
每张图片必须有对应的 caption 文件；缺失时会列出文件并阻止启动，允许显式创建空 caption 文件。

训练采样默认关闭，开启后使用 RAW，prompt 卡片建议 52 步、CFG 3.5。
训练提示词保存为 `_krea2_sample_prompts.json` 快照，未填写负面提示词时使用空文本作为 CFG 的无条件分支。
Prompts 页手动生成使用独立进程，可选 RAW 或 Turbo；Turbo 默认 8 步、CFG 1、
mu 1.15，可加载已保存 LoRA。手动生成步数/CFG 与训练采样分开保存。
多条手动提示词通过 `_krea2_generate_prompts.txt` 快照一次加载模型后依次生成，保留每条提示词的尺寸、seed 和负面提示词。
切换优化器时仅使用该优化器对应的额外参数，避免将 Adafactor 参数传入 AdamW/AdamW8bit。
不启用常驻生成模型，也不在训练进程内切换 RAW/Turbo。
Anima sampler/scheduler/strength prompt 标记不适用于此后端。

## 验证范围

`cd training-ui && npm test` 运行 Anima 回归及 Krea 2 参数、缓存、启动快照、
生成和各阶段停止/失败测试。依赖锁已通过 uv 解析；UI 验证覆盖创建任务、参数保存、
模型切换和生成面板。未配置真实模型时，不代表缓存、训练和生成的 GPU 实测已经通过。
