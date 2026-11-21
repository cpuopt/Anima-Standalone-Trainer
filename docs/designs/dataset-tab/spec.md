# Dataset tab redesign — spec (shared input for all directions)

## What this is
Anima Standalone Trainer is a self-hosted Web UI for training image-model adapters (LoRA / LoHa / LoKr …) on Anima, Krea 2 and MOSS-Image. The **Dataset tab** (`training-ui/frontend/src/features/dataset/DatasetPanel.vue`) manages training exposure estimation (LBAI), aspect-ratio bucketing, progressive resolution schedules, multiple Datasets (resolutions / batch sizes), and their Subsets (server directories, image counts, repeats, sampling rate, caption affixes, token protection, dropout, and augmentation flags).

Only the **content area of the Dataset tab** is being redesigned (excluding the `DatasetAssetManager` modal dialog that opens when clicking `导入数据集` or `浏览 / 预览`). The application shell (sidebar, toolbar, tab bar, theme switcher) stays unchanged — see `_shell.html`.

## Audience & scene
Hobbyist-to-expert LoRA trainers on desktop monitors (1440×900 to 1920×1080, plus responsive degradation at 375×812). They come to the Dataset tab to:
1. Bind one or more image directories (or check how many images were detected / whether a path is missing).
2. Balance `num_repeats`, `epoch_sample_rate`, `batch_size`, and multi-resolution Datasets so that the resulting **LBAI (训练程度估算)** lands in the desired target zone (`角色 LoRA 推荐区`, `一般风格 LoRA 推荐区`, `复杂风格 LoRA 实验区`).
3. Configure **Caption processing** (`caption_prefix`, `tags_suffix`, `natural_language_prefix`, `caption_suffix`, `keep_tokens`, `shuffle_caption`, and 3 dropout parameters) without getting confused about how tags and natural language are split or which tokens are protected from shuffling.
4. Configure **Bucketing & Progressive Resolution Schedule** without having to memorize string syntax like `512:0.4,1024:0.3,1536:0.3`.

## Core UX problems in the current implementation (to solve)
1. **Wall-of-text explanations**: Currently, the LBAI formula, Progressive Resolution Schedule format, and Caption prefix/shuffle rules are explained in dense `<small class="muted">` paragraphs or buried inside `?` tooltips. Users can't easily see *how* their numbers plug into LBAI or *where* the 4 caption affixes attach.
2. **Flat, undifferentiated field dump in each Subset**: Inside a Subset, 15+ fields (`image_dir`, `num_repeats`, 4 action buttons, 5 numeric sampling/dropout inputs, 4 caption affixes, 4 boolean checkboxes) are dumped into generic auto-fit grids with no visual grouping between **Directory & Exposure Weight**, **Caption Assembly & Shuffle Protection**, **Dropout Regularization**, and **Image Augmentations**.
3. **Opaque LBAI meter**: The native `<meter>` only shows one bar against an arbitrary max without visually showing the target range bounds (`min`–`max`), how each Dataset/Subset contributes to the total, or why `REG` (`is_reg`) subsets are excluded from LBAI.
4. **Confusing 4-affix + `keep_tokens` interaction**: Users frequently don't realize that `caption_prefix` without a trailing comma merges with the first tag into 1 token item, or where `tags_suffix` vs `natural_language_prefix` sits when a caption is split into Tags + Natural Language.

## Tone
Precise, calm, studio-grade instrument. Native to the existing Training Studio shell and CSS variable theme system (`Dark`, `Light`, `Midnight`, `Cherry`).

## Output format (all directions identical)
- Single HTML file built from `_shell.html` (edit only inside `.workspace` and the direction style block).
- Viewport targets: `1440×900` primary, `1920×1080` wide, `1440×full` tall screenshot, `375×812` mobile responsive, and `github-light` theme verification.
- Must honor CSS variables (`--background --foreground --card --primary --primary-foreground --secondary --muted --muted-foreground --accent --destructive --border`) and support `?theme=github-light` query param on load.
- Fonts: system stack (`Inter, "Segoe UI", "Microsoft YaHei", sans-serif`) + monospace (`"Cascadia Mono", Consolas, "JetBrains Mono", ui-monospace, monospace`).
- Readability floor: body/values ≥ 14px, labels ≥ 12px, contrast ≥ 4.5:1.

