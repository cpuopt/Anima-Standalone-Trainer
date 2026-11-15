# Design Critic — BRAINSTORM

Status: completed. This English transcription preserves the returned review's substance. Two Blockers, six Majors, one Nit. Blockers concern readiness to resume implementation, not rejection of the concept. Reviewer made no changes.

## Findings

### D1 — Blocker: Independent import needs a verifiable completion contract

Evidence: brief Overview/Analysis; notes Confirmed dataset scale, Confirmed project ownership and save model, Confirmed entry workflow. A readable copy can still be truncated. Source changes, interrupted copying, permission loss, and mismatched database/file state make the promise of independence unsafe without a completion definition. Decide included files, verification strength, source-change detection, restart state, and reauthorization behavior. Proposed: a persistent per-file manifest, verified copies, explicit incomplete/complete project state, and recovery or cleanup for app-owned orphan files. Size checks versus content hashes have different I/O costs.

### D2 — Blocker: Real-time save lacks an acknowledged durability boundary

Evidence: brief Analysis/Key Decisions; notes Confirmed project ownership and save model. Input, bridge requests, commits, navigation, and UI acknowledgements can arrive out of order. Decide what saved means, failure retention, background/process-death behavior, and recovery. Proposed: stable image IDs, revision ordering, acknowledgement after the relevant database commit, retained failed drafts, and explicit retry. Undo is separate and remains a scope/depth decision.

### D3 — Major: Byte counts do not cover operation stages or device resources

Evidence: brief Overview/Analysis; notes File handling implications and ownership. The 15 GB illustration is not a capacity algorithm: source, private storage and destination can occupy different volumes. Thumbnails, models, history and temporary files add storage; compressed size does not bound decoded pixels. Decide device/OS floor, stage-specific space estimates and resource budgets. Proposed: bounded decoding/cache/concurrency and later representative-device measurements. No throughput is yet demonstrated.

### D4 — Major: Parsing uncertainty affects training content and classification

Evidence: notes Concrete classification rules, Per-image editor, Batch cleanup and formatting. A wrong prose boundary can drive wrong no-vlm moves; repeated parsing/serialization can change untouched text. Decide parse states, saved corrections, formatting effects and unknown-condition behavior. Proposed: retain raw text separately from editable fields, parse status and output format; show missing/empty/uncertain states distinctly and validate supported dialects on real samples.

### D5 — Major: Translation has unverified local resource and privacy costs

Evidence: brief Overview/Key Decisions; notes Per-image editor/Main objections. Languages/provider, dictionary coverage, model size, downloads, offline behavior and low-memory behavior are unknown. Proposed: on-demand translation, bounded caches keyed by source/language/provider version, separate evaluation of tag dictionaries and prose models, and no implicit translation-to-training-text write path. No basis exists for cloud token/QPS estimates or automatic cloud fallback.

### D6 — Major: Logical paths need shared identity and pairing constraints

Evidence: brief Goals; notes ownership and rule sections. Same stems, image extensions, case differences and renames can collide at export. For example, 001.jpg and 001.png both need 001.txt. Decide asset identity, caption pairing, path equality and conflict behavior. Proposed: stable IDs independent of paths and shared validation during import, moves and export. Multiple subset membership is not confirmed.

### D7 — Major: Preview and manual resolution need execution consistency

Evidence: notes Concrete classification rules/Confirmed conflict checkpoint. Tags, paths or rules can change after preview. Same-destination multiple matches and unresolved items have no final policy. Decide scope, combined-condition semantics, conflict definition and invalidation. Proposed: explainable plans bound to project/rule revisions, validation before commit, run-only manual overrides and recoverable logical changes. Batch conflict controls and a complex query language are not automatically first-release scope.

### D8 — Major: New-directory export needs success and retry semantics

Evidence: brief Analysis; notes ownership/export. Destination permission loss, full storage, cancellation and process death can leave partial output; a retry can mix revisions. Do not assume external providers support filesystem-like atomic rename. Decide snapshot version, completion predicate, partial-output identification, retry and cleanup ownership. Proposed: a fixed-version manifest and per-file progress, success only after every required item, explicit partial-result reporting, and cleanup restricted to confidently owned output. No temporary full ZIP is needed by the confirmed workflow.

### D9 — Nit: Historical notes conflict with confirmed direction

Evidence: notes Alternatives under consideration, Export check, platform paragraph. Source-linked editing, unconfirmed platform and archive language survive after later Android/private-copy/new-directory confirmations. Mark superseded statements clearly and distinguish confirmed/proposed/historical status.

## Cost and scope conclusion

The single-device local workflow is dominated by storage copies, image decoding, translation resources and recovery complexity. It does not justify cloud infrastructure, service QPS budgets or complex query infrastructure. Undo, conflict-group bulk controls, global statistics, vocabularies and ZIP remain proposals.

## Exact files read and limits

1. C:/Users/rby20/.codex/plugins/cache/egm/egm/0.1.1/agents/design_critic.md
2. C:/Users/rby20/Desktop/Anima-Standalone-Trainer/concepts_brief.md
3. C:/Users/rby20/Desktop/Anima-Standalone-Trainer/docs/dataset-mobile-concept-notes.md

Reviewer also enumerated bundle paths matching standard/brainstorm/concept but did not read them. No extra standard is required by this persona's BRAINSTORM branch. No app execution, starter audit, Android API verification, library/model verification, device benchmark, external source or memory retrieval occurred.
