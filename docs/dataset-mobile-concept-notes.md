# Mobile Dataset Caption Editor — Working Notes

* **Author:** cpuopt
* **Date:** 2026-11-11
* **Status:** Historical clarification notes with a current authority notice below. Seven-lens BRAINSTORM review completed on 2026-11-11. Not an approved implementation design. Implementation remains paused.

> **Current authority:** Android-only first release, independent copied project after successful recursive local-directory import, internal database edits, explicitly run combined-condition classification with manual conflict preview, and new-directory export are confirmed. Earlier passages below describing unconfirmed platforms, ongoing source-linked editing, undecided copy ownership, or archive-first input/output are superseded historical exploration. ZIP/captions-only output, undo, global/batch tools and backup formats remain proposals. Their appearance here is not approval. Read [the updated brief](../concepts_brief.md) and [completed review](reviews/dataset-mobile/goldfish_review_report.md) for current findings and unresolved decisions. The original notes are preserved in [the pre-review backup](reviews/dataset-mobile/dataset-mobile-concept-notes.before-review.md). Historical closing readiness/no-review instructions below have been fulfilled and are superseded by this notice.

## Problem and confirmed direction

The user wants to inspect image training datasets on a phone, edit each image's caption, inspect the dataset as a whole, and export image/TXT pairs. Captions may contain booru-style tags, natural-language descriptions, or both. The user accepted Nuxt inside a native WebView shell. Dataset files must be processed locally without uploading them.

Manual editing is a central workflow, rather than an optional feature added to a batch converter. The editor must display the image and its caption, expose individual tags, preview tag translations, and allow manual tag addition and removal. Formatting must support one combined line, separate tag/prose lines, and prose split into sentence lines. Translations are for viewing and must not enter the exported caption.

The user confirmed Android only for the first release. iOS is outside that release's scope. Capacitor is a proposed wrapper for the accepted Nuxt/WebView direction. An on-device translation provider has not been approved or tested. Existing starter code does not establish feature readiness or impose product limits.

### Confirmed dataset scale

The user expects 100–1,000 images, averaging about 5 MB each. Original image storage is therefore approximately 500 MB–5 GB in decimal units, before project data, thumbnails, or export copies. This describes an expected workload, not an agreed hard limit. Dimensions, formats, and unusually large individual files remain unknown.

The starter code's 128 MiB import limit cannot meet this workload. Do not carry that limit into the requirements or claim that moving whole-archive processing to a worker makes it suitable for this scale.

### File handling implications at this scale

Proposed architecture: keep the Nuxt interface and caption operations in the WebView, and delegate large file reads, thumbnail production where needed, and archive import/export to native operations. Retain native file references rather than copying image bytes or Base64 strings into JavaScript state. Select and verify native libraries after target platforms and import sources are known.

Build a persistent caption index with image identifiers, paths, parsed content, edits, and review state. Render a virtualized grid and use a bounded thumbnail cache. Load full-resolution images only for the active preview and release decoded image resources when leaving it. Compressed file size alone does not predict decoded image memory use; image dimensions must be included in later device tests.

For a ZIP source, inspect entries before extraction, detect unsafe paths and naming collisions, and check storage requirements. Extract incrementally to disk with progress and cancellation; clean up incomplete temporary files without losing a previously valid project. Do not extract the whole archive into WebView memory.

For full-dataset export, stream original image files and generated TXT files into an archive on disk. Avoid passing the archive through a Base64 bridge. Report progress, support cancellation, and publish the result only after successful completion. A 5 GB input means archive support must account for ZIP64 rather than assuming classic ZIP size limits. Validate archive compatibility with the target training workflow.

Disk space depends on the chosen import policy. Retaining an input ZIP, extracting a project copy, and creating a full export may require several copies of the image data. A source-directory workflow may avoid a copy but needs durable access permissions and a strategy for externally moved or removed files. Show a storage estimate before starting once the source and destination are known.

Captions-only export is useful when original images already exist elsewhere, but it does not replace the required full-dataset export. Browser-only support must be measured and scoped separately; it should not promise the same 5 GB capacity as native file handling.