## Real content & complete feature checklist (every item must be present & interactive)

### 1. Total LBAI & Target Comparison (Anima; outside `<fieldset>` so target selector works even when locked)
- **总 LBAI readout**: Calculated live using `LBAI.calculate`:
  - Per non-REG subset: `effectiveSamples = count * num_repeats * clamp(epoch_sample_rate, 0, 1)`
  - Per Dataset: `exposure = samplesPerEpoch * epochs`, `value = exposure * (learningRate * schedulerFactor) * (rank / 32) / (batchSize * gradAccum)`
  - Demo linked training context (displayed honestly as cross-tab context from Training/Network tabs): `max_train_epochs = 20`, `learning_rate = 5e-5`, `lr_scheduler = cosine` (factor `0.5`), `network_dim (Rank) = 32`, `gradient_accumulation_steps = 1`.
- **LBAI 比较目标 (`lbai_target`) `<select>` + `?` FieldHelp**:
  - `角色 LoRA 推荐区：0.009–0.018`
  - `一般风格 LoRA 推荐区：0.02–0.05`
  - `复杂风格 LoRA 实验区：0.05–0.09`
- **Comparison status**: Target name · percentage of target midpoint · `低于目标` / `目标范围内` / `高于目标`.
- **Visual scale & formula breakdown**: Show target range zone(s), per-Dataset/Subset contribution, and clear formula explanation (noting that `is_reg` subsets are excluded and multi-resolution datasets contribute independently).

### 2. Global Bucketing & Resolution Schedule
- Stored in `dataset.general`:
  - `enable_bucket` · **启用 Bucket** · boolean · `true`
  - `bucket_no_upscale` · **不放大小图** · boolean · `true`
  - `balance_regularization_images` · **平衡正则化图片** · boolean · `false`
  - `min_bucket_reso` · **最小 Bucket 分辨率** · number · `512` (step 64)
  - `max_bucket_reso` · **最大 Bucket 分辨率** · number · `1536` (step 64)
  - `bucket_reso_steps` · **Bucket 步长** · number · `64`
- Stored in `config.training_arguments` (Anima):
  - `resolution_schedule` · **Progressive Resolution Schedule** · text · demo value `512:0.3,1024:0.7` (or clearable to empty) · live visual parsing of stages & ratio sum check (sum = 1.0)
  - `disable_bucket_shuffle` · **Disable Bucket Shuffle** · boolean · `false`
- Global action:
  - **添加 Dataset** button (adds a new Dataset card with default `[1024, 1024]`, `batch_size: 1`, `caption_extension: '.txt'`, and 1 subset).

### 3. Dataset List (`Dataset 1..N`)
Demo state should show **2 Datasets** to demonstrate multi-resolution training and independent LBAI contributions:
- **Dataset 1** (`resolution: [1024, 1024]`, `batch_size: 2`, `caption_extension: '.txt'`):
  - **子集 1** (Core character subset): `image_dir: "datasets/dataset-9f2a/rin_core"`, count: `48 张`, `num_repeats: 3`, `epoch_sample_rate: 1`, `keep_tokens: 1`, `caption_dropout_rate: 0.05`, `caption_tag_dropout_rate: 0`, `caption_dropout_every_n_epochs: 0`, `caption_prefix: "rin_style, "`, `tags_suffix: ""`, `natural_language_prefix: "In the style of Rin, "`, `caption_suffix: ""`, `shuffle_caption: true`, `flip_aug: false`, `is_reg: false`, `alpha_mask: false`.
  - **子集 2** (Regularization subset): `image_dir: "datasets/dataset-9f2a/reg_illustration"`, count: `120 张`, `num_repeats: 1`, `epoch_sample_rate: 1`, `keep_tokens: 1`, `caption_dropout_rate: 0`, `caption_tag_dropout_rate: 0`, `caption_dropout_every_n_epochs: 0`, `caption_prefix: ""`, `tags_suffix: ""`, `natural_language_prefix: ""`, `caption_suffix: ""`, `shuffle_caption: false`, `flip_aug: true`, `is_reg: true`, `alpha_mask: false`.
