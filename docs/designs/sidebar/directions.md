# Sidebar Design Directions (6 Candidates → 3 Full Prototypes)

## Context & Roulette Inputs
- **Current seconds (`S`)**: `48`
- **Target medium**: Desktop Web Application Left Navigation Rail (`1440×900`) paired with a Tufte-style Hairline Workbench (`training-tab/dir-1.html`).
- **Look Ledger check**: Empty (`C:\Users\rby20\.huashu-design\ledger.jsonl`); previous project work approved Tufte hairline (`dir-1`) for the right-side tabs, so the sidebar should elevate and match that clarity without copying generic rounded SaaS cards.

---

## Candidate 1 · 细线台账 Hairline Ledger *(Selected → `dir-1.html`)*
- **Logic & Source**: **Best Designer** — Edward Tufte + Josef Müller-Brockmann (swiss typographic index + data-ink ratio).
- **What is borrowed**: Zero background cards or pill borders on list items; `1px` hairline structural rules (`--border` at 75%); single-line tabular layout where every pixel carries information (status dot + job name + right-aligned mono architecture code `anima` / `krea2` / `moss`); active state marked by a razor-sharp `2px` `--primary` left rule and subtle `--accent` wash.
- **Hero / Focal Mechanism**: Ultra-dense `224px` sidebar where all 13 jobs read like an index table, paired with inline architecture filter tabs (`全部 · ANM · KR2 · MOS`) and collapsible `+` new-job drawer & 1-line bottom queue ticker.
- **Skeleton**: `224px` single column → compact 36px brand/action bar → inline search + 4-tab arch filter → scrollable hairline job rows (`30px` each) → collapsible queue strip → single-line footer.
- **Where the boldness goes**: Complete elimination of box-within-box padding and decorative gradient logos; pure typographic precision directly mirroring the right-side Training Timeline.
- **Form from content**: LoRA training runs are a continuous ledger of named experiments (`v3`, `v5`, `_lokr`) differentiated by base model (`anima` / `krea2` / `moss`), so a tabular hairline ledger exposes the full experiment catalog at a glance.

---

## Candidate 2 · 精密仪器索引条 Instrument Index Strip *(Backup #4 in `thumbs.html`)*
- **Logic & Source**: **Best Designer** — Dieter Rams (Braun atelier controls) / Teenage Engineering OP-1 field index.
- **What is borrowed**: Recessed monospace queue readout block (`ACTIVE: kurosawa_char`), tactile `1px` segmented rocker switches for architecture filtering, hairline keycap badges (`ANM` / `KR2` / `MOS`), micro LED indicators.
- **Hero / Focal Mechanism**: Compact `230px` industrial strip with a recessed dark status header showing running/queued telemetry and crisp 1-line index items below.
- **Skeleton**: `230px` single column → recessed mono status monitor → search + tactile filter bar → dense 28px list rows → pop-over `+ 新建` trigger → compact bottom utility strip.
- **Why kept as backup**: Great character, though slightly heavier in hardware framing than the airy Tufte hairline tabs on the right; easy to promote if the user wants a hardware-console touch.

---

## Candidate 3 · 架构分组树 Grouped Workspace Tree *(Selected → `dir-2.html`)*
- **Logic & Source**: **Real-World Reference** — Linear Workspace Sidebar + VS Code / Raycast Tree Explorer (`232px`).
- **What is borrowed**: Collapsible section groups (`Anima · 8`, `Krea 2 · 3`, `MOSS · 2`) with disclosure carets and count readouts, subtle semantic dot/tint hints per model family while still printing the explicit micro tag (`anima` / `krea2` / `moss`) on each row, compact `28px` workspace rows (`border-radius: 5px`), and a docked mini-queue card just above the footer.
- **Hero / Focal Mechanism**: Instant structural scannability by model architecture — collapse `MOSS` or `Krea 2` when focusing on Anima runs, while keeping every row compact and self-describing.
- **Skeleton**: `232px` single column → compact brand header + `+ 新建` action button → inline collapsible create strip → search bar → collapsible architecture tree groups → compact docked queue strip (active + pending count + expand toggle) → single-row footer.
- **Where the boldness goes**: Replacing a flat undifferentiated list with collapsible architecture-grouped folders plus inline drawer creation, cutting perceived clutter in half.
- **Form from content**: Users frequently switch mental context between Anima, Krea 2, and MOSS-Image pipelines (each has distinct training arguments and model paths), so grouping the workspace tree by architecture matches how practitioners organize runs.

---

