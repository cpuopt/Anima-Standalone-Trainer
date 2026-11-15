# Structural / Maintainability — BRAINSTORM

Status: completed. Six Majors, no concept-level Blockers. Core lens: Long-Term Tech Debt & Maintainability. Proposed invariants support confirmed scope; none approves the starter or adds features.

## Findings

1. **S1 — Major: Caption authority must be shared by editing, rules and export.** Evidence: brief Analysis; notes rule examples/editor/formatting. Independent boundary inference can undo manual correction or make no-vlm inconsistent. Proposed: one representation separating source, confirmed fields, uncertainty and presentation; formatting must not reparse committed content.
2. **S2 — Major: Stable identity must survive moves and ambiguous stems.** Evidence: brief Analysis; notes ownership/entry workflow/export. Source, private, logical and export paths differ; path identity couples history/caches/rules to moves. Shared stems can require one TXT for two different images. Proposed: stable IDs, explicit pairing/export namespace and no physical recopy for logical moves. Private-file storage remains a proposal.
3. **S3 — Major: Editing and bulk moves need one mutation boundary.** Evidence: brief Analysis; notes ownership/conflict checkpoint. Separate save paths permit delayed overwrite or actions on partially saved state. Proposed: revision/transaction/acknowledgement semantics shared by changes, and pending/failed-edit behavior for navigation/run/export. If adopted, undo should share this model rather than multiply independent histories.
4. **S4 — Major: Files and database need a recoverable lifecycle.** Evidence: brief Overview/Analysis; notes ownership/entry workflow. Database transactions cannot atomically copy gigabytes; files/records/export output can disagree after failure. Proposed: persistent job states, reconciliation, cancellation/restart/verification/publication and ownership rules for orphan/temp files. Detect or explicitly handle changed sources on resume.
5. **S5 — Major: Preview must be an executable valid plan.** Evidence: brief Analysis; notes subsets/rules/conflicts. Re-evaluation at execution can change the reviewed set; retained decisions can become stale. Proposed: revision-bound plan with stable IDs, matched conditions, paths, conflicts and manual choices; define invalidation, same-destination overlap and scope. No priorities/query language/continuous enforcement implied.
6. **S6 — Major: Native/WebView boundary needs bounded resource ownership.** Evidence: brief Overview/Analysis/Alternatives; notes file implications/Main objections. Native handling still fails if giant byte arrays/listings cross into JS or page lifetimes own jobs/decodes. Proposed: identifiers/paged metadata/progress/durable job handles, explicit decode/cache/cancel/recovery ownership, device/resource evidence before scale claims. Capacitor/libraries remain unverified candidates.

## Exact files fully read

- C:/Users/rby20/.codex/plugins/cache/egm/egm/0.1.1/agents/structural.md
- C:/Users/rby20/Desktop/Anima-Standalone-Trainer/concepts_brief.md (pre-review lines 1–66)
- C:/Users/rby20/Desktop/Anima-Standalone-Trainer/docs/dataset-mobile-concept-notes.md (pre-review lines 1–196)

## Limits

No extra BRAINSTORM standard required. FastCtx absent; completed PowerShell reads. No code/web/external research/build/test/install/write/commit/memory/history. Historical ZIP/source-linked/platform statements not treated as competing requirements. Maintainability analysis establishes no starter feasibility.
