
## dir-2
- **Round 1 — Three worst problems found in screenshots**:
  1. **Hidden lock pills leaked visually (`dir-2-full.png`)**: `.tt-lock-pill` set `display: inline-flex`, overriding the HTML `[hidden]` attribute, so `需 Workers > 0`, `与 Activation Offload 互斥`, and `CUDA Direct / TP-SP 下不可用` appeared even when those rows were enabled.
  2. **Run Recipe strip wrapped awkwardly with a dangling divider (`dir-2-1440.png`, `dir-2-1920.png`, `dir-2-light.png`)**: `Precision bf16 / bf16` wrapped onto a second line by itself, leaving an orphaned vertical separator `|` at the end of line 1.
  3. **Vertical density & rail balance (`dir-2-full.png`, `dir-2-1440.png`)**: Row padding (`14px 18px`, `min-height: 62px`) pushed `Flow Shift` below 2600px, the rail demo button `演示校验错误 (Max Epochs)` wrapped onto two lines, and the `820px` track inside `1120px` left uneven right margin at 1440px.
- **Fixes applied & verified in Round 2 screenshots**:
  1. Added `.tt-wrap [hidden] { display: none !important; }` so all conditional lock badges, banners, and swapped unit rows stay strictly hidden until triggered.
  2. Rebuilt `.tt-recipe` into a 5-column metadata bar with internal hairline dividers and stacked 12px label / 14px mono value, fitting all 5 recipe parameters on one clean horizontal row.
  3. Tightened row vertical rhythm (`11px 18px`, `min-height: 54px`, section gap `22px`), shortened the demo button to `预览校验错误`, and set `.tt-wrap` to `max-width: 1080px` with `grid-template-columns: 204px minmax(0, 1fr)` so all four sections (including `Flow Shift`) fit cleanly in `dir-2-full.png` and balance symmetrically at 1440px and 1920px.

## dir-1

### Round 1 — three worst problems
1. **Chart label collision & 1920px letterboxing**: `"预热 100 steps (示意)"` overlapped the cosine curve right after the warmup peak, `"rin_style_v3.safeten..."` truncated prematurely on the right, and the fixed `1120×196` SVG `viewBox` centered itself with empty side gutters on 1920px instead of spanning the full content width.
2. **Redundant double hairlines on every field**: Both `.tt-field` and `.tt-control`/`.tt-select` drew bottom borders ~10px apart, creating noisy double-underlines that hurt the Tufte data-ink ratio and wasted vertical space.
3. **Detached `?` help triggers on wrapped boolean labels (and stretched mini-chart text)**: Multi-line boolean labels pushed the `?` button into a vertically centered middle column, and `preserveAspectRatio="none"` on the timestep density mini-SVG slightly stretched its axis labels.

### Round 1 → Round 2 fixes
- Made `renderTimeline()` compute its SVG `viewBox` dynamically from the stage width (with a `ResizeObserver`), moved the warmup annotation cleanly above the peak line (`padT = 32`), and split the endpoint label into two crisp lines (`rin_style_v3` / `.safetensors · bf16`) with zero truncation.
- Collapsed each field to a single bottom hairline on `.tt-field` (borderless inputs/selects inside; bottom hairline sharpens to `--primary` on `:focus-within`), cutting visual noise and bringing more controls above the fold.
- Switched `.tt-bool-label` to inline flow so `?` stays anchored right after the last word of wrapped labels, and moved the timestep mini-figure axis labels into crisp HTML below the sparkline.

## dir-3

### Round 1 — Three worst problems observed in screenshots
1. **`[hidden]` overridden by explicit `display: grid` / `display: flex`**: `.tt-split` and `.tt-readout-block` kept both `Epochs` and `Steps` duration controls and both `Warmup Steps` and `Warmup Epochs` visible simultaneously, doubling the height of Rows 1–2.
2. **Hollow vertical voids in single-readout tiles (`Learning Rate`, `Text Encoder LR`, `Weight Decay`, `Seed`)**: Because neighboring tiles were taller, `justify-content: space-between` stretched empty space between labels and readouts; `Learning Rate` lacked calibrated hardware scale markings and `Duration` lacked a derived checkpoint-cadence summary.
3. **Switch-bank LED alignment & `?` help icon wrapping**: On multi-line switch labels (`Persistent DataLoader Workers`, `Cache Text Encoder Outputs to Disk`), the LED dot was vertically centered instead of anchored to the first line, and the `?` trigger sat loosely separated from the label text.

### Changes applied
- Added `.tt [hidden] { display: none !important; }` so conditional Duration, Warmup, Scheduler, and Optimizer blocks collapse cleanly.
- Upgraded `Learning Rate` hero readout to `40px` mono with calibrated logarithmic scale markings (`1e-6`–`1e-3`) beneath the scrub gauge, and added a derived live checkpoint-cadence footer (`每 N 轮/步保存 · 共 M 次检查点`) to the Duration tile.
- Anchored switch-bank `.tt-led` to the first line (`align-items: flex-start; margin-top: 5px`) and aligned inline `.tt-help` buttons with `vertical-align: -2px`.
- Re-shot `dir-3-1440.png`, `dir-3-full.png`, `dir-3-1920.png`, and `dir-3-light.png` and verified clean proportions, zero duplicate conditional fields, and high contrast in both dark and light themes.

## dir-1 (post-selection revision)
- **User requested changes**:
  1. Warmup only takes effect once at the start of training (fixed `cosine_with_restarts` in `renderTimeline()` to draw separate cycle subpaths with strictly vertical dashed restart jumps, never slanted ramps).
  2. Unified `LR Scheduler` combobox + two-column `SchedulerCurve` preview popover matching existing `SchedulerSelect.vue` / `SchedulerCurve.vue` (removed split `<select>` + `"曲线"` button).
  3. Adopted `dir-3`'s Learning Rate logarithmic gauge slider (`1e-6`–`1e-3`, pointer drag / click / keyboard) and `−`/`+` stepper buttons inside `dir-1`'s hairline column.
- **Polish check (`dir-1-restarts.png`, `dir-1-sched-open.png`)**:
  - Moved `cosine_with_restarts` annotation off the restart jump line so it sits cleanly inside cycle 1.
  - Anchored upward-opening scheduler popover above the `.tt-field` label row so the `LR Scheduler` label stays visible.
