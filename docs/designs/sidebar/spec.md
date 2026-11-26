# Spec · Training Studio Left Sidebar Redesign

## 1. Project & Context
- **Product**: Anima Standalone Trainer — `Training Studio` (`training-ui`), a local web UI for training and managing LoRA / SFT jobs across **Anima**, **Krea 2**, and **MOSS-Image**.
- **Design Context**: The right-side configuration tabs (`训练` / `数据集` / `网络` / `提示词与生成`) were previously redesigned and approved using an **Edward Tufte & Bret Victor Explorable Data-Ink & Hairline Workbench** style (`--tt-mono`, 1px `--border` hairlines, restrained surface cards, high tabular density).
- **Problem with Current Sidebar**:
  - Wide (`245px`) with heavy vertical padding (`26px 18px 16px`, `gap: 16px`).
  - Large decorative `.brand-mark` gradient block + two-line brand subtitle eats ~74px.
  - Each `.job-item` uses tall 2-line stacked padding (`10px`), wasting vertical space.
  - `.training-queue` (up to `28vh`) and `.new-job` (~165px) are permanently expanded at full height, leaving room for only ~4–5 jobs in a `1440×900` viewport.
  - Visual language (rounded padded boxes, heavy bottom form stack, gradient logo block) clashes with the crisp hairline data-ink tabs on the right.

## 2. Scope & Invariants
- **Keep Right Side Unchanged**: `.toolbar`, `.tabs` (11 tabs), and `.workspace` tab contents remain unchanged.
- **Visual Cohesion**: Left sidebar must harmonize with the Tufte hairline / precision engineering aesthetic of the right-side tabs across all 4 built-in themes:
  - `github-dark` (default dark)
  - `github-light`
  - `midnight-blue`
  - `cherry-pink`
- **Compactness Goal**:
  - Narrower or equally lean footprint (`224px–236px`) that frees horizontal room and respects the `@media (min-width: 1550px)` 2-column breakpoint.
  - Fit **10–14 jobs** comfortably inside a `900px` tall desktop viewport without awkward scrolling, while still keeping all controls ergonomic and readable.
- **Explicit Job Type Display**:
  - **Every job item MUST display its model architecture type (`anima` / `krea2` / `moss`)** clearly (even when filtered or grouped), using compact monospace tags or subtle tint indicators so users scanning 15+ runs never confuse a Krea 2 run with an Anima or MOSS run.

## 3. Required Functional Inventory
1. **Brand / Workspace Home Link**: Compact header (`Training Studio`, click navigates to `/` home).
2. **Job Controls**: Refresh button (`↻`), live search input (`搜索任务…`), and optional architecture filter (`全部 / anima / krea2 / moss`).
3. **Job List**:
   - Running indicator dot (live glow when active/running).
   - Job name (handles long real filenames like `@art_kimishima ao_+old`, `white parabellum_v3_lokr` gracefully with single-line ellipsis + full `title` tooltip).
   - Explicit architecture type label (`anima` / `krea2` / `moss`).
   - Selected highlight state + queued rank indicator if pending.
4. **Training Queue**:
   - Displays `active` job (`训练中`), ordered `pending` queue (`#1`, `#2`), idle state (`队列空闲` / `无排队`), and `lastFailure` error banner when a previous run failed.
   - Must stay compact (e.g., 1-line summary bar + expandable list, or compact docked strip/popover) so idle queues don't steal 120px of height.
5. **New Job Creation**:
   - Job name input, model architecture selector (`Anima` / `Krea 2` / `MOSS-Image`), and `创建任务` submit action.
   - Collapsible drawer / inline toggle (`+ 新建`) or dedicated compact trigger so it occupies minimal vertical space until needed.
6. **Footer**:
   - `全局设置` navigation button (with unsaved `globalDirty` dot indicator).
   - Live WebSocket connection status (`实时连接正常` / `连接恢复中…`).

## 4. Realistic Sample Dataset (Used Consistently Across All Prototypes)
12 real-world style jobs across all 3 architectures:
1. `rin_style_v3` — `anima` (Selected)
2. `kurosawa_char` — `anima` (Running / Active in queue)
3. `@art_kimishima ao` — `anima`
4. `@art_kimishima ao_+old` — `anima`
5. `@art_machi` — `anima`
6. `@style_neco` — `anima`
7. `white parabellum_v5` — `anima`
8. `white parabellum_v3_lokr` — `anima`
9. `krea_lighting_v2` — `krea2` (Queued #1)
10. `krea_portrait_raw` — `krea2`
11. `loong-22166830` — `krea2`
12. `moss_product_sft` — `moss_image` (Queued #2)
13. `moss_anime_base` — `moss_image`

*(13 jobs total — guarantees realistic scroll, long-name truncation, and multi-architecture scanning tests.)*

## 5. Typography, Color & Readability Rules
- **Theme Tokens**: Use exact CSS custom properties from `training-ui/frontend/src/style.css`: `--background`, `--foreground`, `--card`, `--primary`, `--primary-foreground`, `--secondary`, `--muted`, `--muted-foreground`, `--accent`, `--destructive`, `--border`, and `--tt-mono: "Cascadia Mono", Consolas, "JetBrains Mono", ui-monospace, monospace`.
- **Readability Floor**:
  - Primary job names: `13px–14px`, contrast ≥ 4.5:1.
  - Architecture micro-tags, queue metadata, section headers: `11px–12px` (never tiny illegible 8px text), tabular monospace where appropriate.
  - Interactive touch/click targets: row height ≥ `28px–32px`, action buttons ≥ `28px`.
- **Output Format**: Single-file HTML prototypes at `1440×900` desktop viewport supporting all 4 themes + `?theme=` query parameter.
