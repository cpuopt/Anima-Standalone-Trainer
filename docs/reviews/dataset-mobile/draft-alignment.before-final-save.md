# Predecessor Alignment — Android Dataset Caption Editor

* **Author:** cpuopt
* **Date:** 2026-11-12
* **Predecessor:** [concepts_brief.md](../../../concepts_brief.md)
* **Approved draft:** [design_draft.md](../../../design_draft.md)
* **Method:** Same-author reconciliation against the ingested brief, not a fresh-context Goldfish review or a code/runtime audit.

## Scope differences first

These differences are recorded rather than silently rewriting either document to match the other. They have already been decided by the author in the intervening conversation. No new contradictory user request was introduced during finalization.

| Brief quotation | Draft quotation | Resolution already supplied by the author |
| --- | --- | --- |
| “manual tag/prose editing with translation previews” | “Uncovered tags and VLM prose remain English.” | The user explicitly deferred local machine translation and confirmed the proposed first-release scope: imported Chinese tag text stays, missing tag translations use English, VLM machine translation and model downloads are postponed. D9/D10 are superseded, not pending engine choices. |
| “vocabularies ... remain unrequested or unapproved” | “Imported Danbooru references are in scope” | The user subsequently requested Danbooru translations/introductions, selected a separate SQLite reference (D8 A), accepted defined CSV/JSON conversion (D22 B) and exact-key field merging (D25 B). This is an explicit scope addition, not reviewer scope expansion. |
| “Undo is a review proposal.” | “Current-session undo is selected in D20.” | The user selected current-session undo, not persistent history. That narrows the recovery feature and excludes project deletion/external-output recovery. |

The original local-processing, independent-project, manual editing, subset-folder, explicitly started classification, manual conflict-review and new-directory export goals remain. No online caption processing, live source dependence, continuous rule execution, implicit priority, first-release iOS or trainer repeat configuration was added.

## Architecture, interface and dependency additions

Only additions that affect architecture, interfaces or dependencies are recorded here. The brief intentionally left many of these unresolved. Later author choices and the explicit approval of Detailed Implementation on 2026-11-12 supply the necessary consensus; they are not open contradictions requiring the same question again.

| Addition or resolved proposal | Recorded author authority |
| --- | --- |
| Nuxt + Capacitor + Kotlin + Room/SQLite, native domain authority, typed bridge and local image-resource routing | User requested refinement according to the proposed stack; approved Technical Plan, then the file/API/dependency contracts in Detailed Implementation. |
| Private immutable originals/source-caption copies, database-backed edits, stable IDs and logical placement | D2 A selects private files plus database records; Technical Plan and Detailed Implementation approvals cover concrete ownership/record boundaries. |
| Coalesced text saves, native commit acknowledgement, latest-revision/navigation barriers and session inverse history | D1 B and D20 A; exact scheduling/bounds/operation contracts were visible in the approved Detailed Implementation. |
| Import read-back hashing, explicit exclusions, manual ambiguous pairing, unannotated images and other-file omission report | D3 B, D4 B, D15 A, D16 A and D24 B resolve the brief's open inventory/verification issues. Independence applies to accepted training content, not a complete backup of all source files. |
| Nested rule tree, exact-tag comparison, conservative uncertain-caption gating, multi-selection resolutions and explicit skips | D7 B, D11 B, D12 B, D19 A and D23 A; final approved contracts define the tree, readiness and revision-bound plan interface. |
| Manual destination-name resolution and preflight exclusion of empty/unconfirmed uncertain captions | D14 A, D17 B and D18 B; no silent image omission, renaming or guessed export layout is permitted. |
| Read-only export, checked continuation, foreground-only pause/recovery and partial-output identification | D5 A, D6 B and D21 A; approved Detailed Implementation covers per-item digest/marker/revision contracts. |
| Independent reference schema v1, CSV/JSON/SQLite input, field provenance and staged activation | D8 A, D22 B and D25 B; the approved detailed section fixes the external input/merge API rather than claiming arbitrary upstream compatibility. |
| compile/target SDK 36, pinned build/dependency baseline, min-SDK template baseline and actual-device test matrix | D26 A; OnePlus 13T / Android 17 is user-reported, not benchmark evidence. Pins, engineering caps and prospective tests were part of the approved detailed section. |
| Exact file manifest, removal of prototype ZIP/translation paths, shared fixtures and native/UI tests | Detailed Implementation approved explicitly on 2026-11-12. The manifest describes future work only, not code changes already made. |

## Remaining evidence, not unresolved design consensus

* Toolchain interoperation, generated-path differences and real Android behavior require later authorized implementation checks.
* The upstream tag dataset remains unselected and unbundled; the approved import contract can accept converted data without selecting a provider now.
* Actual phone build/API/WebView, memory, image dimensions and parser quality must be measured. No new runtime evidence or claims are created by author approval.
* Fresh design-document review has not run. The earlier seven reviewers reviewed the concept, not this finalized implementation document.

**Open contradictions requiring a new author decision:** none. Existing later author decisions resolve the listed predecessor differences. Do not revert those decisions to match the historical brief, and do not treat document approval as production implementation authorization.

## Finalization state

Detailed Implementation is approved. The final design destination remains subject to the EGM save-location gate. No existing docs/designs directory or SITEMAP.md was found during the workspace probe; the workflow default is docs/designs. No final destination file has been written yet. Production implementation remains paused.
