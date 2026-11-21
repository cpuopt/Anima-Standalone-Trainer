# Training tab redesign — spec (shared input for all directions)

## What this is
Anima Standalone Trainer is a self-hosted Web UI for training image-model adapters (LoRA / LoHa / LoKr …) on Anima, Krea 2 and MOSS-Image. The **Training tab** (`training-ui/frontend/src/features/training/TrainingPanel.vue`, MOSS variant `MossTrainingPanel.vue`) holds the core run hyper-parameters. Only the **content area of this tab** is being redesigned. The shell (sidebar, toolbar, tab bar) stays exactly as is — see `_shell.html`.

## Audience & scene
Hobbyist-to-expert LoRA trainers, on a desktop (1440–1920 wide, frequently a wide monitor), usually dark theme, often with a blurred custom background image behind the UI. They visit this tab repeatedly between runs to tweak a few numbers (LR, epochs, save interval, scheduler, VRAM toggles). They know what most keys mean and the TOML key names; Chinese UI chrome, English parameter labels.

## Core needs (what the content must make easy)
1. See the whole run "recipe" at a glance (optimizer, LR, scheduler, duration, save cadence, precision).
2. Edit a value fast; numbers dominate.
3. Understand mutually-exclusive / dependent options (offload vs block swap, checkpointing → offload, workers 0 → persistent off, compile locked by CUDA Direct/TP-SP, FSDP disables swap/offload).
4. Per-field Chinese help (the existing `?` help trigger with tooltip — must remain on every field).

## Tone
Precise, calm, tool-grade. A studio instrument, not a marketing page. Must feel like it belongs to the existing shell.

## Output format (all directions identical)
- Single HTML file built from `_shell.html` (copy it; edit only inside `.workspace` and the direction style block). 1440×900 primary viewport; must also hold up at 1920 and degrade at 375.
- Must work with all four themes via the existing CSS variables (`--background --foreground --card --primary --primary-foreground --secondary --muted --muted-foreground --accent --destructive --border`). Do not hard-code a palette that ignores the theme; you may derive tokens with `color-mix()`. The theme dock in the shell switches themes — verify Light too.
- Fonts available: system only (Inter / Segoe UI / Microsoft YaHei; mono: "Cascadia Mono", Consolas, "JetBrains Mono", monospace). No web font downloads.
- Text ≥14px for values/body, ≥12px for labels; contrast ≥4.5:1.
- Plain vanilla JS for interactions; the prototype must actually toggle the conditional fields listed below.
- Represent the Anima architecture (the default). Krea/MOSS variants only need to be considered (state in a comment how they map), not drawn.

## Real content — Anima Training tab (every field must be present)
Current groups → fields (label · key · type · fallback/default). Use these values as the demo state.

**Optimization**
- Learning Rate · `learning_rate` · number · 0.00005 (show as 5e-5 friendly)
- Text Encoder LR · `text_encoder_lr` · number · 0.00005
- Optimizer · `optimizer_type` · select: AdamW8bit, AdamW, PagedAdamW, PagedAdamW8bit, PagedAdamW32bit, Adafactor, Lion8bit, PagedLion8bit, SGDNesterov8bit, Prodigy, AdamWScheduleFree, RAdamScheduleFree, SGDScheduleFree · AdamW8bit
- LR Scheduler · `lr_scheduler` · select: cosine, constant, linear, cosine_with_restarts, cosine_with_min_lr, polynomial · cosine. (Existing app opens a rich popover with a curve preview for each scheduler — keep that idea available.)
- LR Warmup Unit · `lr_warmup_unit` · Steps | Epochs · steps
- LR Warmup Steps · `lr_warmup_steps` · number ≥0 · 100 (shown when unit=steps) / LR Warmup Epochs · `lr_warmup_epochs` · number ≥0 · 1 (when unit=epochs)
- Weight Decay · (stored inside optimizer_args as `weight_decay=…`) · number · 0
- Seed · `seed` · 42
- Restart Cycles · `lr_scheduler_num_cycles` · ≥1 · only when scheduler = cosine_with_restarts
- Min LR Ratio · `lr_scheduler_min_lr_ratio` · 0–1 · only when scheduler = cosine_with_min_lr
- Decouple Weight Decay · checkbox · only when optimizer matches Prodigy/DAdapt
- Optimizer Args (JSON array) · `optimizer_args` · JSON textarea, collapsed by default, note: "保留全部已有参数；切换优化器时仅共用 weight_decay，其他参数按优化器暂存，切回时恢复。"