## Candidate 4 · 双轨速切栏 Dual-Rail Sidebar *(Selected → `dir-3.html`)*
- **Logic & Source**: **Real-World Reference** — Zed Editor / Arc Browser Split Rail (`38px` primary rail + `196px` index drawer = `234px`).
- **What is borrowed**: Separating persistent global tools from the job list onto a dedicated `38px` far-left rail (Home mark, Architecture filter icons/pills `ALL` / `ANM` / `KR2` / `MOS`, Queue drawer toggle with live badge `2`, `+` New Job popover trigger, Settings `⚙`, and Connection LED), leaving the `196px` inner column 100% dedicated to Search + compact job list.
- **Hero / Focal Mechanism**: Pure vertical liberation — because Queue, New Job, Settings, and Architecture Filters live in the `38px` rail and floating popovers/drawers, the `196px` job column holds **15+ jobs** top-to-bottom without anything competing for height.
- **Skeleton**: `38px` fixed icon/code rail + `196px` compact job drawer (`234px` total) → sticky search bar → uninterrupted `29px` job rows with right-aligned mono `anima` / `krea2` / `moss` labels → expandable Queue / Create drawers anchored from the rail.
- **Where the boldness goes**: Splitting navigation mechanics (rail) from the catalog (list) so the job list spans nearly 100% of the viewport height.
- **Form from content**: During active training sessions, users constantly monitor queue state and switch between 10–30 jobs across 3 architectures; a persistent tool rail gives 1-click access to filters, queue, and settings without shrinking the job list.

---

## Candidate 5 · 功能主义表格索引 Functional Brutalism Grid *(Backup #5 in `thumbs.html`)*
- **Logic & Source**: **Seconds Roulette (`S = 48`)** — `48 % 20 + 1 = 9` (09 Pixel-Game Side-Scroller is incompatible with an ML trainer studio; per protocol, skipped to compatible dense web style **#17 Functional Brutalism**, inspired by Are.na / Lobsters / Tufte tables).
- **What is borrowed**: Zero border-radius (`0px`), raw `1px` full-grid table cells (`状态 | 任务名 | 架构`), crisp `11px` mono column headers, high-density zebra or hairline rows.
- **Skeleton**: `228px` zero-radius column → 1px bordered search cell → 3-column table list (`● | rin_style_v3 | ANM`) → 1px bordered queue row & create row.
- **Why kept as backup**: Structurally close to Candidate 1 (`dir-1`), but much more rigid/brutalist with visible vertical cell borders; kept in `thumbs.html` as a sharper alternative.

---

## Candidate 6 · 东亚编目索引栏 Editorial CJK Margin Index *(Backup #6 in `thumbs.html`)*
- **Logic & Source**: **Seconds Roulette (`S = 48`)** — `48 % 12 + 1 = 1` (**#01 吕敬人书籍设计 Lü Jingren Bookcraft**, adapted to a dense Japanese/CJK catalog index strip with restrained vermilion/primary focal seal).
- **What is borrowed**: Calm margin rhythm, warm ink hierarchy, single restrained primary/vermilion running indicator seal (`训`), fine horizontal index rules, quiet typographic header (`任务簿 · 13`).
- **Skeleton**: `226px` clean margin column → quiet editorial heading + count → subtle underline search → spacious-yet-compact 30px index lines with square architecture stamps → minimal footer.
- **Why kept as backup**: Very refined and quiet, though slightly literary for a technical multi-GPU ML studio; kept in `thumbs.html` if the user wants an ultra-calm editorial feel.

---

## Selection Summary (Diversity & Anti-Slop Check)
1. **`dir-1.html` (Candidate 1 · 细线台账 Hairline Ledger, `224px`)**: Single-column Tufte hairline table + inline filter strip + collapsible drawers. *(Matches the approved right-side tab aesthetic 1:1.)*
2. **`dir-2.html` (Candidate 3 · 架构分组树 Grouped Workspace Tree, `232px`)**: Collapsible architecture groups (`Anima` / `Krea 2` / `MOSS`) + docked mini-queue card + inline segmented creation. *(Organizes by model family.)*
3. **`dir-3.html` (Candidate 4 · 双轨速切栏 Dual-Rail Sidebar, `234px`)**: `38px` icon/filter rail + `196px` full-height job list + rail-triggered popovers/drawers. *(Maximizes vertical job list capacity.)*

All three have **genuinely distinct layout skeletons** (single-column tabular ledger vs. collapsible grouped tree vs. split dual-rail), keep the right-side tabs 100% intact, display explicit architecture types on every job, and fit 10–13+ jobs cleanly in a compact footprint.
