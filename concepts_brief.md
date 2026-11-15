# Android Dataset Caption Editor

* **Author:** cpuopt
* **Date:** 2026-11-11
* **Status:** Seven-lens BRAINSTORM review completed. Working concept, not approved implementation design. Implementation remains paused.

## Overview

Build an Android app with a Nuxt interface inside a native WebView shell to inspect image training datasets on a phone. The workflow is local directory import, overview navigation, per-image tag and natural-language editing, training-subset organization, and image/TXT export to a new directory.

After directory authorization, import recursively copies the dataset into an independent project. A completed project must work after its source is moved, removed, or its grant revoked. Every edit is saved to an internal database. Private image files plus database metadata are a proposal, not a selected alternative to image BLOBs.

Expected workload is 100–1,000 images averaging 5 MB, approximately 0.5–5 GB of originals; this is not an agreed hard cap. Dataset processing stays on-device. Tag/prose translations are previews only and must never enter exported training text. Languages, provider and download policy remain open.

## Analysis

All seven fresh-context reviewers completed. The [deduplicated report](docs/reviews/dataset-mobile/goldfish_review_report.md) contains two implementation-readiness Blockers and nine Majors, including one historical-document issue addressed during synthesis. No reviewer established concept failure. No application code, dependency installation or commit occurred. Reports and pre-review backups are linked there.

The first Blocker is the independence promise: selecting a folder or reading a copied file does not prove all required data was copied completely. Decide verification, unreadable items, changed sources, interruption, lost authorization, cancellation and recovery before reporting completed import. Persistent jobs/manifests are proposed mechanisms, not approved algorithms. Completed projects must no longer need source access; source read grants do not establish destination write access.

The second Blocker is saved-state meaning. Define what an acknowledgement guarantees across delayed writes, rapid navigation, backgrounding, process death and reopening. Proposed stable IDs, revisions and commit acknowledgements could prevent stale saves or false success. Failures need visible retained work and a next action. Undo remains separate: scope, depth and restart/upgrade retention are not approved.

The inspected starter is unverified prototype evidence: File objects, a 128 MiB archive limit, whole-archive buffering and ZIP sharing do not demonstrate the required native directory lifecycle. Caption cleanup rules are not folder classification. Candidate dependencies/configuration do not prove Android integration. Do not reduce the confirmed expected workload to fit the starter. Native incremental operations, bounded decoding/cache and small bridge messages are proposals; a worker alone does not bound whole-dataset memory. Device/OS floor and format/dimension limits need later evidence. Estimate additional space per operation/volume. A 5 GB source + private copy + export can occupy around 15 GB on one device before overhead; that is an illustration, not a universal free-space rule.

Manual image inspection remains central. Assess a long caption with the phone keyboard open before selecting layout: image context, tags/prose, save state and previous/next navigation must remain understandable. Parsing correction should not become a large prerequisite annotation task. Keep raw TXT comparable with editable fields; punctuation/newlines do not reliably identify tags/prose. Missing TXT, empty content, uncertain parsing and confirmed absent prose need distinct policies, particularly for no-vlm. Proposed shared caption authority would preserve manual boundaries across rules and serialization. Output-layout changes must not silently re-author content.

Source text must stay visibly editable/exportable while translations remain previews. Unavailable or stale translations must not look like empty source. Evaluate minimum useful languages/provider on real tag/prose samples before adding dictionaries or several backends. On-demand bounded previews are a proposal; no cloud fallback is approved.

Folders are training subsets; the trainer assigns repeat values separately. Users create subdirectories and move image/TXT pairs manually. Stable asset identity separate from source/private/logical/export paths is proposed so moves retain edits without recopying originals. Decide caption pairing and collisions, including 001.jpg and 001.png both needing 001.txt. Multiple subset membership is unconfirmed.