## Reference: verified capabilities

Source: [BooruDatasetTagManager English README](https://github.com/starik222/BooruDatasetTagManager/blob/master/README.md), read on 2026-11-11. These are documented capabilities, not findings from running its application or auditing its source.

The reference provides an image list, a tag editor for selected images, and a panel showing all or common tags. It supports editing several images together and saving changes, including creating captions for images without TXT files. Tag translations can be cached and manually overridden. Autocomplete can use imported CSV or line-based TXT vocabularies. It also documents weighted tags, an external Python tagging service, video tagging, and replaceable panel visibility.

Its primary focus is booru tags. Mixed tags and prose need their own design in this app. The desktop panel arrangement and external Python service are not assumed to fit a local phone app.

## Proposed product structure

### Confirmed subset organization and rule-based moves

The user explained that folders represent training subsets. For example, an initially flat artist dataset may be divided into periods with different styles. The trainer can assign a different repeat value to each subset. The app must allow users to create subdirectories, move images into and out of them manually, and move images automatically based on combined conditions such as tag membership.

The app organizes data for the trainer; editing repeat values or generating trainer configuration has not been requested. Folder names must not automatically encode repeat counts without a separate decision. An image and its caption move together in the logical tree and export together to the corresponding directory.

Proposed interaction: create a target folder, select images manually or construct a filter, preview the matched images and count, then apply a move with undo. Existing source content can be flat or nested. Support moving back to a parent/root folder as well as moving between subsets. Exact behavior for folder renaming, deletion, and nesting depth is still open.

Candidate rule semantics, not yet approved:

* Exact tag membership should be the default rather than substring matching; `cat` should not implicitly match `cat ears`. Define casing, underscores, weighted-tag syntax, and aliases before implementing matching.
* A condition builder may need AND, OR, and NOT groups. Start with concrete user rules rather than assuming a complete query language is needed. Natural-language search, filename conditions, folder conditions, and image dimensions remain proposals.
* Distinguish a saved search from a move operation. A search changes the visible image set; a move changes the stored subset assignment.
* Confirmed: automatic classification is a separate feature and runs only when the user explicitly starts it. Tag edits do not trigger moves. Every run evaluates the then-current dataset; continuous rule enforcement is outside the confirmed scope.
* Confirmed: show rule conflicts in the pre-execution preview and let the user resolve them manually there. Do not silently select a destination by priority or last-match order. The exact resolution controls remain a design detail.
* Define the evaluation set and time. A batch should preferably evaluate a stable project version and produce a move plan before writing, rather than allowing earlier moves to change later rule matches unexpectedly.
* Detect same-name collisions in the destination before moving. Do not silently overwrite an existing image or TXT file. Preserve a recoverable record of original and new logical paths.
* Subset counts and global tag statistics should update after a committed move. Manual review status and tag content should not change solely because an image moved.

Folder trees are confirmed as the export structure. A separate virtual membership model that allows multiple subsets per image is not confirmed. Rule previews, undo, conflict resolution, and persistence behavior must be made concrete during design.

### Concrete classification rules supplied by the user

1. If the tags contain `newest`, move the image/TXT pair to the `newest` subdirectory.
2. If the TXT contains no natural-language description, move the pair to the `no-vlm` subdirectory.

These examples establish both tag-based and caption-structure-based conditions. The candidate interpretation of rule 1 is exact membership of the tag `newest`, not an arbitrary raw-text substring; confirm normalization behavior during detailed design. Rule 2 should use the parsed prose field rather than a newline count. A tags-only caption can have several lines, and a one-line caption can contain prose. Whitespace-only prose counts as empty. Missing TXT, fully empty TXT, and an uncertain parse need separate visible states rather than silently being treated as proven tags-only captions; their classification policy is still open.

An image with the `newest` tag and no prose matches both examples. The user confirmed that the preview step must expose such rule conflicts and allow manual resolution before execution. Also confirm whether rules run together as one plan or are applied separately to a chosen scope.

### Confirmed conflict checkpoint and proposed preview behavior

Conflict handling belongs in the automatic organization preview, before any folder moves are committed. The system must show conflicts and support manual handling on that page.

Proposed details for review:

* Show planned moves separately from conflicts and unchanged items. For a conflicting image, display its thumbnail, current relative path, matched rules, and candidate destinations.
* Provide an explicit destination selection or a skip action. Manual destination selection overrides the candidate moves for this run, not the saved rule definition. Creating nested folders or duplicating images is not implied by conflict resolution.
* Allow users to resolve images individually and, if needed, apply one resolution to a selected conflict group. Whether batch resolution is required remains open.
* Block execution of unresolved conflicting moves. Offer a clear way to skip them rather than silently excluding them. Resolve destination filename collisions as well as rule-target conflicts before writing.
* Tie each preview plan to the project version it evaluated. If tags, rules, or logical paths change before execution, refresh the plan and preserve manual resolutions only where they are still valid.
* Commit resolved logical moves transactionally where practical and keep one undoable operation record. The preview and actual execution should report the same affected image set.

### Confirmed project ownership and save model

The user clarified that after import the dataset must no longer depend on its original files. Every edit is saved to an app-internal database. The app allows changes to the dataset's directory structure, and export writes a new directory using the configured structure.

This supersedes the earlier proposal to retain source image references for ongoing editing. The directory grant is used to discover and copy input files. A completed project must remain usable after the input directory is moved, deleted, or its permission is revoked.

Proposed storage responsibilities:

* Copy each imported image into app-private file storage, preserving original bytes. Store captions, logical folders, asset references, edit state, and recovery metadata in an internal database. Keeping image bytes in files rather than database BLOBs is an implementation proposal, not a user-imposed constraint.
* Treat import as a recoverable job. Copy incrementally, record completed items, and verify that a private copy is readable before marking that item imported. Never present a partially copied dataset as a completed independent import. On source access loss, keep completed progress and report the unresolved files.
* Maintain a logical output path independently of the physical image storage path. Moving a dataset folder should not require copying gigabytes of image bytes within app storage. An image and its caption share a logical stem and move together.
* Preserve the imported folder tree as the initial logical structure. Directory editing requirements beyond this are still open. Validate collisions, invalid names, parent/child relationships, and output portability before committing moves or renames.
* Save caption changes and logical structure edits to the database. Show pending, saved, and failed states. A database error must not be presented as a completed save, and navigating to another image must not discard an unsaved edit.
* “Real-time save” requires a defined durability point. Debouncing text input is a possible optimization, but a debounce timer alone is insufficient when the app is suspended or killed. Determine save acknowledgement and recovery behavior before implementation.
* Use database transactions for related changes and batch-edit recovery. Autosave and undo are separate requirements: persistent autosave must not eliminate the ability to undo an accidental edit.
* Export to a separately selected destination using a consistent version of the logical tree and caption data. Handle destination collisions explicitly and keep incomplete output identifiable after cancellation or failure. Avoid silently mixing caption versions if editing continues during export.
* The primary requested export is a directory tree, not a ZIP. ZIP and captions-only export are optional proposals pending scope decisions. Export should not require a temporary whole-dataset ZIP just to write a directory.

Storage consequence: for a 5 GB dataset, a 5 GB source, a 5 GB private image copy, and a 5 GB full export can occupy approximately 15 GB on the same device, before thumbnails, database/history, and overhead. This is an example, not a guaranteed capacity requirement. The source may be removed after a verified import. Estimate additional required space before import and export and report insufficient space without losing a valid existing project.

An app-private project may be lost when the app is uninstalled or its data is cleared. Export/backup and project lifecycle need an explicit product policy. Do not describe app-private storage as permanent backup.

### Confirmed entry workflow: an existing local directory tree

The user will place the dataset in local phone storage beforehand. The app asks the user to grant access to a directory and recursively enumerates its nested folders. It then copies the dataset into an independent project as specified above. Source TXT files are not overwritten; final output is written to a new destination.

Proposed behavior:

* Use a native system directory picker and preserve the granted directory reference where supported. Restore access when possible; ask for reauthorization when access expires or the source moves.
* Enumerate the authorized subtree incrementally. Keep relative paths, native document identifiers, sizes, and modification metadata. Do not read every file's bytes just because all entries are enumerated.
* Pair image and TXT files by parent directory and filename stem. Two folders may each contain `001.jpg` and `001.txt` without collision. Flag ambiguous pairing within a folder rather than guessing.
* Index supported images and captions. Report other files and unreadable folders; do not interpret unrelated files as captions. Preserve original source files unless an explicit editing/save policy permits writes.
* Let the overview switch between the whole tree and a folder view, keeping folder context visible during per-image editing. These navigation details are proposals, not yet confirmed interactions.
* Cache thumbnails locally and retain database-backed edits. Copy image data into private storage. Detect source changes while importing; after a completed import, do not rescan the source as the authority for project contents.
* Test both read and write capabilities separately. Directory read access does not establish a safe or supported write-back workflow.

Platform evidence: Android documents directory-tree selection through `ACTION_OPEN_DOCUMENT_TREE` and persisted URI access, with some directory restrictions on Android 11 and later ([Android documentation](https://developer.android.com/training/data-storage/shared/documents-files)). Apple documents directory access through a document picker returning a security-scoped URL ([Apple documentation](https://developer.apple.com/documentation/uikit/providing-access-to-directories)). These APIs require native integration; they are not proof that a plain WebView filesystem API can access the same tree. Target operating systems remain unconfirmed.

### 1. Dataset overview

Display a thumbnail grid with filenames and caption states. Distinguish missing caption, empty caption, uncertain parsing, edited, and manually reviewed. Edited and reviewed are separate states: a user can check a caption without changing it, and a batch edit does not mean a human reviewed its result.

Offer filename search and tag filtering. Preserve grid position, filters, and current image when opening and closing the editor. Show progress within the filtered set as well as the entire dataset. Multi-selection enters an explicit batch mode; actions must name their scope and affected image count.

### 2. Per-image editor

Use a large image preview with a zoom action, followed by individual tag chips and a separate prose editor. Keep previous/next navigation reachable without returning to the overview. Avoid swipe navigation while selecting text, dragging tags, or zooming an image.

Selecting a tag opens its complete source text, translation, and editing actions. Multiword phrases such as `looking at viewer` stay together. Translation visibility should not require a long press. Offer an optional bilingual display, while retaining the source tag as the editable and exportable value.

Support add, delete, rename, reorder, and undo. Tag reordering and trigger-word pinning are candidate additions, not yet confirmed requirements. Search suggestions should not insert text until the user selects a suggestion. Imported spelling should be preserved until a user deliberately applies normalization.

Show prose separately with source and translation views. Users must be able to correct the tag/prose boundary or explicitly mark a caption as tags-only or prose-only. The original raw caption remains available for comparison.

### 3. Global tag browser

Show tags with the number of images containing each tag. Count each image once even if a caption contains a duplicate tag. Selecting a tag filters the thumbnail grid. Within a selected group, distinguish tags present in every selected image from tags present in only some images.

Adding a tag to a group should add it only where absent. Removing a tag should remove only that tag. Renaming should explain how existing target tags will be handled. Never replace each image's complete tag list with the group's common tags.

Autocomplete vocabularies and editable translation dictionaries are promising follow-ups. They need separate decisions about file format, size, updates, and search speed.

### 4. Batch cleanup and formatting

Candidate rules include duplicate removal, whitespace cleanup, literal tag replacement, and optional underscore conversion. Every operation has a visible scope: current image, selected images, current filter, or entire dataset. Preview affected examples and counts before committing. Record enough information to undo the operation.

Keep content editing separate from serialization. Changing export layout should not repeatedly parse and rewrite the working caption. Natural-language commas must not create tags, and sentence splitting must account for abbreviations, decimals, quotes, and Chinese punctuation.

### 5. Export check

Export original image bytes and same-stem UTF-8 TXT files, preserving directories by default. Offer a captions-only archive. Check path collisions, several images sharing one caption stem, missing/empty captions, and unsupported images. An empty caption may be intentional, so whether it blocks export is still open.

Do not silently drop unmatched files or unresolved images. Report the issue and make the chosen export policy visible. Translation caches, review flags, and edit history belong in app project data, not training TXT files. File naming and directory layout must eventually be checked against the intended training software.

## Main objections and design risks

* **Phone memory:** A WebView can fail if it holds originals, decoded images, ZIP contents, and export buffers together. A worker keeps compression off the UI thread but does not itself solve memory pressure. Expected dataset size must guide whether archives use native streaming and files stay on disk.
* **Interrupted work:** Phones suspend or kill apps. Session-only state is insufficient for a long editing task. Decide how projects, drafts, review progress, and undo history survive process death, and what storage removal does to them.
* **Parsing uncertainty:** Rules cannot reliably infer every tag/prose boundary. Preserve source text and provide a usable correction path. A confident-looking wrong split is more harmful than a visible review request.
* **Translation quality:** General translation can misread booru terms, names, and abbreviations. A local curated dictionary with user overrides may work better for tags; prose needs a different translation path. Downloading a model requires connectivity even if inference is local. Neither is a verified implementation yet.
* **Destructive scope:** A batch action run on the entire dataset instead of a filtered group can undo hours of work. Scope, preview, and recoverability are product requirements.
* **Reference scope:** Reproducing every desktop feature would add video handling, external model services, and image transformation to a caption editor. These need separate justification and must not silently enter the first version.

## Alternatives under consideration

* A desktop-like three-panel layout exposes everything at once but leaves too little editing space on a phone. Proposed alternative: linked overview, editor, and tag-browser views.
* A pure WebView file pipeline is easier to reuse on the web but may be unsuitable for large archives. Proposed alternative: web UI with native file and archive operations where measured limits require them.
* General on-device translation covers prose, but a tag dictionary may give better terminology and faster previews. A combined approach remains a hypothesis.
* Directly editing the source folder avoids duplicate image storage but complicates file permissions and rollback. Importing a private project copy simplifies recovery but consumes storage. Neither policy has been selected.

No alternative in this section has been rejected by the user.

## Candidate staging, not an approved backlog

First establish reliable import, persistent project state, overview navigation, manual tag/prose editing, translation preview, undo, and valid export. Add global tag statistics, filtering, and scoped batch operations as part of the main workflow if required. Consider vocabulary import, tag weights, and trigger-word management after their exact behavior is established. Treat video, automatic image tagging, cloud sync, and image rewriting as separate scope questions.

## Open questions and next step

1. Image dimensions, unusually large files, and the intended hard workload limit. Expected scale is confirmed as 100–1,000 images averaging 5 MB (approximately 500 MB–5 GB).
2. Android is confirmed as the only first-release platform. Minimum Android version and device capabilities remain to be designed and tested.
3. Private project copy is confirmed. Determine import recovery, verification, and project deletion/backup behavior.
4. Real-time database save is confirmed. Define durability acknowledgement, save failure recovery, and expected undo depth.
5. Translation languages, whether a one-time model download is acceptable, and dictionary needs.
6. Whether multi-image edits and global tag filtering belong in the initial release.
7. Caption dialects, weighted-tag syntax, desired export layout, and target trainers.
8. Input is an existing local directory accessed recursively after authorization; export is a new directory based on the editable project tree. Define exact folder-editing operations and destination collision/partial-export handling.
9. Manual folder creation and image moves are confirmed. Combined-condition automatic moves run only on explicit user request. Tag membership and absent prose are concrete examples. Rule conflicts are shown and manually handled in the preview. Still define execution scope and exact resolution controls.

Continue open-ended clarification one question at a time. After the working hypothesis and boundaries are sufficiently clear, ask for explicit readiness to start fresh-context Goldfish reviews. No reviewers have been launched and no review findings are claimed here.