- **Dataset 2** (`resolution: [1536, 1536]`, `batch_size: 1`, `caption_extension: '.txt'`):
  - **子集 1** (High-res key art subset): `image_dir: "datasets/dataset-9f2a/rin_keyart_hd"`, count: `16 张`, `num_repeats: 2`, `epoch_sample_rate: 1`, `keep_tokens: 2`, `caption_dropout_rate: 0.05`, `caption_tag_dropout_rate: 0.1`, `caption_dropout_every_n_epochs: 0`, `caption_prefix: "rin_style, masterpiece, "`, `tags_suffix: "high detail,"`, `natural_language_prefix: ""`, `caption_suffix: ""`, `shuffle_caption: true`, `flip_aug: false`, `is_reg: false`, `alpha_mask: false`.
- Each Dataset has:
  - Header with `Dataset N`, Per-Dataset **LBAI** contribution readout, and **删除 Dataset** button (`disabled` when `datasets.length <= 1`).
  - Fields: `resolution` (**分辨率 [宽, 高] 或单值**), `batch_size` (**Batch Size**), `caption_extension` (**Caption 扩展名**).
  - **添加子集** button.

### 4. Subset Controls (`子集 1..M` inside each Dataset)
- Header:
  - Collapse / Expand toggle (`▾` / `▸` **子集 {{ si + 1 }}** + `(REG)` badge when `is_reg` is true)
  - Live Image Count readout (`图片：48` / `图片：—` when path empty / `图片：路径不存在` error state)
  - **删除子集** button (`disabled` when `subsets.length <= 1`)
- Directory & Actions:
  - `image_dir` · **服务器图片目录**
  - `num_repeats` · **重复次数** (number ≥ 1)
  - 4 Action buttons:
    - **打开目录** (`disabled` when `!subset.image_dir`)
    - **导入数据集** (`disabled` when `running/locked`; triggers simulated modal notice in prototype)
    - **浏览 / 预览** (`disabled` when `!subset.image_dir`; triggers simulated modal notice in prototype)
    - **重新计数** (re-runs image count check)
- Sampling & Dropout Numbers:
  - `epoch_sample_rate` · **每轮图片采样比例** (0–1, step 0.01)
  - `keep_tokens` · **保留 Token** (≥ 0, step 1)
  - `caption_dropout_rate` · **Caption Dropout** (0–1, step 0.01)
  - `caption_tag_dropout_rate` · **Tag Dropout** (0–1, step 0.01)
  - `caption_dropout_every_n_epochs` · **每 N 轮 Caption Dropout** (≥ 0, step 1)
- Caption Affixes (with improved visual prompt/preview showing how a caption is assembled):
  - `caption_prefix` · **Caption 前缀**
  - `caption_suffix` · **Caption 后缀**
  - `natural_language_prefix` · **自然语言部分前缀**
  - `tags_suffix` · **tags部分后缀**
- Subset Booleans:
  - `shuffle_caption` · **打乱 Caption**
  - `flip_aug` · **水平翻转**
  - `is_reg` · **正则化数据集**
  - `alpha_mask` · **Alpha Mask**

### 5. States & Help Triggers
- Every field has its `?` help trigger (`FieldHelp`) displaying the exact Chinese `title / 含义 / 作用 / 注意事项` from `field-help.ts`.
- Demo state toggles at top:
  1. **预览锁定 / 训练中状态 (`store.locked`)**: Disables the `<fieldset>`, keeps `LBAI 比较目标` `<select>` enabled, and reveals the `<section aria-label="数据集只读预览">` with `预览 Dataset X / 子集 Y` buttons outside the fieldset!
  2. **模拟路径异常 / 未绑定**: Lets the user see how an empty path (`—`) or nonexistent path (`路径不存在`) and resolution schedule error (`比例之和应为 1`) are surfaced clearly.
