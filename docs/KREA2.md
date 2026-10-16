# Krea 2 LoRA / LoKR

本项目通过独立的 Musubi Tuner 后端提供 Krea 2 训练。固定源码版本为
`f8a1b03794a49239a3539015075f5123d6c07d66`（0.3.6），原始源码保存在
`vendor/musubi-tuner`，本地增加了 Krea2 LoKR 架构识别、全矩阵及恢复/预览支持；
版本、补丁清单和许可证说明见 `vendor/MUSUBI_VERSION.json`。
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
| LoKR | 支持；模块 `musubi_tuner.networks.lokr`，含 Factor、Full Matrix、neuron/rank/module dropout |
| LoHa | UI 不开放 |
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
`rank_dropout`、`module_dropout`、`include_patterns`、`exclude_patterns`、`verbose`。
LoKR 允许 `factor`（-1 自动，或正整数）、`full_matrix=true/false`、两个 dropout、
include/exclude 及 verbose，不接受 LoRA+、DoKr 或 Anima 专用参数。
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

### LoKR 全流程

1. 新建 Krea 2 任务，Network Module 选择 **LoKR (Krea 2)**。所有 DiT Linear 层均为默认目标，
   包括主干、文本融合和输入/输出投影；RMSNorm 和裸 modulation 参数不训练。
2. 在 Network 页配置 **LoKR Factor**（留空或 -1 为自动分解）和 **LoKR Full Matrix**。
   分解模式使用 rank/alpha；rank 足够大时，单层也可能自动变为全矩阵。
   Full Matrix 强制所有层使用完整的两个 Kronecker 因子，rank 不生效，缩放固定为 1。
3. Train 沿用 RAW 缓存和训练流程。开启 sample 时使用训练中的 LoKR 分支在 RAW 上预览，
   默认 52 步、CFG 3.5；采样不会把 LoKR 合并进训练底模。
4. 权重保存为包含 `lokr_w1`、`lokr_w2` 或 `lokr_w2_a/b`、`alpha` 的 safetensors。
   Network Weights 可用于初始化已保存 LoKR；自动启用 `dim_from_weights`，按每层保存形状恢复
   factor 分解和全矩阵/低秩模式。恢复优化器、步数等完整状态则使用 Resume 或 Auto Resume Last State；
   完整状态恢复时保持原任务的模块和网络配置。
5. 在 Prompts 页选择保存的 LoKR 文件，分别选择 RAW 或 Turbo 运行独立采样。
   生成器按权重键自动识别 LoKR，在动态 FP8 量化前合并；支持强度 0 和其他有限数值。
   RAW 使用 CFG>1，Turbo 默认 CFG=1、8 步、mu=1.15。

可直接使用的网络配置片段（其余训练参数沿用新建 Krea2 任务默认值）：

```toml
[network_arguments]
network_module = "musubi_tuner.networks.lokr"
network_dim = 4
network_alpha = 4
network_args = ["factor=4", "full_matrix=false", "rank_dropout=0.1", "module_dropout=0.1"]
```

Krea2 使用独立 Musubi 模块，不能填写 Anima 的 `networks.lokr`。LoKR 控件与 LoRA+
控件随模块切换，配置保存、重新打开任务和训练启动均保留所选模块及参数。

Network 页的“样例层矩阵与参数量”会随 Rank / Factor / Full Matrix 实时更新，列出注意力方阵、
K/V 和 MLP 三类样例的矩阵形状、可训练参数量及其占原始层权重的百分比，并区分手动与自动 Full。
Anima 同样支持此面板，使用明确标注的 Anima 2B 标准样例并应用 Block 0 分层覆盖；
支持 LoRA、LoHa、LoKR 及 DoRA/DoKr 的幅度参数计数。百分比不计底模 bias 和 alpha 缓冲区，
也不是整网占比；目标筛选、其他 Anima 模型尺寸及已加载权重的实际结构需另行核对。

