# Six candidates → three full directions (Dataset Tab)

Roulette seed: second = 7 → web #8 Cinematic Sound-Viz Dark (`7 % 20 + 1 = 8`); east #8 Sugiura Information Mandala (`7 % 12 + 1 = 8`).
Ledger: checked (empty; also checked `docs/designs/training-tab` context so Dataset tab directions feel cohesive with the shell while exploring genuinely distinct structures for hierarchical Dataset → Subset editing).

---

## Candidate 1 · 最佳设计师 · Edward Tufte & Bret Victor (Explorable Data-Ink & Live Pipeline Workbench) → FULL as `dir-1.html`
- **逻辑与来源**: Edward Tufte (high data-ink ratio, hairline rules, small multiples) × Bret Victor (explorable live equations and inline token pipelines instead of static help paragraphs).
- **借的是什么**: Replace walls of `<small class="muted">` prose with **live data-driven diagrams**: (1) a calibrated **LBAI Multi-Zone Ruler** showing all 3 target bands (`角色 0.009–0.018`, `一般风格 0.02–0.05`, `复杂风格 0.05–0.09`), a stacked contribution bar per Dataset/Subset, and a **live plugged-in formula** showing the real numbers; (2) a **Progressive Resolution & Bucket Scale** (`512 ── step 64 ── 1536` + proportional stage bar `30% 512px | 70% 1024px`); (3) an inline **Caption 拼接结构流 (Live Caption Assembly Strip)** inside each subset showing `[Caption 前缀] → [🔒 保留 N 项 | 🔀 Tags 打乱] → [tags后缀] → [自然语言前缀] → [自然语言描述] → [Caption 后缀]` with automatic comma-merge warning.
- **主角素材**: Live SVG/HTML **LBAI Exposure Ruler + Stacked Subset Contribution Bar** at the top, and the **Interactive Caption Token Pipeline** inside each Subset.
- **骨架**: Full-width LBAI Exposure Ruler & live formula header → 2-column hairline Global Bucketing & Progressive Schedule strip → Hairline-structured Dataset bands where each expanded Subset splits cleanly into Left (Directory, 4 Asset Actions, Exposure Weight `图片 × repeats × 采样率 = 每轮样本`, 4 Augmentation switches) and Right (Live Caption Assembly diagram + 4 Affixes + Keep Tokens & 3 Dropout controls).
- **胆量花在哪**: Turning opaque rules (LBAI math, progressive schedule syntax, and caption prefix/keep_tokens/shuffle interaction) into live, self-explanatory visual equations right next to the inputs.
- **form 来自内容的哪里**: A dataset tab is a data-feeding and text-assembly pipeline — showing the live exposure budget and live caption token order makes every parameter self-evident.

---

## Candidate 2 · 现实参照 · Figma / DaVinci Resolve Outliner + Focused Inspector Split → FULL as `dir-2.html`
- **逻辑与来源**: Figma / Blender / DaVinci Resolve's **Master-Detail Hierarchy Outliner + Inspector** (adapted for multi-resolution Dataset → Subset trees).
- **借的是什么**: Left sticky **Dataset Tree Outliner (290px)** showing the entire hierarchy at a glance (`全局分桶与渐进计划`, `Dataset 1 · 1024×1024` → `子集 1 · rin_core (48张 · ×3)`, `子集 2 · reg_illustration (120张 · REG)`, `Dataset 2 · 1536×1536` → `子集 1 · rin_keyart_hd (16张 · ×2)`), each node with its live image count badge and LBAI share pill; Right **Structured Inspector Canvas** where each Subset is organized into 3 clean semantic cards (**① 目录与样本权重**, **② Caption 拼接沙盒与修饰词**, **③ 丢弃正则与图像增强**) with inline 1-line Chinese explanations under labels.
- **主角素材**: The **Interactive Dataset/Subset Hierarchy Outliner Rail** with per-node exposure share bars + the **Caption Split & Affix Sandbox** in each subset card.
- **骨架**: Top LBAI status header → 2-column Master-Detail layout (Left: Sticky Hierarchy Tree + LBAI Breakdown Table + Quick Add buttons; Right: Global Bucketing card + Dataset sections with 3-module Subset Inspector cards).
- **胆量花在哪**: Exposing the 2-level `Dataset → Subset` hierarchy as a true navigable tree rail with live image counts, REG badges, and exposure percentages so multi-dataset projects never turn into a lost scroll marathon.
- **form 来自内容的哪里**: Unlike other tabs that are flat lists, Dataset is a dynamic tree (`1..N Datasets × 1..M Subsets`) — a tree outliner mirrors the TOML data model directly.