Classification runs only when explicitly started, with combined conditions. Confirmed examples move newest-tagged images into newest/ and images without prose into no-vlm/. An image can match both: preview must expose conflicts for manual handling, without silent priorities or edit-triggered moves. Define condition normalization, execution scope, same-destination overlaps, uncertain-prose behavior and unresolved-item handling. Version-bound reviewed plans are proposed; they add temporary state/re-evaluation costs. Many overlapping images can make individual decisions burdensome. Whether one manual choice may apply to a selected conflict group remains a user decision, not an approved feature.

New-directory export needs a consistent project version, explicit collisions, completion criteria and identifiable partial output after failure/cancellation. Retry must not mix revisions. Do not assume every Android provider supports atomic directory publication or require a full ZIP intermediate. Training image/TXT export does not automatically restore rules/history/review metadata. Project deletion, uninstall/data-clear loss, backup expectations and upgrade recovery remain lifecycle decisions.

The inventive lens found no false compromise. Advisory patterns support separating bulk assets from logical placement, durable edits from derived previews, and reviewed plans from execution. Those boundaries add consistency/recovery work; no pattern eliminates real storage costs of independent copies/full export. The ideal result is a source-independent completed project, visibly durable edits, previews excluded from training text, and only reviewed moves/complete outputs reported successful.

The reference [BooruDatasetTagManager](https://github.com/starik222/BooruDatasetTagManager) informs editing/navigation ideas through previously supplied README notes, not a runtime/source audit in this review. Its desktop panels and optional features do not define this release. Prove the confirmed lifecycle before adding global/batch tools.

## Goals vs. Non-Goals

### Confirmed goals

* Android-only first release using Nuxt/WebView.
* Authorized recursive local-directory import into an independent project.
* Overview and per-image manual tag/prose editing with translation previews.
* Separate tags/prose with combined-line, separate-line and sentence-per-line formatting.
* Real-time database persistence of edits.
* Manual subdirectory creation and image/caption-pair moves.
* Explicit combined-condition classification with pre-execution manual conflict handling.
* New-directory export following the edited logical tree.

### Outside confirmed scope

* iOS in the first release, ongoing source dependence, continuous classification and implicit rule priority.
* Uploading dataset content for processing or exporting translated previews as training text.

Video, retouching, automatic captions, cloud sync, repeat configuration, ZIP/captions-only output, vocabularies, full project backup, global tags and broad batch tools remain unrequested or unapproved. Undo is a review proposal. This records approval status, not rejection of every future option.

## Alternatives Weighed

* **Source-linked editing:** superseded by confirmed independent import.
* **Continuous classification/automatic precedence:** superseded by explicitly started runs and manual preview conflicts.
* **Whole-dataset browser/worker buffering:** reviewers find no evidence it meets expected scale. Native incremental handling is proposed; libraries/budgets remain unselected.
* **Image BLOBs versus private files:** unresolved. Separating bulk assets from mutable metadata adds file/database recovery coordination.
* **Desktop panels versus linked phone views:** unresolved; assess keyboard-open inspection before selecting layout.
* **General local translation versus dictionary/prose split:** unresolved; establish language/quality/resource needs first.
* **Directory delivery versus added archive/backup modes:** directory delivery confirmed; other modes remain proposals.

Only explicitly superseded alternatives above are settled by recorded user requirements. Reviewer recommendations are not user decisions.

## Key Decisions & Staging for Next Steps

The confirmed lifecycle remains import → overview → per-image correction → manual subsets → explicit classification preview/run → new-directory export. All seven lenses completed; this is reviewed working material, not final alignment or authorization to resume implementation.

Next discussion should resolve the practical manual-conflict workflow, including whether selected conflict groups may share one manual resolution. Other consequential choices are import completion/recovery, saved-state promises, caption examples/uncertain no-vlm behavior, translation constraints, pairing/collisions, export recovery, project compatibility and device validation. These are proposed discussion topics, not added requirements or selected mechanisms.

If later authorized, feasibility work should exercise interrupted copy/reauthorization, source removal after verified import, save failure/reopen, ambiguous captions, overlapping/stale rule previews, same-stem collisions and partial directory exports on representative Android devices. None of that testing has occurred. Implementation remains paused pending the user's next instruction.
