# Goldfish Review Report

**Target:** Android Dataset Caption Editor, concepts_brief.md and docs/dataset-mobile-concept-notes.md. Mode: BRAINSTORM. Date: 2026-11-11.

All seven requested reviewers completed in fresh conversation contexts. The concept can proceed to further design discussion; implementation remains paused. No reviewer established a concept-fatal defect. The two Blockers below mean unresolved safety promises before implementation resumes, not reasons to reject the product.

## Reviewer Status

| Reviewer | Status | Individual report | Raw severity counts |
| --- | --- | --- | --- |
| egm-design | completed | [design.md](design.md) | 2 Blocker, 6 Major, 1 Nit |
| egm-codebase-details | completed | [codebase_details.md](codebase_details.md) | 8 Major |
| egm-zoom-out | completed | [zoom_out.md](zoom_out.md) | 6 Major, 1 Nit |
| egm-comprehension | completed | [comprehension.md](comprehension.md) | 7 Major |
| egm-implementation-readiness | completed | [implementation_readiness.md](implementation_readiness.md) | 6 Major |
| egm-structural | completed | [structural.md](structural.md) | 6 Major |
| egm-inventive-catalyst | completed | [inventive_catalyst.md](inventive_catalyst.md) | 3 advisory Nit; no false compromise detected |

**Deduplicated result: 2 Blockers, 9 Majors, 0 standalone Nits.** Low-severity reuse/pattern advice is incorporated into the relevant findings, not counted again. Historical-document inconsistency takes the higher Major severity reported by codebase. Its document repair is completed; the other ten findings remain design questions/proposals.

## Confirmed requirements versus proposals

Confirmed: Android first release; Nuxt in native WebView; local recursive authorized-directory import into an independent project; expected 100–1,000 images averaging 5 MB (about 0.5–5 GB, not a hard cap); database-backed real-time edits; per-image manual tags/prose and preview-only translations; combined-line/separate-line/sentence-line formatting; overview; logical training-subset folders and manual moves; explicitly started combined-condition classification; conflict preview with manual resolution; new-directory export. Source files are unnecessary after completed import. Source TXT is not overwritten.

Not confirmed by review: Capacitor/provider/database/library selection, private image files versus database BLOBs, format version mechanism, manifests/checksums, undo depth or permanence, group conflict resolution, full query language, global statistics/bulk caption tools, ZIP/captions-only output, project backup format, or numerical device/resource limits. These remain recommendations or questions. User confirmation of review was not approval of any proposed implementation.

## Prioritized Findings

### B1 — Verifiable independent import — Severity: Blocker

**Lenses:** D1, C2/C3, Z2, U2, M2, S4. **Scope/evidence:** pre-review brief Overview/Analysis; notes ownership/entry workflow; codebase report references dataset.ts and archive worker.

Selecting a folder, copying some bytes, or reading a copied file does not prove the whole project is independent. Interruption, changed source, unreadable entries, revoked grants and file/database disagreement require a completion policy. Decide what must be copied, verified or explicitly excluded before independence is promised, and what cancellation/resume preserves. Proposed persistent job/manifests and verification are mechanisms to evaluate, not mandated algorithms. Read and write grants are separate; completed project editing must not require source access.

### B2 — Honest durable-save acknowledgement — Severity: Blocker

**Lenses:** D2, C4, U3, M3, S3, I2. **Scope/evidence:** brief Analysis/Key Decisions; notes ownership/save model.

Define what saved means across asynchronous writes, rapid navigation, backgrounding, process death and reopen. A delayed response must not mark a newer draft saved or overwrite another image. Proposed stable IDs/revisions and commit acknowledgements need design, with visible failure retention/retry. Decide undo independently: autosave is confirmed, unlimited or cross-restart undo is not.

### M1 — Native boundary, device resources and Android feasibility — Severity: Major

**Lenses:** D3, C3, Z2/Z7, S6. **Evidence:** scale/file-handling notes; codebase report inspected starter references.

The inspected starter uses File objects, a 128 MiB archive limit, whole-archive buffers and ZIP sharing; it does not establish the required lifecycle. Dependencies/configuration do not verify native integration. Choose minimum-device/OS and supported file envelope later, and measure decoding/storage/I/O on representative devices before capacity claims. Keep large bytes out of unbounded WebView/bridge state. Budget per-operation additional space and destination volume, not a blanket 15 GB rule. The 15 GB example is source + private + export on one device before overhead.

### M2 — Authoritative caption content and uncertainty — Severity: Major

**Lenses:** D4, C5, Z4, U4, M4, S1. **Evidence:** rule examples/editor/formatting notes.

Parsing affects editor, no-vlm rules and export. Preserve manual boundaries and distinguish missing TXT, empty content, unknown parse and confirmed absent prose. Decide how unknowns participate in classification. Propose one authoritative editable interpretation plus retained raw text; layout changes must not silently reparse/re-author captions. Validate dialects on real samples and keep correction effort practical for a phone.

### M3 — Preview translation feasibility and source separation — Severity: Major

**Lenses:** D5, C6, Z3, U5, I2. **Evidence:** brief Overview; notes translation/editor; inspected device.ts in codebase report.

Languages/provider/download policy, terminology quality and local resource costs are open. Source must stay visibly editable/exportable; unavailable/stale translations must not look like empty source or enter TXT. Proposed revision-keyed previews and bounded on-demand work do not authorize dictionaries, several backends or cloud fallback. Evaluate minimum useful behavior on tags and prose before choosing provider.