---

## Candidate 3 · 最佳设计师 · Dieter Rams / Teenage Engineering Modular Data Feeder Console → FULL as `dir-3.html`
- **逻辑与来源**: Dieter Rams (Braun instrument hierarchy) × Teenage Engineering modular hardware faceplate (1px shared-border grid, oversized mono numerals, `−`/`+` steppers, LED switch banks).
- **借的是什么**: Every Dataset is a rack bay and every Subset is a **Data Feeder Module** with a visible signal multiplication chain (`[48 IMAGES] × [3 REPEATS] × [1.00 RATE] = [144 SAMPLES/EP] ──► LBAI 0.0112`), precision `−`/`+` stepper controls for `num_repeats`, `batch_size`, `keep_tokens`, and bucket resolutions, an LED-status directory terminal bar, and a hardware switch bank for the 4 subset booleans (`SHUFFLE`, `FLIP AUG`, `REGUL. (REG)`, `ALPHA MASK`).
- **主角素材**: The **Multi-Zone LBAI LED Signal Bar & Multiplication Chain Readouts** (`48 × 3 × 1.0 = 144 / EP`) + schematic **Caption Routing Bus** (`[PRE] ▸ [TAGS · KEEP 1] ▸ [TAG.SUF] ▸ [NL.PRE] ▸ [PROSE] ▸ [SUF]`).
- **骨架**: 12-column shared-seam instrument faceplate: Top LBAI Signal Meter & Target Console → Global Bucketing & Progressive Schedule Rack → Dataset Bays containing modular Subset Feeder strips.
- **胆量花在哪**: Treating image counts, repeat multipliers, and LBAI contribution as an explicit signal-amplification chain with big tabular readouts and `−`/`+` steppers.
- **form 来自内容的哪里**: Balancing a LoRA dataset is literally tuning repeat multipliers and dropout attenuators until the total LBAI signal hits the target zone.

---

## Candidate 4 · 现实参照 · Airtable / Notion Relational Subset Matrix (alternate)
- **逻辑与来源**: Airtable / Notion database spreadsheet view.
- **借的是什么**: All subsets across all datasets rendered as rows in a single dense data table with pinned directory column and horizontal parameter columns.
- **主角素材**: Spreadsheet matrix with inline cell editing and footer rollup sums.
- **骨架**: Top LBAI bar → Global bucket strip → Full-width 14-column editable data table.
- **Why alternate**: Squeezing 15 subset fields + 4 long caption affix strings into table columns forces horizontal scrolling or truncates directory paths and affixes at 1440px.

---

## Candidate 5 · 秒数轮盘 · Web #8 电影感声波可视化 Cinematic Sound-Viz Dark (alternate)
- **逻辑与来源**: Roulette `S = 7` → `web #8` (`assets/style-specimens/web/08-cinematic-sound-viz.jpg`, ElevenLabs / Saul Bass waveform stage).
- **借的是什么**: Pure black stage with a full-width vertical bar spectrum visualizing image counts and repeat frequencies across buckets, overlaid by giant display typography.
- **主角素材**: Full-width purple-blue vertical bar waveform of bucket × subset exposure.
- **骨架**: Full-screen dark waveform hero → 3 summary cards → parameter grids below.
- **Why alternate**: Decorative waveform hero consumes the entire first screen and breaks theme-variable compatibility (Light/Cherry themes) while pushing actual dataset editing below the fold.

---

## Candidate 6 · 秒数轮盘 · East #8 杉浦康平信息曼荼罗 Sugiura Information Mandala (alternate)
- **逻辑与来源**: Roulette `S = 7` → `east #8` (`assets/style-specimens/east/08-sugiura-info-mandala.jpg`, Kohei Sugiura concentric mandala diagram).
- **借的是什么**: Concentric circular chart in the center (outer ring = bucket resolutions 512–1536, middle ring = Dataset & Subset arcs sized by sample exposure, center = LBAI target), with numbered callout lines pointing to parameter blocks around the perimeter.
- **主角素材**: Central SVG concentric exposure mandala with leader lines.
- **骨架**: Radial mandala center stage flanked by vertical title and 4 corner parameter tables.
- **Why alternate**: Metaphor over-reach ("用力过头") — removing the circular mandala makes adding/deleting dynamic Datasets and editing long directory paths far more practical.
