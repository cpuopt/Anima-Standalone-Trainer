# Six candidates → three full directions

Roulette seed: second = 40 → web #1 Editorial Brutalism; east #5 Experimental Hanzi Poster.
Ledger: empty (no recent deliveries to avoid).

---

## Candidate 1 · 最佳设计师 · Teenage Engineering (industrial instrument)  → FULL as dir-3
- **借的是什么**: hardware-panel logic — every parameter is a physical "module" with a big readout; few colours (theme surface + one signal colour = `--primary`, plus one warm orange for warnings); labels tiny, values huge, mono numerals; switches look like switches; modules sized by importance on a strict 12-col grid with 1px seams (no floating cards, tiles share borders like a hardware faceplate).
- **主角素材**: the numbers themselves — 28–40px mono readouts for LR, epochs, save interval, warmup, workers, swap, flow shift. Numbers are **drag-to-scrub** (pointer drag horizontally changes value; click to type), plus ±stepper.
- **骨架**: one faceplate = 12-col tile grid; top row large tiles (LR / Optimizer+Scheduler / Duration), then medium tiles, then a dense switch bank (all booleans as a row of hardware toggles with LED dots).
- **胆量花在哪**: scrubbable giant readouts + switch bank with LED status; dependency lock shown as a "LOCKED" engraving on the tile with the reason.
- **form 来自内容的哪里**: hyper-parameters are knobs you turn between runs — the tab is the trainer's control surface.

## Candidate 2 · 最佳设计师 · Edward Tufte-style data-ink (quiet, analytical)  → FULL as dir-1
- **借的是什么**: one high-resolution, data-accurate chart carries the information; annotation directly on the chart instead of legends; small multiples; minimal chrome, hairlines, typography hierarchy by weight not boxes.
- **主角素材**: a live **Run Timeline** — an SVG chart of learning rate over the full configured run (x = epochs or steps as configured): warmup ramp, scheduler shape (cosine / restarts / min-floor / polynomial / linear / constant), checkpoint save ticks every N, end marker labelled with output name. It re-draws as fields change. Clicking a part of the chart (the warmup ramp, the curve, a save tick) focuses the related field.
- **骨架**: timeline hero spanning content width → beneath it, four compact columns (Optimization / Schedule / Performance / Caching) as hairline-separated text-dense lists, no card boxes. A one-line recipe summary sits above the chart.
- **胆量花在哪**: the chart is the top of the form and is interactive.
- **form 来自内容的哪里**: a training run *is* a timeline of LR and checkpoints — the most important fields all describe that one line.

## Candidate 3 · 现实参照 · Linear settings + macOS System Settings (list-detail)  → FULL as dir-2
- Reference (from memory of the product, not screenshotted here — ref_board needs Python playwright which is not installed): Linear workspace settings pages; macOS Ventura+ System Settings grouped inset lists.
- **借的是什么**: single centered column (max ~880px) of grouped rows; each row = label + one-line Chinese description on the left, control right-aligned; small option sets as **segmented controls**, booleans as **switches**; groups with quiet uppercase-free headings; a sticky left rail listing the sections with scroll-spy and per-section "modified" counters; dependent rows indent under their parent and animate open/closed.
- **主角素材**: the controls themselves (segmented / switch / compact numeric with unit suffix) + inline help sentence (meaning) shown under each label, so the `?` tooltip becomes "more".
- **骨架**: left rail (sections) + one reading column of rows.
- **胆量花在哪**: modified fields get a dot + per-row "恢复" (revert to saved) affordance; the dependency relationships are expressed by indentation/nesting (Activation Offload ⟶ Gradient Checkpointing, Persistent ⟶ Workers).
- **form 来自内容的哪里**: the real pain is understanding dependencies — nesting shows them structurally.

## Candidate 4 · 现实参照 · Vercel / GitHub Actions "config + preview" split  (alternate)
- Form left, live `training_arguments` TOML preview right with changed lines highlighted; clicking a line jumps to its field.
- Not built full: overlaps dir-1's "summary" role and halves usable width on 1440.

## Candidate 5 · 秒数轮盘 · Editorial Brutalism (web #1)  (alternate)
- Rule-line modular grid, giant 120px "5e-5" headline for LR, every other value 14px in dense ruled cells, signal red for conflicts.
- Not built full: shares dir-3's "big numerals" protagonist; the giant headline hurts editing density.

## Candidate 6 · 秒数轮盘 · Experimental Hanzi Poster (east #5)  (alternate)
- One giant constructed glyph「练」split into stroke blocks, each stroke = one parameter group (5 strokes ↔ 5 groups) as navigation.
- Not built full: metaphor over-reach — removing it makes the form clearer.
