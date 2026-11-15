# Implementation Readiness — BRAINSTORM

Status: completed. Six Majors, no Blockers. Core lens: Migration & Backward Compatibility. These are proposed concept-level safeguards, not implementation instructions or approved additions.

## Findings

1. **M1 — Major: Project compatibility needs an ownership policy.** Evidence: brief Overview/Key Decisions; notes ownership. After source removal an internal project may hold the only working copy; upgrades can strand assets/records. No legacy population is verified. Proposed: versioned format, protect newer projects from incompatible writes, preserve last usable state on failed upgrade, decide downgrade/recovery support. Starter structures establish no compatibility promise.
2. **M2 — Major: Incomplete import jobs need a separate compatibility boundary.** Evidence: notes ownership/entry workflow; brief Analysis. Permission/source changes or updates during a large copy can invalidate persisted progress. Proposed: incomplete/complete states, resumable-job version handling, visible source-change/reauthorization policy and preservation of existing completed projects. Verification strength remains open.
3. **M3 — Major: Autosave, undo and upgrade recovery are distinct promises.** Evidence: brief Analysis/Key Decisions; notes ownership/Main objections. A schema migration might preserve captions but invalidate history. Proposed: define saved durability across suspension/death/reopen; decide undo restart/upgrade scope separately and never replay incompatible history. No database/undo algorithm selected.
4. **M4 — Major: Parser/translation upgrades must not silently re-author captions.** Evidence: notes rules/editor/formatting; brief Overview. Parser changes can erase manual boundaries or alter no-vlm membership. Proposed: preserve raw text, authoritative edited fields, corrections and uncertainty separately from preview caches; explicit reparse/normalization policy. Translation stays excluded from TXT.
5. **M5 — Major: Rule-plan compatibility can invalidate manual decisions.** Evidence: notes subsets/conflict checkpoint. Path identity, changed rules/tags and semantic upgrades can stale reviewed plans. Proposed: stable asset identity and validity/re-evaluation policy, preserving decisions only where applicable. Saved persistent plans/general query language are not implied.
6. **M6 — Major: Training export and full project backup have different recovery claims.** Evidence: brief Analysis; notes ownership/export. Partial destination writes need identifiable outcomes and non-mixing retry. Image/TXT output omits corrections/review/rules/history. Proposed: retain project on failure, define partial-output/retry policy, and decide whether training export alone is sufficient initial recovery. No backup import/export feature is automatically added; migration storage overhead must be considered if such safeguards are selected.

## Exact files fully read

- C:/Users/rby20/.codex/plugins/cache/egm/egm/0.1.1/agents/implementation_readiness.md
- C:/Users/rby20/Desktop/Anima-Standalone-Trainer/concepts_brief.md
- C:/Users/rby20/Desktop/Anima-Standalone-Trainer/docs/dataset-mobile-concept-notes.md

## Limits

No extra BRAINSTORM standard required. No code/starter/database/external references/memory/history inspected. No writes/install/build/tests. Android/private copy/directory export treated as confirmed; conflicting historical passages superseded. Implementation remains paused.