## 验证范围

Krea 2 每次启动训练时自动启用 Musubi `log_config`，将过滤后的启动参数和
TensorBoard 指标写入 `training-ui/jobs/<job>/output/tensorboard/` 下的运行目录。
UI 的 TensorBoard 按钮读取同一目录；尚未重新训练的旧任务仍可读取原来的 `logs/`。
TensorBoard iframe 和新窗口通过 WebUI 同域的 `/tensorboard/…/` 路径访问，
由 WebUI 服务代理到本机 TensorBoard；云端仅需开放 WebUI 端口。
Anima 和 Krea 2 均适用，TensorBoard 内部端口仅监听 `127.0.0.1`。
控制台文本日志继续保存在 job 的 `logs/`。此功能在下一次训练启动后生效，
不会补写已经运行中的训练参数，也不会展开 `dataset_config` 指向的完整数据集配置。

TensorBoard 2.20 仍依赖 `pkg_resources`，而 setuptools 82 起已移除此模块。
依赖文件固定 `setuptools==80.9.0`，安装器也检查 TensorBoard 启动模块。
旧环境若报 `No module named 'pkg_resources'`，可执行
`./venv-krea2/bin/python -m pip install setuptools==80.9.0` 后重新打开 UI 的 TensorBoard。
此修复不需要重建环境或重新启动正在运行的训练。

旧版本安装器若在 Musubi editable 安装阶段报 `No module named 'editables'`，
原因是构建依赖遗漏。更新后的四套锁文件已包含 `editables==0.5`，更新后重新运行
安装器即可。尚未更新时，可在项目根目录执行以下命令完成已同步环境的安装：

```bash
./venv-krea2/bin/python -m pip install editables==0.5
./venv-krea2/bin/python -m pip install --no-deps --no-build-isolation -e ./vendor/musubi-tuner
./venv-krea2/bin/python -c 'from transformers import Qwen3VLModel; import musubi_tuner.krea2_train_network; import torch; print("CUDA available:", torch.cuda.is_available())'
```

旧版安装器的依赖同步会移除锁文件未列出的包，所以手动修复后不要重新运行旧版安装器。

`cd training-ui && npm test` 运行 Anima 回归及 Krea 2 参数、缓存、启动快照、
生成和各阶段停止/失败测试。依赖锁已通过 uv 解析；UI 验证覆盖创建任务、参数保存、
模型切换和生成面板。未配置真实模型时，不代表缓存、训练和生成的 GPU 实测已经通过。

LoKR Python 集成测试在已安装 Krea2 依赖的环境中执行：

```powershell
$env:PYTHONPATH = (Resolve-Path ./vendor/musubi-tuner/src).Path
./venv-krea2/Scripts/python.exe -m pytest vendor/musubi-tuner/tests/test_krea2_lokr.py -q
```

Linux 使用 `PYTHONPATH=vendor/musubi-tuner/src ./venv-krea2/bin/python -m pytest vendor/musubi-tuner/tests/test_krea2_lokr.py -q`。
测试使用随机初始化的缩小版真实 Krea2 DiT，覆盖训练前零增量、梯度更新、safetensors 重载、
Accelerate 模型/优化器状态恢复后下一步一致性、RAW/Turbo 调度下在线分支与加载合并采样的一致性，
以及 bf16 底模/fp32 适配器预览。VAE 在解码边界使用替身；不下载真实模型，也不验证图像质量。

2026-10-16 本机验证：UI/后端 Node 测试 81 项通过；LoKR 集成测试及已有 LoRA dtype 回归
共 24 项通过，包含生产配置 264 个 Linear 目标层检查和动态 FP8 合并顺序检查。
Python 测试使用隔离的 Python 3.13 / PyTorch 2.14.1 CPU 环境、Accelerate 1.15.0，
不等同于安装器锁定的 Python 3.12 / CUDA 环境验证。真实权重缓存、训练和 GPU 出图尚未执行。
