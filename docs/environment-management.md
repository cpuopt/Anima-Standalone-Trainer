# Environment management (Windows / Linux)

## Layout and prerequisites

The UI runs on Node.js. The lightweight main Python environment contains uv
0.12.18, not torch. Anima/Lumina share one model environment; Krea 2 and MOSS each
have their own. All managed environments use Python 3.12.

Run `setup_env.bat` on Windows or `bash setup_env.sh` on Linux. The bootstrap
requires an existing Python 3.10–3.13 with working venv/pip and network access;
uv locates or downloads Python 3.12. Setup installs/builds the UI but never installs
model dependencies. Open the UI on **localhost**, then use Global Settings →
Environment Management. Remote and cross-origin environment-management calls are
intentionally rejected.

Model-only CLI compatibility entries remain `setup_anima_lumina`, `setup_krea2`,
and `setup_moss` (`.bat` / `.sh`). The entrypoints locate the configured main Python through the Node.js dispatcher,
so uv-managed Python does not need to be installed on PATH. They invoke the same installer as the UI. Krea retains its
`--cuda cu124|cu128|cu130|cu132` profiles. Other backends use cu128.

## Installation and diagnostics

Each operation owns a persisted task. Check the live read-only console, stop the
owned process tree, or download its full log. Refreshing/reconnecting reads the
same task using a byte cursor; installation does not depend on the page remaining
open. After a service restart, unfinished tasks are marked interrupted, not successful.

Only one environment operation runs at a time. Stop training, generation,
TensorBoard, and unload persistent models before installation. New training or
generation is blocked while the manager owns an operation. Main-environment
recovery, if its interpreter is missing, is performed through `setup_env`.

An environment is built directly at its final path:
`.runtime/environments/<main|anima-lumina|krea2|moss>/<generation>`.
The installer never renames a built venv, edits installed shared package files,
or installs into the active environment. It checks Python, locked dependencies,
backend imports, vendor identity, and CUDA. A valid environment without CUDA is
reported as **no-cuda**, not GPU-ready. Model weights are never downloaded by checks.

Model environment checks also report the optional Triton module's version,
`triton` / `triton-windows` distribution versions, and import failures. Missing or
broken Triton does not invalidate ordinary training with Torch Compile disabled.
An importable module is not proof that inductor can compile GPU kernels or that
an entire training run is compatible. Checks do not compile kernels or install Triton.

Successful installations update `main_venv_path`, `anima_lumina_venv_path`,
`krea2_venv_path`, or `moss_venv_path` in `training-ui/global_config.toml`.
An explicit legacy `venv_path` is a fallback for Anima/Lumina only. There is no
fallback to a different model's Python or system Python for training.

## Cache, migration and rollback

The shared cache is `.runtime/uv-cache`. uv installs with hardlinks where supported;
the cache and environment must be on the same filesystem/volume. Otherwise a
probe selects copying and logs a warning. Only identical builds share storage;
different torch versions and Windows/Linux wheels do not. Folder size totals can
double-count hardlinks and must not be advertised as physical savings.

To migrate all four environments, run Python 3.12 with:

```text
scripts/environment_manager.py migrate
```

This saves the original configuration and environment/version inventory under
`.runtime/migration-snapshots`, then builds and verifies main, Anima/Lumina,
Krea, and MOSS in order. Each successful environment is committed independently;
a later failure does not invalidate previously committed environments. Retry
individual backends from the UI, reusing the cache.

Previous environment paths and versions are retained in
`.runtime/environment-state.json`. For rollback, stop operations, set the relevant
Global Settings environment path back to the recorded old path, and run Check.
Legacy Python 3.13 environments can still be selected for rollback but will be
reported as nonconforming to the new Python 3.12 policy. Configuration snapshots
also allow restoring the original settings.

Old environments still occupy space until explicitly removed. Settings offers a
confirmed cleanup operation only for registered, inactive project-local venvs;
active paths, ancestors of active paths, external paths and symlinks are rejected.
No automatic cache pruning or old-environment deletion occurs during migration.

## Validation boundaries

Windows and Linux share installation, diagnostics, status, logs and cancellation
contracts. Windows uses hidden subprocesses/taskkill; Linux uses owned process
groups. Linux shell syntax and platform markers can be checked on Windows, but
native Linux installation and GPU training require a Linux runner and hardware.
Successful import/CUDA checks are not a substitute for training with real models
and datasets.