**Training Schedule**
- Duration Unit · Epochs | Steps · epochs
- epochs mode: Max Epochs `max_train_epochs` 20 · Save Every N Epochs `save_every_n_epochs` 1
- steps mode: Max Steps `max_train_steps` 1000 · Save Every N Steps `save_every_n_steps` 500
- Output Name · `output_name` · text · rin_style_v3
- Save Format · `save_model_as` · safetensors | ckpt

**Performance**
- Mixed Precision · bf16 | fp16 | no
- Save Precision · bf16 | fp16 | float
- DataLoader Workers · 0–16 · 4 (setting 0 forces Persistent off)
- Gradient Accumulation Steps · ≥1 · 1
- Persistent DataLoader Workers · bool · true · disabled when workers = 0
- Gradient Checkpointing · bool · true · note "以计算换显存；关闭时一并关闭 activation offload。"
- Flash Attention · bool · false · note "需要安装 flash-attn。"
- Torch Compile · bool · false · note "首次编译较慢；CUDA Direct 与 TP/SP 模式不可使用。" (can be locked)
- Low RAM Optimization · bool · false
- Blocks to Swap · 0–26 · 0 · disabled when activation offload ≠ None (or FSDP)
- Activation Offload · None | CPU Offload | Unsloth Offload · None · note "需要 Gradient Checkpointing；Anima 与手动 Block Swap 互斥。" Choosing CPU/Unsloth turns Gradient Checkpointing on and sets Blocks to Swap = 0.

**Caching & Timesteps**
- Cache Latents to Disk · bool · true
- VAE Cache Batch Size · 1–32 · 1
- Cache Text Encoder Outputs to Disk · bool · true
- 按图片 / 轮次 / 重复次数缓存文本变体 · `cache_text_encoder_variants` · bool · false (turning on forces Cache TE Outputs to Disk on)
- Timestep Sample Method · logit_normal | uniform
- Flow Shift · `discrete_flow_shift` · number ≥0 step 0.1 · 3

**State that must be visible somewhere**
- Locked state: whole form disabled while saving/loading (and while Krea/MOSS runs). Show how it looks (a demo toggle is fine).
- Field validation error (e.g., typing -1 into Max Epochs → "最小值为 1").
- Dirty state is shown by the shell's toolbar dot; content area may additionally mark modified fields.

## Help text samples (Chinese, real — from field-help.ts)
- learning_rate: 含义：每次优化器更新的基础步幅。作用：调节模型学习新概念的速度；过大可能不稳定，过小可能学不充分。
- lr_scheduler: 含义：控制学习率随训练进度的变化曲线。作用：例如 cosine 后期降低学习率，constant 保持基础水平。
- lr_warmup_steps: 含义：在训练开始的一段更新步内逐渐升高学习率。作用：减少起步时过大的参数更新；0 表示无预热。
- weight_decay: 含义：优化器对可训练权重施加的收缩约束。作用：限制权重增长，提供正则化；不是学习率衰减。
- seed: 含义：初始化随机数生成器的数值。作用：便于在相同环境下比较配置，0 也是有效种子。
- duration_unit: 含义：选择按 Epochs（轮）还是 Steps（更新步）控制训练。作用：切换训练终点以及保存、采样间隔所使用的单位。
- max_train_epochs: 含义：遍历数据集的最大轮数。作用：结合数据量、重复次数和采样比例决定训练量。
- discrete_flow_shift: 含义：对训练噪声时间步的分布施加偏移。作用：1 不偏移，大于 1 偏向更高噪声，小于 1 偏向更低噪声。
More in `training-ui/frontend/src/components/forms/field-help.ts` (read with UTF-8).

## Constraints from the implementation (must stay feasible in Vue later)
- Each field remains a `ConfigField`-style control (label + `?` help trigger + control + optional note + error). Native controls wrapped in `label.field` must contain a help trigger.
- Root remains a `<fieldset>` so `disabled` locks everything.
- No fake data: there is no step count / dataset size on this tab. If a visualization needs a total step count, use the configured value (epochs or steps) as the axis and label it honestly (e.g. x-axis in epochs).
