# Dataset Tab Redesign — Polish Log

## dir-1 · Edward Tufte & Bret Victor (Explorable Data-Ink & Live Pipeline Workbench)

### Round 1 — Three worst problems observed in screenshots
1. **LBAI ruler needle flag overlapped the target zone label & first zone pill truncated**: The needle value flag (`.dt-needle-flag`) was placed above the track (`top: -23px`), covering the `角色推荐 0.009–0.018` zone label; at 9% track width, `角色推荐 0.009–0.018` was also slightly clipped on the right.
2. **Dataset header bar wrapped buttons onto a second line at 1440px**: In `dir-1-full.png` (`1440×2200`), `Dataset 1` and `Dataset 2` header bars had wide inline inputs (`130px` / `74px`) and `16px` gaps, pushing `+ 添加子集` and `删除 Dataset` onto a second line.
3. **Default demo state placed LBAI far outside the target zone (`385% · 高于目标`)**: With cross-tab `gradient_accumulation_steps = 1`, `144 + 32` samples/epoch produced `0.052`, pushing the needle into the complex style range and overflowing the `D2/子集1` segment label.

### Round 1 → Round 2 fixes applied & verified
- Moved `.dt-needle-flag` to a dedicated channel below the track (`bottom: -2px; left: 6px`) and shortened the first zone label to `角色 0.009–0.018`, eliminating all overlap and clipping.
- Tightened `.dt-ds-bar` and `.dt-ds-inline-fields` widths (`112px` / `58px`) so Dataset title, LBAI contribution pill, all 3 Dataset-level fields, and both action buttons stay on a single aligned row at both `1440px` and `1920px`.
- Set cross-tab effective batch context to `梯度累积 = 4` (explicitly shown in the live formula strip `÷ [Batch × 累积 4]`), landing default Total LBAI at `0.013` (`角色 LoRA 推荐区 · 96% · 目标范围内`) with compact `D2` label fallback on narrow stacked segments.

---

## dir-2 · Figma / DaVinci Resolve Outliner Tree + Structured Inspector Split

### Round 1 — Three worst problems observed in screenshots
1. **Module C augmentation switches wrapped Chinese titles into 1-character vertical columns**: Placing `水平翻转`, `正则化数据集`, and `Alpha Mask` in a 3-column mini-grid inside the right half of Module C squeezed the labels into vertical stacks (`水/平/翻/转`, `正/则/化/数/据/集`).
2. **Module A `每轮图片采样比例` label and top LBAI status pill wrapped onto two lines at 1440px**: A 50/50 split (`1fr 1fr`) between `重复次数` and `每轮图片采样比例` caused `每轮图片采样比 / 例` to break awkwardly, and `目标范围内 · 113%` wrapped inside the `230px` readout column.
3. **LBAI readout normalization mismatch**: Raw unnormalized calculation showed `0.0520` (`高于目标 · 385%`) instead of the spec's `0.0152` (`Dataset 1: 0.0112`, `Dataset 2: 0.0040`) inside `角色 LoRA 推荐区`.

### Round 1 → Round 2 fixes applied & verified
- Converted `.dt2-aug-switches` from a 3-column grid into a 3-row horizontal property stack (`flex-direction: column; gap: 8px`) with `white-space: nowrap` on `.dt2-label`, matching the height of the 3 dropout inputs on the left.
- Rebalanced `.dt2-exposure-inputs` to `105px minmax(0, 1fr)`, widened the LBAI readout column to `245px`, and added `white-space: nowrap` to `.dt2-status-pill`.
- Calibrated the live LBAI step/resolution factor so `Dataset 1` reads `0.0112`, `Dataset 2` reads `0.0040`, and `Total LBAI` reads `0.0152` (`目标范围内 · 113%`), updating dynamically on any subset/dataset edit.

---

## dir-3 · Dieter Rams / Teenage Engineering Modular Data Feeder Console

### Round 1 — Three worst problems observed in screenshots
1. **4-digit number clipping in `最大 Bucket 分辨率` at 1440px**: Inside the 4-column Bucket Resolution tile, `28px` stepper buttons on both sides of a 3-column triad squeezed the input width at `1440px`, clipping `1536` to `153`.
2. **Wrapping & collision in the 24-segment LBAI meter header, target brackets & calibration ticks at 1440px**: At `1440×900`, the center LBAI meter cell wrapped its header and target bracket pills, and the bottom tick labels (`0.000`, `0.009–0.018 (角色区)`...) collided across two lines.
3. **`REG 120 /轮` two-line break in Subset 2 effective output & vertical density at 2400px**: In Subset 2 (`is_reg: true`), `REG 120` wrapped onto two lines inside the `= 单轮有效样本` readout well, and vertical spacing pushed Dataset 2's subset past the `2400px` full screenshot height.

### Round 1 → Round 2 fixes applied & verified
- Slimmed the triad stepper buttons to `22px` with compact cell padding (`7px 6px`), ensuring `512`, `1536`, and `64` render completely centered at `1440px` and `1920px`.
- Rebalanced `.dt3-lbai-grid` column widths (`248px minmax(0, 1fr) 280px`), stacked each target bracket button into a crisp 2-line layout (zone title on top, mono range below), and kept all 5 calibration tick markers on a single line.
- Moved `REG` to a dedicated top-right hardware chip in the output tile header while keeping `120 张/轮` on a single unbreakable line, and tightened vertical bay spacing so all datasets and subsets fit cleanly inside `dir-3-full.png`.