### M4 — Stable image identity and export namespace — Severity: Major

**Lenses:** D6, C7, S2, I1. **Evidence:** notes ownership/entry/export; codebase report dataset.ts path-based ID.

Source identifiers, private locations, logical paths and exported stems have different roles. Moves must retain caption/history/cache identity. Two same-stem images may require one colliding TXT even if extensions differ. Define pairing, case/path comparison, unsupported/unknown/orphan file policy and collision handling. Stable IDs and logical moves without copying originals are proposed design invariants; multiple subset membership is not confirmed.

### M5 — Explicit rule execution must honor a practical reviewed plan — Severity: Major

**Lenses:** D7, C7, Z5, U6, M5, S5, I3. **Evidence:** notes subsets/concrete rules/conflict checkpoint.

Define condition normalization/combination, evaluation scope, same-destination overlap, skip/block behavior and preview invalidation. newest plus no-vlm can overlap on many images. Determine whether individual manual handling is sufficient or bounded group handling is needed; do not add priority or background moves. Version-bound explainable plans are proposed. They cost temporary state/recomputation and must preserve manual choices only while still valid.

### M6 — Complete directory delivery and project lifecycle — Severity: Major

**Lenses:** D8, C8, Z6, U7, M6, S4. **Evidence:** notes ownership/export; codebase report archive/device paths.

Bind export to a consistent project revision and define complete/cancelled/failed outcomes, collision policy, identifiable partial results and non-mixing retries. Do not assume provider-wide atomic rename or treat share-dialog success as directory delivery. Preserve internal project on failure and clean only confidently owned output. Training image/TXT export does not imply restorable rules/history/review metadata. Decide deletion/backup expectations without automatically adding a backup subsystem.

### M7 — Future project compatibility — Severity: Major

**Lens:** M1/M3/M4. **Evidence:** ownership/save model and brief unresolved lifecycle.

The private project may become the only working copy. App/parser/schema changes must not silently rewrite manual content, strand assets or replay incompatible undo. Proposed format version/failed-upgrade preservation/unsupported-version protection deserve design. No legacy population or migration defect is established. Downgrade support and history retention remain choices, not assumed features.

### M8 — Phone editing and optional scope need concrete task evidence — Severity: Major

**Lenses:** U1, Z1/Z4/Z5. **Evidence:** notes overview/editor/global tags/candidate staging.

A long caption with keyboard open must remain usable with image context, save state and navigation. Test that journey at design/prototype stage before selecting layout. Baseline is the confirmed end-to-end lifecycle. Global tag tools, broad batch cleanup, vocabularies, trigger words and permanent history should enter scope only through demonstrated tasks and user decisions. Review proposals do not make them approved backlog items.

### M9 — Superseded notes need explicit authority — Severity: Major; addressed in documents

**Lenses:** C1/D9. **Evidence:** pre-review notes platform paragraph, ZIP discussion and Alternatives under consideration.

The notes retained source-linked/undecided-OS/archive-first language after Android/private-copy/new-directory confirmations. Added an authority banner and current status; preserved the original backup. Historical exploratory content remains for traceability and is explicitly superseded, not a competing user requirement. Updated brief removes stale readiness/no-review language.

## Inventive synthesis and limits of patterns

Inventive reviewer found no accepted false compromise. Advisory Segmentation/Intermediary supports immutable assets plus logical placement; it adds lifecycle/path consistency work. Extraction/Cushioning separates authoritative saves from previews and recoverable drafts; it adds stale-result/cancellation/recovery states. Preliminary Action/Intermediary prepares reviewed move plans; it adds temporary storage and invalidation/recompute cost. None removes real storage needed by independent copies and full export. Ideal result: a completed private project remains usable without source access, source edits are visibly durable, derived previews cannot change training text, and only reviewed moves/complete outputs are reported successful.

## Evidence and execution limits

- Original reviewed documents: [brief backup](concepts_brief.before-review.md), [notes backup](dataset-mobile-concept-notes.before-review.md). Individual reports record exact files read; old line references target these backups, while section references stay the primary locator.
- Every reviewer used fork_turns:none. Root and synthesizer consumed two of four slots, so reviewers ran in bounded waves of at most two rather than seven simultaneously. All seven completed; no reviewer failure/retry was needed.
- Fresh conversation context does not prove exclusion of filesystem instructions, host AGENTS.md or configured memory surfaces. Instruction-file isolation remains unverified. Reviewers were told not to retrieve memory/history; no such retrieval is reported.
- FastCtx tools were unavailable; selective PowerShell/rg reads were fallback. Reviewers read personas plus both supplied documents. No additional BRAINSTORM standard was mandatory for these personas; codebase also read two bundled standards voluntarily. No missing-required-read status is concealed.
- Codebase and zoom-out performed bounded starter inspection, not full repository audit. A zoom-out inventory inference about missing dataset.ts was rejected: codebase read it and synthesizer independently confirmed its existence. It is not a finding.
- Individual reports are synthesized English transcriptions of actual returned findings, not independently simulated reviews. Native child tool traces are not exposed to the synthesizer; exact reads are reviewer-reported, with the existence correction independently checked.
- No app build/run, dependency installation, Android device/API/provider validation, translation quality measurement, performance benchmark or code change occurred. No commits. External reference README claims remain prior supplied notes, not newly reverified evidence.
- Updated only review/analysis documents. The concept is reviewed, not finalized or approved for implementation. Next steps require resolving selected questions with the user; do not turn recommendations into decisions.
