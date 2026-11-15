# Android Dataset Caption Editor

* **Author:** cpuopt
* **Date:** 2026-11-11
* **Status:** Anchored working hypothesis awaiting user readiness confirmation. No Goldfish review has run. Implementation remains paused.

## Overview

Build an Android app using a Nuxt interface inside a native WebView shell. Its main purpose is to inspect image training datasets one image at a time, edit tags and natural-language captions, organize images into training subsets, and export a new dataset directory. Provide an overview to navigate images and editing progress.

The user places a dataset in phone storage and grants directory access. Import recursively copies the dataset into an independent app-owned project. After completed import, source files and permissions are no longer needed. Each edit is saved to an internal database. Original image bytes can be held in app-private files while the database manages captions and logical folders; that storage split is a proposal rather than a user requirement.

Expected workload is 100–1,000 images averaging 5 MB: about 500 MB–5 GB of originals. This is an expected range, not an agreed hard limit. Dataset processing stays on the device. Tag translations and prose translations are previews only and must not change exported training text.

## Analysis

The main workflow is manual image inspection and caption editing. Each image needs a large preview, individual editable tags, tag translation previews, a separate prose editor, and reliable navigation. Automatic parsing needs manual correction because sentence punctuation and line breaks do not prove where tags end and prose starts.

Folders represent training subsets. The user creates subdirectories and moves image/caption pairs into or out of them. The trainer assigns repeat values separately; configuring repeat inside this app has not been requested. The app exports using its edited logical folder structure.

Automatic organization is a separate, manually started operation. Confirmed examples are moving images containing the `newest` tag into `newest/`, and images without natural-language descriptions into `no-vlm/`. Combined conditions are required. Before execution, a preview shows rule conflicts for manual handling. Tag edits do not trigger background reclassification. Rule priority must not silently resolve conflicts.

Proposed implementation constraints include native incremental file operations, bounded thumbnail caching, persistent import progress, and transaction-backed caption/folder updates. A worker alone does not solve whole-dataset memory use. Import verification and recovery must prevent an incomplete copy from being presented as an independent completed project. Export must use a consistent project version and report incomplete output.

Autosave needs visible pending/saved/failed states and a defined durability point. Undo is a separate requirement proposal. Private storage is not a permanent backup: uninstalling or clearing app data may remove projects. A 5 GB source, private copy, and full export can occupy around 15 GB on the same device before overhead. Storage checks must reflect the actual operation.

The reference is [BooruDatasetTagManager](https://github.com/starik222/BooruDatasetTagManager). Its README documents an image list, selected-image tag editing, all/common tag panels, multi-image edits, translations, and autocomplete. These inform the proposed navigation and tag tools; the app has not been run or source-audited here. Its video and external automatic-tagging capabilities are not assumed requirements. Detailed notes and source links are in [the working notes](docs/dataset-mobile-concept-notes.md).

## Goals vs. Non-Goals

### Confirmed goals

* Android-only first release with Nuxt/WebView UI.
* Local recursive directory import into an independent project.
* Per-image inspection, manual tag addition/removal, and translation previews.
* Tags and natural language handled separately, with combined-line, separate-line, and sentence-per-line formatting.
* Dataset overview and real-time database save of edits.
* Manual subdirectory creation and image moves.
* Manually triggered classification with combined conditions and pre-execution manual conflict handling.
* Export to a new directory following the project's configured structure.

### Outside the confirmed scope

* iOS in the first release.
* Continuous automatic moves after tag edits.
* Dependence on original files after successful import.
* Uploading dataset content for processing or exporting translated preview text.

Video, image retouching, automatic caption generation, cloud sync, repeat configuration, ZIP export, and vocabulary imports have not been requested or approved. Their exclusion from a final backlog is still a scope decision.

## Alternatives Weighed

* **Source-linked editing:** superseded by the user's explicit requirement for an independent imported project.
* **Continuous rule enforcement:** excluded by the user's choice of a separate manually executed feature.
* **Automatic rule precedence:** superseded by the user's requirement to handle conflicts manually in preview.
* **Browser-only whole-dataset buffering:** unsuitable as the assumed architecture for the confirmed scale; native file handling is proposed, subject to technical review.
* **Desktop three-panel UI:** proposed replacement is linked overview, image editor, and global-tag views; no final UI has been approved.
* **Image BLOBs in the database versus private image files:** private files plus database records are proposed to separate large image storage from caption transactions; not yet selected through review.

## Key Decisions & Staging for Next Steps

The core product is a local Android caption editor with independent projects and exportable training subsets. Import, durable editing, manual organization, classification preview, and directory export need to work as one lifecycle. No implementation work should resume on the strength of this document alone.

Before detailed design, review unresolved items: minimum device/OS support; translation languages and offline provider; exact condition-builder semantics; conflict-resolution controls; save acknowledgement and undo depth; import/export recovery; filename collisions; missing and uncertain captions; project backup/deletion; and whether global tag statistics, autocomplete, and multi-image caption editing belong in the first release.

Next gate: the user confirms whether this anchored hypothesis is ready for fresh-context Goldfish reviews or needs further clarification. Review findings will be added only after actual reviewer completion.
