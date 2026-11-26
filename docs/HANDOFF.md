# Anima Standalone Trainer Maintainer Handoff

## Project and baseline

Anima Standalone Trainer is a Windows and Linux image-model training application. Its Web UI manages datasets, training jobs, sample generation, model exports, hardware monitoring, client delivery portals, and TensorBoard. Express owns the job lifecycle and launches the selected Python backend. Completed adapter runs save their final checkpoint with an epoch-qualified `-final` suffix so periodic checkpoint rotation does not delete the final model.

## Where to work

| Area | Entry points and responsibilities |
| --- | --- |
| Web application | `training-ui/server.js` serves the Vue application at `/ui/` (with `/` redirecting to `/ui/`). `training-ui/frontend/src/` contains Vue, Vue Router, TypeScript, and Pinia code; `training-ui/shared/` holds validation and matrix modules shared between Express and Vue. `training-ui/client-portal-server.js` and `training-ui/client-portal/` provide the standalone read-only Client Portal. |
| Job orchestration | `training-ui/server.js` handles job configuration, subprocesses, generation, and live updates. `training-ui/lib/` contains backend-specific launch and validation logic alongside environment, dataset, artifact, and TensorBoard services. |
| Native training | `anima_train_network.py`, `anima_train.py`, and `lumina_train_network.py` are useful starting points. Shared trainer logic lives in `train_network.py` and `library/`. Adapter implementations and conversions live in `networks/`. Anima also has dedicated TP/SP entry points. |
| Krea 2 | `training-ui/lib/krea2-backend.js` integrates `vendor/musubi-tuner`. The upstream revision and local changes are recorded in `vendor/MUSUBI_VERSION.json`. |
| MOSS-Image | `training-ui/lib/moss-backend.js` and `scripts/moss_runtime.py` integrate `vendor/sd-scripts`. Review `vendor/SD_SCRIPTS_VERSION.json` and `vendor/SD_SCRIPTS_SHA256.json` before updating the pinned source. |
| Environments | `scripts/environment_manager.py`, `training-ui/lib/environment-manager.js`, and `requirements/` cover installation, checks, and dependency locks. |

## Set up and run

Use Node 24 for the Web UI and Python 3.12 for managed environments. Install a compatible NVIDIA driver for the model environment you plan to use. From the repository root, run the appropriate pair of commands.

```powershell
.\setup_env.bat
.\training-ui\start_training_ui_anima.bat
```

```bash
bash setup_env.sh
bash training-ui/start_linux.sh
```

Open the address printed by the launcher. Port 3000 is the first choice, and the server selects another port when needed. Set the process password on first access. In **Global Settings → Environment Management**, install or check the backend you need, then configure its model and encoder paths. The UI can start with only the lightweight control environment. Model weights are configured separately.

The control environment contains uv. Anima and Lumina share one model environment. Krea 2 and MOSS each use their own dependency locks and Python environment. Managed installs live under `.runtime/environments/<backend>/<generation>`, and successful installs update the corresponding path in `training-ui/global_config.toml`. To roll back, stop active operations, restore the previous environment path from `.runtime/environment-state.json`, and run **Check**. Rebuild a Python environment if it needs to move to a new path. [Environment management](environment-management.md)

## Model workflows and constraints

| Backend | What a maintainer should verify |
| --- | --- |
| Anima | The native backend includes full fine-tuning (including optional single-GPU Muon + AdamW) and LoRA, LoHa, LoKr, DoRA, and DoKr adapters. Check the adapter and parallelism combination before launch. LoHa and LoKr lack TP/SP support, and `anima_gen.py` cannot generate from those checkpoints. DoRA and DoKr require one GPU and ordinary Linear layers. |
| Krea 2 | The pinned Musubi integration supports single-GPU DiT LoRA and LoKR. Launch checks the environment, prepares latent and text caches, then trains on RAW. Training previews use RAW, while independent generation can select RAW or Turbo. |
| MOSS-Image | The pinned sd-scripts integration supports Base/SFT with single-GPU BF16-capable NVIDIA hardware. It trains DiT LoRA, LoHa, and LoKr and exposes resume, training previews, and standalone generation. The text encoder is frozen. |

