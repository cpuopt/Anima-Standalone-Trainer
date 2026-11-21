# Prompts & Generation Tab (`提示词与生成`) · Polish Log (`dir-1`)

Target: `docs/designs/prompts-tab/dir-1.html` (Direction A · Edward Tufte & Bret Victor Explorable Data-Ink & Hairline Workbench)

## Round 1 Visual Inspection (`1440×900`, `1440×2200`, `1920×1080`, `1440×900 Light`)
1. **Negative prompt 2-line clamp bleed**: `.pt-neg-preview` combined `padding: 8px 12px` and `-webkit-line-clamp: 2` on the same element, causing the top half of the 3rd line (`digit, fewer digits...`) to bleed into the bottom padding area in Chromium (`dir-1-1440.png`, `dir-1-light.png`).
2. **Standalone parameter row alignment & 1920px gap**: `.pt-gen-params-row` used `justify-content: space-between`, pushing `Flash Attention / Sage Attention / 保持模型加载` far to the right edge at `1920×1080` and leaving a wide empty gap next to `适配器强度`. Meanwhile, `启用训练中采样` on the left column lacked explicit `30px` row height to center-align with the `每 N epochs 采样` input row.
3. **Above-the-fold framing at `1440×900` & card textarea vertical slack**: Vertical spacing across the top bar, hero strip, and global template pushed the `+ 添加提示词` button down behind the bottom-right theme dock at `1440×900`, hiding Card `#1` below the fold; card textareas also had slightly generous vertical slack for 1–2 line prompts.

## Round 2 Fixes & Verification
1. Split `.pt-neg-preview` into an outer padded wrapper and an inner `.pt-neg-preview-text` with `-webkit-line-clamp: 2` and `padding: 0`. Verified in `dir-1-1440.png` and `dir-1-light.png`: 2-line truncation with ellipsis is razor-clean with zero 3rd-line bleed.
2. Changed `.pt-gen-params-row` to `justify-content: flex-start` and added a subtle vertical hairline divider (`border-left: 1px solid var(--pt-hairline-soft)`) between `适配器强度` and the attention/keep-loaded toggles; gave `.pt-train-controls .pt-check-item` a `30px` height to align cleanly with the stepper input. Verified in `dir-1-1920.png` and `dir-1-1440.png`.
3. Tightened vertical section rhythm (`padding-bottom` / `margin-bottom` 14–16px) and prompt card textarea padding (`min-height: 48px; padding: 6px 10px`). Verified in `dir-1-1440.png` and `dir-1-light.png`: the `训练采样提示词` header, `+ 添加提示词` button, and Card `#1` header are now cleanly visible above the fold at `1440×900`, and all 3 cards (portrait `2:3`, square `1:1`, skipped landscape `3:2`) render with zero horizontal clipping in `dir-1-full.png`.
