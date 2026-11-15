# Android Dataset Caption Editor

* **Author:** cpuopt
* **Status:** Draft — Overview and Goals awaiting author review
* **Date:** 2026-11-11
* **Predecessor:** [Reviewed concepts brief](concepts_brief.md)
* **Supporting review:** [Seven-lens findings](docs/reviews/dataset-mobile/goldfish_review_report.md)

## Overview

Build an Android app for preparing image training datasets on a phone. Users import an existing local folder, inspect images and captions, correct tags and natural-language descriptions, organize training subsets, and export the resulting dataset into a new directory.

The working dataset is independent of its source after successful import. Edits are saved inside the app, so ordinary editing does not require continued access to the source folder. The initial release targets datasets of 100–1,000 images averaging about 5 MB per image, approximately 0.5–5 GB of image data. These figures describe the intended workload; they do not establish tested capacity or an agreed rejection limit.

The author requested refinement of the proposed Nuxt + Capacitor + Kotlin + Room/SQLite stack. This establishes the drafting direction: a WebView interface with Android-native file and persistence operations. Exact component responsibilities, database schema, library versions, device requirements and recovery mechanisms belong to the Technical Plan and are not settled by this section.

## The Problem

An automatically captioned training dataset still needs human inspection. Users must see each image while correcting its tags and prose. Editing raw TXT files alone makes it difficult to check the image, understand unfamiliar tags, preserve the tag/prose boundary, and track progress across hundreds of images.

Dataset organization is also part of training preparation. Images from different periods of an artist's work may need separate training subsets, to which the trainer can assign different repeat values. Users need to build folders manually and move matching image/caption pairs through rules without losing their individual edits.

A phone adds constraints: limited working memory, a small screen and keyboard, directory access granted through Android, and operations that can be interrupted. A dataset can be several gigabytes even though its caption text is small. The app must not equate a selected folder with a verified independent import, or a changed text field with a successfully saved edit.

The design must address two implementation-readiness blockers identified during concept review: a verifiable import-completion promise and an honest saved-state acknowledgement. It must also keep uncertain parsing from causing incorrect no-prose classification and keep partial exports from appearing complete.

## Goals

1. **Import nested local datasets into independent projects.** Use a user-authorized local directory as input and preserve the initial folder hierarchy. A successfully imported project remains usable after the source directory is removed or its access grant revoked. Define verification and treatment of failed or excluded files in the Technical Plan before claiming completion.

2. **Support overview navigation and per-image editing.** Show images with their corresponding captions. Expose individual tags for manual viewing, addition, removal and correction, with natural language edited separately. Retain image context and understandable navigation while the phone keyboard is open. Exact layout and progress-state controls remain design choices.

3. **Provide preview-only translation.** Let users inspect tag and prose translations while keeping source caption text authoritative. Translation failure must not alter source text, classification results or exported TXT. Provider, languages and model download requirements remain unresolved.

4. **Format captions without silently changing their meaning.** Support one combined line, separate tag/prose lines, and natural language with one sentence per line. Preserve user corrections to the tag/prose boundary. Do not infer that a caption lacks prose merely because parsing is uncertain.

5. **Persist edits within the app.** Save caption and logical-folder changes in the internal project database. Distinguish unsaved work, acknowledged saves and failures. Define acknowledgement, interruption recovery and navigation behavior in the Technical Plan; the design must not promise that every keystroke survives sudden power loss without a defined commit point.

6. **Organize training subsets manually.** Allow creation of subdirectories and movement of images into and out of them. A corresponding image and TXT move as one logical item. Export uses the edited hierarchy; repeat values remain the trainer's responsibility.

7. **Run combined-condition classification only on explicit request.** Support tag-based and caption-content conditions. Required examples are `newest` tag membership leading to `newest/`, and confirmed absent natural-language description leading to `no-vlm/`. Editing tags must not start classification automatically.

8. **Preview and manually resolve classification conflicts.** Before a run commits moves, expose conflicting rule destinations and allow the user to handle them on the preview page. No implicit rule priority or last-match destination is permitted. Group resolution, skip behavior and unresolved-item policy require a later decision.

9. **Export a new dataset directory.** Write image/TXT pairs using the project's current logical folder structure. Exported captions use the selected format and contain no preview translations. The design must define collisions, consistent export content and failure/cancellation outcomes before treating an export as complete.

10. **Keep dataset processing local at the intended scale.** The design must account for native file access, private storage, decoded-image memory and destination space. Later validation must exercise representative datasets up to the expected 1,000-image/5-GB workload on explicitly chosen Android devices. No performance, format or device guarantees are implied before those tests.

## Non-Goals

* Supporting iOS in the first release.
* Requiring source access for ordinary editing after verified import.
* Updating the original source directory as the save mechanism.
* Uploading dataset content for processing, or silently falling back to an online service.
* Exporting translation previews as training-caption content.
* Continuously enforcing classification rules while captions are edited.
* Resolving conflicting rule destinations silently through priority or execution order.
* Configuring training repeat values or executing model training inside the app.

Video editing, automatic image tagging/caption generation, image retouching, cloud synchronization, ZIP output, restorable project backups, vocabulary imports, broad batch caption tools and global tag analytics are not included in this draft's baseline. They are deferred scope questions rather than permanently rejected features. Undo and conflict-group actions also require explicit scope decisions.

## Open Questions

These questions are retained for the relevant drafting stages; they are not a request for the author to answer all of them at once.

* What constitutes verified complete import, and what happens to unreadable files, changed inputs and interrupted copies?
* Which edit revision may display saved, and what are the interruption, retry and undo guarantees?
* How should unknown or manually corrected tag/prose boundaries participate in rule evaluation and export?
* What are the condition-builder semantics, manual conflict controls and preview invalidation behavior?
* Which translation languages, model/provider and download policy meet the local-processing requirement?
* What file formats, pairing rules, case comparisons and destination collision policies are supported?
* How are cancelled/failed exports identified and retried without mixing project revisions?
* What minimum Android/device envelope, project lifecycle and schema-upgrade policies will be supported?

## Drafting Progress

Overview, Problem, Goals and Non-Goals are written for section review. Critical User Journeys, Technical Plan, Alternatives Considered, non-functional requirements and the per-file implementation/verification plan have not yet been drafted or approved. Production implementation remains paused.

*Drafted with EGM*
