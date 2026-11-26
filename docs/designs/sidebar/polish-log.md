# Visual Polish Log · Sidebar Redesign (Round 1)

## dir-1 (细线台账 Hairline Ledger)
### Round 1 — Three worst issues found in `shots/dir-1-1440.png` & `shots/dir-1-light.png`
1. **Brand header wrapping (`Training` / `Studio`)**: Inside `224px` next to the `A` glyph and `↻ + 新建` buttons, `"Training Studio"` wrapped onto two lines, throwing off top-left vertical alignment.
2. **Faint row hairlines in Light mode**: `--sb-hairline-soft` (`48%` border mix) rendered almost invisible between job rows on `#ffffff` card backgrounds (`dir-1-light.png`).
3. **Search row visual cue**: Plain text `"搜索任务…"` directly above `"全部 anima krea2 moss"` lacked a search magnifier icon to distinguish input from filter strip at a glance.

### Fixes applied
- Widened sidebar cleanly from `224px` to `230px` (still narrower than original `245px`) and enforced `white-space: nowrap` on `.sb1-brand` with `11px` padding so `"Training Studio"` sits on one horizontal baseline.
- Tuned `--sb-hairline-soft-override` separately for light (`color-mix(in srgb, #cbd3e0 72%, transparent)`) vs. dark (`48%`), restoring crisp row rules in Light theme.
- Added a `13px` crisp inline SVG magnifier icon inside `.sb1-search-row` that highlights on focus.

---

## dir-2 (架构分组树 Grouped Workspace Tree)
### Round 1 — Three worst issues found in `shots/dir-2-1440.png` & `shots/dir-2-light.png`
1. **Premature truncation of long job names (`@art_kimishima ao...`, `white parabellum_v...`)**: Group tree indentation plus bordered `.sb2-tag` pill padding (`2px 5px`) squeezed out 20+ px of horizontal name room.
2. **Header framing tightness**: Brand row sat directly over the search input without a subtle header rule, creating slight crowding in Light mode.
3. **Right-side RunTimeline chart mismatch**: `dir-2.html` rendered a simplified right-side SVG missing the `"预热 100 steps（示意）"` callout, vertical warmup dashed line, and 20 checkpoint ticks along the X axis compared to `dir-1.html`.

### Fixes applied
- Widened sidebar slightly to `236px`, tightened tree indent (`margin-left: 3px; padding-left: 5px`), slimmed row horizontal padding (`4.5px 5px`), and streamlined `.sb2-tag` (`10px`, `1.5px 4px`) so `@art_kimishima ao_+old` and `white parabellum_v3_lokr` remain readable.
- Added a subtle bottom hairline divider under `.sb2-head` and prevented brand text wrapping.
- Synchronized `renderRightChart` with `dir-1.html` (full warmup callout, dashed peak line, 20 save ticks, minor tick labels `5`/`15`) so all 3 prototypes show the identical right-side Training tab.

---

## dir-3 (双轨速切栏 Dual-Rail Sidebar)
### Round 1 — Three worst issues found in `shots/dir-3-1440.png` & `shots/dir-3-light.png`
1. **Plain Unicode rail icons (`≡`, `+`, `⚙`) & missing arch color cues**: Rail action icons looked faint and inconsistent at `11px` in Light mode, and `ANM`/`KR2`/`MOS` rail buttons lacked color differentiation matching the list's `anima`/`krea2`/`moss` tags.
2. **Inner list column squeeze (`196px`)**: Long names (`@art_kimishima ao_...`, `white parabellum_v...`) truncated early inside the `196px` right pane.
3. **Right-side RunTimeline chart mismatch**: Same simplified chart gap as `dir-2.html`.

### Fixes applied
- Replaced rail action characters (`≡`, `+`, `⚙`) with crisp `15×15px` stroke SVGs (`currentColor`), and added subtle `10×2px` architecture color underline bars on `ANM` / `KR2` / `MOS` rail buttons.
- Adjusted total split width to `240px` (`38px` rail + `202px` column, still leaner than original `245px`) and trimmed inner row padding to restore name breathing room.
- Synchronized `renderRightChart` with `dir-1.html` so the right-side tab matches identically across all 3 directions.
