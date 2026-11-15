# Codebase Details — BRAINSTORM

Status: completed. English transcription of the returned review. Eight Majors, no Blockers. Core lens: local observability and debuggability. No server, remote telemetry or distributed tracing platform is proposed. The starter is unverified evidence, not approved design. Reviewer made no changes.

## Findings

### C1 — Major: Superseded notes can misdirect later design

Brief lines 11/34/40/53 confirm independent copying and new-directory export, while notes lines 27–33 discuss ZIP/source references, line 124 says OS unconfirmed and lines 176–178 say ownership remains undecided. Mark historical passages clearly. Current user requirements are settled on Android/private copy/directory output; ZIP, captions-only and global-tag extras remain proposals.

### C2 — Major: Import completion needs explainable recovery state

Brief lines 11/13/23/25 recognize the risk but do not define visible recovery results. Starter app/lib/dataset.ts:3–7,14–16,47–48 uses File objects and 128 MiB limits; app/lib/archive.ts:18–21 and app/workers/archive.ts:8–17 buffer whole archives; archive.ts:7 uses a generic 120-second timeout. Proposed: local scan/copy/verify/complete/cancel/recover states, discovered/copied/verified counts and bytes, actionable failure reasons. Verification strength and whether completion with excluded files is allowed remain decisions; full hashing is not confirmed.

### C3 — Major: Android authorization failures need distinct outcomes

Notes lines 112/116–122 propose directory access. Starter device.ts:13–29 handles cached ZIP sharing; no directory picker/persisted recursive access was found in the files read. package.json:18–23 dependencies are not evidence of integration. Proposed: distinguish denied authorization, missing source, per-entry read failures and destination failures; explain reauthorization/resume. A completed project must open without source permissions. Android/library behavior remains unverified.

### C4 — Major: Saved must acknowledge the relevant edit version

Brief lines 25/64 and notes lines 100–102/189 leave durability and undo open. Starter dataset.ts:6–7 is an in-memory model; no durable save acknowledgement was found in the inspected files. Proposed: revision-bound saved state, visible failures across navigation, later checks for rapid image switching and reopening the last confirmed revision. Undo is a separate proposal requiring scope, retention and restart policy; permanent history is not implied.

### C5 — Major: no-vlm needs inspectable parsing provenance

Notes lines 71/140/154/166 distinguish missing/empty/uncertain/manual states. Starter captions.ts:7–10,25–39 uses heuristics and sometimes returns uncertain=false directly; no misclassification rate was measured. dataset.ts:55–56 and archive.ts:25 impose prototype empty-caption behavior that is not approved policy. Proposed: retain source text, structured fields, parse/manual origin and explicit missing/empty/unconfirmed states. Preview should explain why absence of prose was inferred. Current heuristics do not establish a caption specification.

### C6 — Major: Translation errors and stale results need separation from source

Brief lines 13/35–36 confirm preview-only translations. Starter device.ts:32–45 fixes Chinese/English and English-to-Chinese direction; lines 42–44 explicitly check one model before translation. captions.ts:50–56 separates source serialization, but complete persistent flow is not established. Proposed: bind previews to source revision/language/provider, distinguish pending/unavailable/failed, isolate caches from export text. No automatic addition of model-management, dictionaries or broad language support.

### C7 — Major: Moves and previews need stable operation identity

Brief lines 19–23/38–39 and notes lines 60–61/81–86/98–99 discuss explicit runs, versioning and transactions. Starter dataset.ts:6/47 initializes id from path. captions.ts:4/58–72 applyRules means caption cleanup, not folder classification. Proposed: stable image IDs, separate paths, plans recording revision/matches/original and candidate paths/manual decisions, explicit unresolved-item policy, and actual moved/unchanged/skipped/failed counts corresponding to preview. No implicit priorities, multi-membership or full query language.

### C8 — Major: Export needs recognizable incomplete delivery

Brief lines 23/40 and notes lines 103–106/158–160 confirm directory output. Starter archive.ts:23–33 reads all images into arrays and creates ZIP; device.ts:15–21/29 converts Blob to Base64 for cached ZIP sharing. This is not directory export. dataset.ts:51–53 only returns orphan TXT names/skipped counts and does not establish unknown-file policy. Proposed: version-bound manifest/progress, explicit failure paths/completion state, collision/cancel/retry policy and no assumed provider-wide atomic rename. Empty captions/orphan TXT/unknown files remain decisions.

## Exact files fully read

Bundle root: C:/Users/rby20/.codex/plugins/cache/egm/egm/0.1.1/

1. agents/codebase_details.md
2. resources/document_standards/re-implementation-standard.md
3. resources/document_standards/feature-spec-standard.md

Project root: C:/Users/rby20/Desktop/Anima-Standalone-Trainer/

4. concepts_brief.md
5. docs/dataset-mobile-concept-notes.md
6. dataset-mobile/package.json
7. dataset-mobile/nuxt.config.ts
8. dataset-mobile/capacitor.config.ts
9. dataset-mobile/app/workers/archive.ts
10. dataset-mobile/app/lib/device.ts
11. dataset-mobile/app/lib/dataset.ts
12. dataset-mobile/app/lib/captions.ts
13. dataset-mobile/app/lib/archive.ts

The persona requires no named extra standard for BRAINSTORM. Two were read voluntarily, without imposing implementation-spec detail on the concept. File list searches are not counted as content reads. References above refer to the pre-review brief/notes backups and inspected starter versions.

## Limits

FastCtx unavailable; PowerShell and rg fallback. No build, test, install, network research, Android execution, dependency compatibility check, device benchmark, file change or commit. Findings about code are limited to inspected files; they do not prove other repository capabilities absent. Majors are issues for detailed design, not demands to implement all suggestions now.
