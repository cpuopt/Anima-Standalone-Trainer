# Network Tab (`dir-1.html`) Visual Polish Log

## Round 1 → Round 2

### Inspected Screenshots
- `shots/dir-1-1440.png` (`1440×900`, `github-dark`)
- `shots/dir-1-full.png` (`1440×2200`, full-page `github-dark`)
- `shots/dir-1-1920.png` (`1920×1080`, `github-dark`)
- `shots/dir-1-light.png` (`1440×900`, `?theme=github-light`)

### Top 3 Visual / Layout Issues Found in Round 1 & Fixed in Round 2
1. **Conditional controls leaking through `hidden` attribute (CSS specificity bug)**
   - *Observed in Round 1*: `.nt-mod-toggle-line { display: flex }` and `.nt-layer-controls { display: flex }` overrode the browser's default `[hidden] { display: none }`, causing `Save Magnitude Scale in FP32` to remain visible when `Use DoRA` was off, and causing `高级分层设置` mode/action controls to appear even when `layer_configs` was unchecked.
   - *Fix*: Added `.nt-wrap [hidden] { display: none !important; }` so all conditional controls hide cleanly when inactive.
   - *Verified in Round 2*: Both `dir-1-1440.png` and `dir-1-full.png` now show only active controls, keeping the default Adapter view uncluttered.

2. **Vertical baseline misalignment between `Network Dim (Rank)` and `Network Alpha`**
   - *Observed in Round 1*: Because `Network Alpha` displays the derived `缩放 Alpha/Rank = 1.00×` badge in `.nt-field-head`, its header was ~4px taller than `Network Dim (Rank)` when Rank was unlocked, pushing the Alpha input box and chips slightly below Rank.
   - *Fix*: Enforced `min-height: 24px` on `.nt-pair .nt-field-head` so both input boxes, steppers, and quick-preset chip rows sit on the exact same horizontal baseline regardless of badge state.
   - *Verified in Round 2*: Pixel-aligned across `1440×900`, `1920×1080`, and `github-light`.

3. **Above-the-fold vertical density & proportional micro-bar legibility in Matrix Blueprint**
   - *Observed in Round 1*: On `1440×900`, the bottom edge of the Rank/Alpha quick chips was slightly clipped by the viewport bottom; additionally, the `占原始层` micro-bars were normalized against a fixed 8% floor, making default Rank 16 bars (`0.98%–2.34%`) look cramped at the left edge.
   - *Fix*: Tightened vertical rhythm on `.nt-top-bar`, `.nt-recipe-strip`, `.nt-hero`, and `.nt-matrix-table td`, and normalized the micro-bars against the highest sample layer (`Math.max(0.0001, ...rows.map(r => r.percent))`) so relative parameter ratios between `self_attn`, `cross_attn`, and `mlp` read immediately.
   - *Verified in Round 2*: All Rank/Alpha inputs, steppers, quick chips, and hints fit comfortably above the fold on `1440×900`, and the comparative micro-bars are clear and balanced in both Dark and Light themes.