For Krea 2 and MOSS, use a caption file for every image. Both accept an empty caption file. Check the backend-specific guide before sharing a dataset configuration or checkpoint between jobs. Adapter initialization loads weights, while resuming from a `*-state` directory restores training state such as optimizer progress. [Krea 2 guide](KREA2.md) · [MOSS-Image guide](MOSS_IMAGE.md)

## State, access, and recovery

| Location | What to preserve or inspect |
| --- | --- |
| `training-ui/global_config.toml` | Host-specific settings and model/environment paths. Use `training-ui/global_config.template.toml` as the versioned reference. |
| `training-ui/jobs/<job>/` | Job inputs, generated backend launch snapshots, logs, caches, checkpoints, resume state, and sample images. Check the launch snapshots and logs when the UI settings and observed behavior differ. |
| `training-ui/datasets/` | Published uploads and archive imports. Removing a job or dataset subset leaves imported files in place, and multiple jobs can reference them. Server directories bound directly remain at their original paths. |
| `.runtime/` | Managed environment generations, uv cache, migration snapshots, and environment operation state. Preserve the working generation and settings until its replacement passes checks. |
| `training-ui/frontend/dist/` | Generated Vue bundle. `npm start` checks the frontend fingerprint and builds as needed. Running `node server.js` directly skips the prestart check for prebuilt deployments. |

Treat the Web UI password as shared operator access. The password and sessions are scoped to the Express process, including for localhost, so a restart requires password setup again. Logged-in remote users can manage environments and browse server directories readable by the service account. The README's reference to directory grants and the environment guide's remote-call restriction describe earlier behavior. For TLS deployments, follow the dataset guide's cookie and WebSocket settings and serve TensorBoard through the authenticated Web UI proxy. [Dataset and access guide](../training-ui/DATASETS.md)

Use **Training Outputs** to inspect or download checkpoints and samples. Wait for the trainer's save-complete log before downloading a checkpoint that is still being written. To preserve every epoch, review both the save interval and the retention settings. [Training Outputs guide](../training-ui/ARTIFACTS.md)

## Verify a change

From `training-ui/`, run the development checks below. For split frontend development, run `npm run dev` and `npm run dev:ui` in separate terminals. Set `TRAINER_BACKEND_URL` for the Vite proxy if Express uses a different address. [Frontend development guide](VUE_FRONTEND.md)

```sh
npm ci
npm ci --prefix frontend
npm test
npm run test:ui
npm run build
```

Use the matching model environment's Python for backend tests. For scheduler changes, run `python -m unittest discover -s tests -p test_lr_warmup.py` from the repository root. Epoch-based warmup resolves duration from the prepared dataloader's optimizer updates per epoch. Keep the existing step and ratio behavior for older configs, and check warmup after resume when changing that path.

Automated checks pass on Windows with Node 24: the Express suite reports 171 passed and one skipped (the skipped test needs the installed pinned MOSS backend to validate generated configuration against its real parser and dataset sanitizer), all 204 Vue tests across 32 files pass, and Vue type checking, Vite production build, and warmup scheduler tests pass.

A release check with real model weights should exercise dataset preparation, a short training run, checkpoint and state save, resume, training preview, and independent generation for the backend being changed. Record the model, adapter, GPU, precision, and peak VRAM with the result. This handoff run covered automated checks. Native Linux installation, real-weight GPU runs, and a second-device LAN/TLS check were outside its verification. The existing Krea 2 and MOSS records describe synthetic and integration coverage and identify the real-weight GPU checks still outstanding in those records. [Krea 2 validation](KREA2.md#验证范围) · [MOSS validation](MOSS_IMAGE_VALIDATION.md) · [Memory diagnostics](MEMORY_DIAGNOSTICS.md)
