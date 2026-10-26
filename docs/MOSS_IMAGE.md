# MOSS-Image：训练、恢复与独立出图

## 支持范围

本项目通过独立的 sd-scripts v0.12.2 后端支持 MOSS-Image Base / SFT，提供 LoRA、LoHa、LoKr（含 factor / full matrix）、断点恢复、训练中采样和独立出图。

- 固定提交：`11d8cedd0c67b93a10f8b2d75f43554f6f12c794`。
- 单张支持 BF16 的 NVIDIA GPU；仅训练 DiT，Qwen3.5-9B 冻结。
- 不支持完整微调、文本编码器训练、多卡、图像编辑或 FP8/GPTQ/NF4 底模。
- Anima 使用原环境与代码，Krea 2 使用原 Musubi 环境，MOSS 使用 `venv-moss`；三者不可混装。
- 源码原样导出在 `vendor/sd-scripts`，来源及逐文件 SHA256 记录在 vendor 清单中。许可证见该后端的 LICENSE.md 与各文件声明。

## 安装

Windows（需要 Python 3.12、Git、更新的 NVIDIA 驱动）：

```powershell
.\setup_moss.bat
```

Linux：

```bash
bash setup_moss.sh
```

默认安装锁定的 PyTorch 2.7.1 CUDA 12.8 环境，不更改其他虚拟环境，也不下载模型。Windows 锁定 triton-windows，Linux 使用 Torch 对应的 Triton。自定义环境目录：

```powershell
py -3.12 scripts/setup_moss.py --venv D:/envs/moss
```

将该目录填入全局设置中的 **MOSS Python 环境**。不可指定已有 Anima/Krea 环境。源码完整性可单独检查：

```powershell
py -3.12 scripts/setup_moss.py --verify-only
.\venv-moss\Scripts\python.exe scripts/moss_runtime.py preflight
```

环境状态接口是 `GET /api/backends/moss_image/status`。状态检查不加载大模型；每次启动仍检查依赖、源码完整性、CUDA 和 BF16。

## 模型下载与配置

推荐先从 Base 开始。以下命令由用户手动执行，下载量较大：

```powershell
.\venv-moss\Scripts\hf.exe download OpenMOSS-Team/MOSS-Image-Base --local-dir C:/models/moss-base --include "transformer/*" "text_encoder/*" "vae/*" "tokenizer/*"
```

Linux 使用 `venv-moss/bin/hf`。SFT 可另外下载 `OpenMOSS-Team/MOSS-Image-SFT`，不要把其路径填入 Base 项。

在全局设置填写：

| 设置 | 示例 / 说明 |
| --- | --- |
| MOSS-Image Base DiT | `C:/models/moss-base/transformer/diffusion_pytorch_model-00001-of-00003.safetensors` |
| MOSS-Image SFT DiT | 可选，SFT 对应的第一分片或单文件 |
| Qwen3.5-9B | `C:/models/moss-base/text_encoder/model-00001-of-00004.safetensors` |
| FLUX.2 VAE | 官方 VAE 的 safetensors 文件，或 ComfyUI/BFL 的 `flux2-vae.safetensors` |
| Local tokenizer | 可选，`C:/models/moss-base/tokenizer`；离线运行时填写 |

也支持上游兼容的 ComfyUI BF16 / ConvRot INT8 单文件。分片需要选择第一片，其他分片必须位于同目录；GPTQ `qwen3.5_9b_w4a8_gptq.safetensors` 不受支持。仅选用 Base 时无需配置 SFT。

## 使用流程

1. 新建任务，选择 **MOSS-Image**。Vue 与 `/legacy/` 均可配置训练和数据集。
2. 在训练页选 Base/SFT；在适配器页选 LoRA、LoHa 或 LoKr。LoKr 的 factor/full matrix 独立保存；切换模块会清理不兼容参数。
3. 数据集填写服务器图片目录；每张图片需要同名 caption 文件，空 caption 允许。支持 PNG/JPG/JPEG/WEBP/BMP，不支持同目录重复文件主名。自然语言 caption 可保留多行。
4. 默认 512、batch 1、rank/alpha 16、BF16、AdamW8bit、梯度检查点和磁盘缓存。这是起点，不是质量或 16GB 显存保证。长 caption、采样、LoKr full matrix 都可能增加占用。
5. 显存不足时增加 Block Swap、减小分辨率/批量/文本长度，或启用 ConvRot INT8。H2D-only 要求梯度检查点；CPU/Unsloth 激活卸载与 Block Swap 互斥。
6. 在提示词页设置训练采样频率；独立出图选择已保存权重或 Base Model，然后保存并生成。出图使用卡片宽高、步数、CFG、固定 seed（包括 0）、正负提示词，另设推理 flow shift（默认 5）。训练 flow shift 默认 3，二者不混用。
7. 恢复训练使用 `*-state` 目录或自动选择最近状态；`network_weights` 只初始化适配器，不恢复优化器。恢复时保留原 adapter 类型、LoKr factor 和训练超参数。

输出使用原有任务目录：checkpoint 在 `output/`，训练采样在 `output/sample/`，独立出图在 `samples/`，TensorBoard 在 `output/tensorboard/`。独立图片旁保存 JSON 参数记录。

MOSS 运行期间不允许另起其他训练/生成；反之亦然。先停止其他任务并卸载常驻采样模型。停止会终止整棵进程树，结束后才释放任务所有权。运行中的 MOSS 配置及数据集不能修改，提示词更新只在下次启动生效。

