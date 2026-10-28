# Chinese parameter tooltips

The Vue Training, Dataset and Network tabs provide Chinese explanations using
the shadcn-vue Tooltip pattern, backed by the already installed Reka UI. No new
runtime package is needed. The vendored Tooltip wrappers use the existing
`components/ui/SHADCN_LICENSE`; their theme follows the app's CSS tokens.

- Hover or focus the `?` beside a field to read its meaning, effect and relevant
  compatibility notes. Click/tap, Enter and Space can toggle it; Escape dismisses.
- Help is independent of the input: reading help never edits configuration or
  enables a disabled control. Help remains focusable in locked fieldsets.
- Content is teleported outside the form to avoid clipping by panels or tables.
  Width follows the viewport and long content can scroll.
- Existing inline warnings are retained, including architecture-specific notes.

## Maintaining explanations

`training-ui/frontend/src/components/forms/field-help.ts` is the source of truth
for wording, keyed by UI scope and configuration key. `getFieldHelp` resolves
Anima, Krea 2 and MOSS exceptions using the selected architecture/module.
`ConfigField` automatically adds help within the three scoped panels.
`NetworkArgument` passes its real argument name with `helpKey`; native controls
and advanced layer rows use `FieldHelp` explicitly. Other tabs are unaffected.

Keep confirmed mutual exclusions distinct from dependency requirements,
ignored/overridden options, and combinations that require testing. Check
`features/training/rules.ts`, `public/js/krea2.js`, `public/js/moss.js`, and the
actual Python backend before changing compatibility claims. Importing Triton
does not prove that a complete compiled GPU training run works.

Run `npm --prefix training-ui/frontend test` and `npm --prefix training-ui run
build`. `tests/field-help.test.ts` checks coverage across all three architectures,
real portal interaction, keyboard/mouse handling, locked inputs, advanced layer
settings, and preservation of existing configuration.

## LR Scheduler curve preview

The LR Scheduler field uses a shadcn-vue-style Reka Select with a companion
preview panel rather than tooltips on native `<option>` elements (native options
do not provide reliable cross-browser hover content). Hover an option or use
arrow keys to preview; Enter or pointer selection commits the value. Escape
cancels browsing. The panel moves below the options on narrow screens.

`components/forms/scheduler-curves.ts` defines normalized SVG illustrations for
constant, linear, cosine, cosine_with_restarts, cosine_with_min_lr and polynomial.
These are educational diagrams only: no warmup is drawn; restart cycles, minimum
LR and polynomial power use explicitly labelled example values, not the current
task's settings. Unsupported custom values remain untouched and show a text-only
fallback, never a fabricated curve. No plotting library or image download is used.

`tests/scheduler-select.test.ts` covers option/curve coverage, hover and keyboard
previews, selection, cancellation, focus return, locked forms, absent/custom values,
and integration across Anima, Krea 2 and MOSS.
