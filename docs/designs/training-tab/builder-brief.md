You are a senior product designer + front-end engineer building ONE design-direction prototype (HTML) for a redesign of the Training tab content area of a LoRA trainer web UI.

BASE = c:\Users\rby20\Desktop\Anima-Standalone-Trainer\design-demos\training-tab

Read these first:
- BASE\spec.md  (shared spec: real content, all fields, conditional rules, constraints) — follow it exactly.
- BASE\directions.md — build ONLY the card named in your assignment. Ignore the other cards; do not imitate them.
- BASE\_shell.html — copy it to BASE\dir-N.html (N from your assignment). Do not modify the shell block; put your markup inside `.workspace` and your CSS in the direction style block (scope under `.tt`). Change the <title> to describe the direction.
- For realism you may read training-ui/frontend/src/features/training/TrainingPanel.vue and src/components/forms/field-help.ts (read as UTF-8) in c:\Users\rby20\Desktop\Anima-Standalone-Trainer. Do NOT modify any project source files; only write inside BASE.

Requirements:
- Every Anima field from the spec present, with a small `?` help trigger (hover/focus shows real Chinese help: 含义/作用) on each.
- Vanilla JS state object; conditional rules really work (duration unit swap, warmup unit swap, scheduler-dependent fields, Prodigy→Decouple, offload↔checkpointing↔blocks to swap, workers 0→persistent disabled, TE variants→cache TE on). Editing marks the toolbar dirty dot (#dirty-dot hidden=false).
- Include a small demo toggle to preview the Locked state (fieldset disabled) and one validation error path (e.g. Max Epochs < 1 → "最小值为 1").
- Must honor the theme CSS variables (check Light theme via the dock). Body/value text ≥14px, labels ≥12px.
- Support `?theme=github-light` (etc.) in the URL to set the theme on load (useful for headless screenshots).
- Avoid template decoration: no all-caps eyebrow above every heading, no 01/02/03 numbering, no emoji icons, no purple gradients, no left-colour-bar cards, no trailing → on buttons.
- Quality bar: it should look like a top studio designed it, and feel native to the existing shell.

Polish loop (mandatory, at least 1 full round): screenshot with Chrome headless, open the images and look at them, write down the three worst problems, fix, re-shoot:
  & "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --disable-gpu --hide-scrollbars --screenshot="BASE\shots\dir-N-1440.png" --window-size=1440,900 "file:///c:/Users/rby20/Desktop/Anima-Standalone-Trainer/docs/designs/training-tab/dir-N.html"
Also: a tall one (--window-size=1440,2600 → dir-N-full.png), a 1920x1080 one (dir-N-1920.png), and a light-theme one (dir-N-light.png, via ?theme=github-light). Create BASE\shots if missing. (Chrome may need a moment; run with a unique --user-data-dir under %TEMP% if it conflicts with a running Chrome.)
Append your notes (round 1 three worst problems + what you changed) to BASE\polish-log.md under a heading "## dir-N".

When done, reply with: file path, screenshot paths, a 3-line summary of the design, and anything in the spec you could not satisfy.