MOSS 独立出图（非训练内采样）在 GPU 上编码整批正负提示词，embedding 暂存 CPU；编码完成后立即释放文本编码器，再加载 DiT。DiT 完成后释放，再使用 VAE 解码。整批出图完成或异常退出时清理模型和 CUDA 缓存，生成子进程随后退出，不保留常驻模型。文本编码不自动回退 CPU；显存不足时可启用 Text Encoder ConvRot INT8 或缩短文本。训练内采样的缓存策略不受此改动影响。

## 缓存与兼容性

### torch.compile 与 CUDA 加速

Vue 与 `/legacy/` 的 MOSS 训练页提供「编译与 CUDA 加速」。默认关闭编译，不改变旧任务行为；旧配置缺少这些字段时继续采用上游默认值。设置保存在 `training_arguments`，启动时传入 `_moss_config.toml`，不是生成/推理参数。

- `compile`：按 DiT Block 启用 `torch.compile`；推荐 `compile_backend = "inductor"`、`compile_mode = "default"`、`compile_dynamic = "auto"`、`compile_cache_size_limit = 32`。
- Mode 可选 `default`、`reduce-overhead`、`max-autotune`、`max-autotune-no-cudagraphs`；Dynamic 为字符串 `auto` / `true` / `false`，不是布尔值。
- `eager` / `aot_eager` Backend 仅供诊断，Mode 必须为 `default`。`compile_fullgraph` 为高级选项，默认关闭。旧的 `torch_compile` 和 `split_attn` 不在本项目 MOSS 配置白名单中，不能混入任务。
- `cuda_allow_tf32` 与 `cuda_cudnn_benchmark` 独立于编译开关生效，默认均关闭。
- ConvRot INT8 / Block Swap 可与编译组合，但对应 Linear 层会排除编译。首次启动及新尺寸可能触发编译/预热；不同分辨率桶可能增加重编译次数、显存和缓存占用，不保证加速。关闭 `compile` 即可回退，无需修改 checkpoint。
- Linux 使用 `bash setup_moss.sh` 安装独立 Python 3.12 环境及锁定 Torch/Triton，并安装系统 C/C++ 编译器（Ubuntu：`sudo apt install build-essential python3.12-dev`）。Windows 使用锁定的 triton-windows 与相应工具链；`compile_dynamic = "true"` 需要 VS 2022 C++ 编译器。

配置链路和 UI 测试不等于真实 GPU 编译训练验收；实际运行需在目标 Linux/GPU 上验证 loss、采样、显存和预热后的速度。

- 数据集按模型文件身份、caption 内容、图片身份、分辨率、tokenizer、文本量化及预处理参数生成指纹；实际缓存写入任务内 `cache/moss/`，不污染原图目录。
- 训练使用 sd-scripts 原生缓存流程，`_moss_config.toml` 和 `_moss_dataset.toml` 是启动快照，不要手动编辑活动运行快照。
- 不复用 Anima/Krea 缓存；更换模型或 caption 会生成新的缓存目录。停止任务后可手动清理旧缓存。
- caption shuffle / tag dropout / 随机增强不在首版支持范围内；caption dropout 支持。服务端会拒绝不支持的参数，而不是静默忽略。
- 独立出图按任务类型挂载 LoRA/LoHa/LoKr；不会向预量化底模直接合并权重。选择与任务类型匹配的 MOSS checkpoint。
- MOSS 不显示借用 Anima 尺寸计算的参数量或 LBAI 推荐值。

## 验证与故障定位

```powershell
npm --prefix training-ui test
npm --prefix training-ui run test:ui
npm --prefix training-ui run build
.\venv-moss\Scripts\python.exe scripts/test_moss_runtime.py
python scripts/test_moss_generation.py
```

后端测试会使用已安装的 MOSS 环境验证真实上游参数解析器与数据集 schema；没有环境时该项明确跳过。Python 测试用微型上游 MOSS Block 验证三类适配器的加载、零强度恒等、权重生效、LoKr factor/full matrix 和 ConvRot INT8 底模不被修改。这些是合成测试，**不等于完整 MOSS 模型训练成功**。

真实 GPU 冒烟验收需准备模型及小数据集：对三种 adapter 分别训练数步、保存状态、恢复数步，启用一次训练采样，再加载该 checkpoint 独立出图。记录时间、底模、分辨率、峰值显存和日志；Base/SFT 分别验证。模型未配置时不得声称这项通过。

常见错误：

- `MOSS file not found`：核对全局模型路径与所选 Base/SFT；缺片时下载完整模型。
- `outside pinned sd-scripts` / SHA256 不匹配：恢复固定后端；不要用根目录的 Anima `library` 替代。
- CUDA/BF16 检查失败：更新驱动，检查独立环境的 Torch 和 GPU；不会回退 CPU 训练。
- adapter 类型或 shape 不匹配：使用同类型权重及原始 LoKr factor；不要跨架构使用相同模块名的 Anima 权重。
- OOM：先关闭常驻生成，减少 caption 长度，启用显存优化；不得以自动化测试通过代替显存实测。

上游依据：[MOSS 训练文档](https://github.com/kohya-ss/sd-scripts/blob/v0.12.2/docs/moss_image_train_network.md)、[发布版本](https://github.com/kohya-ss/sd-scripts/releases/tag/v0.12.2)。
