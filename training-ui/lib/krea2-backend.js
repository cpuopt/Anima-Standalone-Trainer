const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const TOML = require('@iarna/toml');
const K = require('../public/js/krea2');

const REVISION = 'f8a1b03794a49239a3539015075f5123d6c07d66';
const ROOT = path.resolve(__dirname, '../..');
const VENDOR = path.join(ROOT, 'vendor/musubi-tuner');
const MODEL_PATHS = { dit: 'krea2_raw_path', turbo: 'krea2_turbo_path', text_encoder: 'krea2_text_encoder_path', vae: 'krea2_vae_path' };
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp']);

function runtime(global, nativePath = x => x) {
  const envPath = nativePath(global.krea2_venv_path || path.join(ROOT, 'venv-krea2'));
  return { python: path.join(envPath, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'),
    cwd: VENDOR, models: Object.fromEntries(Object.entries(MODEL_PATHS).map(([k, v]) => [k, nativePath(global.model_paths?.[v] || '')])) };
}
function fileIdentity(file) {
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) throw Error(`File not found: ${file || '(empty path)'}`);
  const stat = fs.statSync(file);
  return { path: path.resolve(file), size: stat.size, modified: stat.mtimeMs };
}
function checkModels(rt, generation = false, base = 'turbo') {
  fileIdentity(rt.python);
  for (const key of ['vae', 'text_encoder', generation ? base === 'turbo' ? 'turbo' : 'dit' : 'dit']) {
    fileIdentity(rt.models[key]);
    if (!rt.models[key].toLowerCase().endsWith('.safetensors')) throw Error(`${key}: expected a single .safetensors file`);
    // ComfyUI pre-quantized FP8 files cannot be loaded as the original base checkpoint.
    if ((key === 'dit' || key === 'turbo') && /fp8|int8/i.test(path.basename(rt.models[key]))) {
      throw Error('Use original RAW/Turbo weights; choose dynamic scaled FP8 in the UI instead of a pre-quantized file');
    }
  }
}
function preflight(rt, config) {
  const attention = config.training_arguments.flash_attn ? 'import flash_attn' : config.training_arguments.xformers ? 'import xformers' : '';
  const compiler = config.training_arguments.compile ? 'import triton' : '';
  const script = `import torch, accelerate, diffusers, safetensors, tensorboard\nfrom pathlib import Path\nfrom transformers import Qwen3VLModel\nimport musubi_tuner.krea2_train_network as trainer\nassert Path(trainer.__file__).resolve().is_relative_to(Path(${JSON.stringify(VENDOR)}).resolve()), 'Reinstall the pinned local Musubi backend'\n${attention}\n${compiler}\nassert torch.cuda.is_available(), 'CUDA is unavailable'\nassert torch.cuda.is_bf16_supported(), 'GPU does not support bf16'\nprint('Krea 2 environment ready')`;
  const probe = spawnSync(rt.python, ['-c', script], { cwd: rt.cwd, env: processEnv(config.gpu_ids), windowsHide: true, encoding: 'utf8', timeout: 60000, maxBuffer: 2 * 1024 * 1024 });
  if (probe.error || probe.status !== 0) throw Error(`Krea 2 environment check failed. Run setup_krea2 first.\n${probe.error?.message || probe.stderr || probe.stdout}`);
}
function processEnv(gpuIds) {
  const env = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1', TOKENIZERS_PARALLELISM: 'false' };
  // The module must be installed in the isolated environment, not imported via project PYTHONPATH.
  delete env.PYTHONPATH;
  env.CUDA_VISIBLE_DEVICES = String(gpuIds || '0');
  return env;
}
function status(global, nativePath) {
  const rt = runtime(global, nativePath);
  return { revision: REVISION, python: rt.python, installed: fs.existsSync(rt.python),
    models: Object.fromEntries(Object.entries(rt.models).map(([k, p]) => [k, !!p && fs.existsSync(p)])) };
}
function prepareDataset(dataset, jobPath, rt, nativePath = x => x) {
  K.validateDataset(dataset, true);
  const models = ['vae', 'text_encoder'].map(k => fileIdentity(rt.models[k]));
  const result = { general: dataset.general || {}, datasets: [] };
  dataset.datasets.forEach((d, di) => d.subsets.forEach((s, si) => {
    const directory = nativePath(s.image_dir);
    if (!fs.statSync(directory).isDirectory()) throw Error(`Not an image directory: ${directory}`);
    const files = fs.readdirSync(directory, { withFileTypes: true }).filter(e => e.isFile() && IMAGE_EXTENSIONS.has(path.extname(e.name).toLowerCase())).map(e => {
      const image = path.join(directory, e.name), caption = path.join(directory, path.parse(e.name).name + d.caption_extension);
      return { image: fileIdentity(image), caption: fs.existsSync(caption) ? fs.readFileSync(caption, 'utf8') : '' };
    }).sort((a, b) => a.image.path.localeCompare(b.image.path));
    if (!files.length) throw Error(`No supported images in ${directory} (PNG, JPG, WEBP, BMP)`);
    const stems = files.map(f => path.parse(f.image.path).name.toLowerCase());
    if (new Set(stems).size !== stems.length) throw Error(`Duplicate image stems in ${directory}. Musubi caches use the filename without extension; rename the duplicates.`);
    const digest = crypto.createHash('sha256').update(JSON.stringify({ revision: REVISION, models, files,
      resolution: d.resolution, extension: d.caption_extension, bucket: dataset.general })).digest('hex').slice(0, 24);
    const cache = path.join(jobPath, 'cache', 'krea2', `${di}-${si}`, digest);
    fs.mkdirSync(cache, { recursive: true });
    result.datasets.push({ resolution: d.resolution, batch_size: d.batch_size, caption_extension: d.caption_extension,
      image_directory: path.resolve(directory), num_repeats: s.num_repeats, cache_directory: cache });
  }));
  const output = path.join(jobPath, '_krea2_dataset.toml');
  fs.writeFileSync(output, TOML.stringify(result), 'utf8');
  return output;
}
function lastState(jobPath) {
  const output = path.join(jobPath, 'output');
  if (!fs.existsSync(output)) return null;
  return fs.readdirSync(output).filter(n => n.endsWith('-state') && fs.statSync(path.join(output, n)).isDirectory())
    .map(n => ({ file: path.join(output, n), time: fs.statSync(path.join(output, n)).mtimeMs }))
    .sort((a, b) => b.time - a.time)[0]?.file;
}
function prepareTraining(config, dataset, jobPath, global, nativePath = x => x, options = {}) {
  K.validate(config); K.validateDataset(dataset, true);
  const rt = runtime(global, nativePath);
  checkModels(rt);
  if (!options.skipPreflight) preflight(rt, config);
  const datasetPath = prepareDataset(dataset, jobPath, rt, nativePath);
  const t = config.training_arguments, n = config.network_arguments, k = config.krea2_arguments;
  const merged = { ...K.pick(t, K.TRAIN_KEYS), ...K.pick(n, K.NETWORK_KEYS),
    timestep_sampling: k.timestep_sampling, weighting_scheme: k.weighting_scheme,
    discrete_flow_shift: k.discrete_flow_shift ?? 2.5,
    dit: rt.models.dit, vae: rt.models.vae, dataset_config: datasetPath,
    output_dir: path.join(jobPath, 'output'), logging_dir: path.join(jobPath, 'logs'),
    save_state: true, save_state_on_train_end: true, save_last_n_epochs_state: 1, save_last_n_steps_state: 1 };
  delete merged.auto_resume_last_state;
  if (n.network_weights) merged.network_weights = nativePath(n.network_weights);
  if (n.resume) merged.resume = nativePath(n.resume);
  else if (n.auto_resume_last_state) merged.resume = lastState(jobPath);
  if (!merged.resume) delete merged.resume;
  if (merged.resume && !fs.existsSync(merged.resume)) throw Error(`Resume state not found: ${merged.resume}`);
  if (merged.network_weights) fileIdentity(merged.network_weights);
  const promptFile = path.join(jobPath, 'sample_prompts.txt');
  if (t.sample_every_n_epochs || t.sample_every_n_steps) {
    if (!fs.existsSync(promptFile) || !fs.readFileSync(promptFile, 'utf8').trim()) throw Error('Training sampling requires prompts');
    validatePrompts(fs.readFileSync(promptFile, 'utf8'));
    const snapshot = path.join(jobPath, '_krea2_sample_prompts.txt');
    fs.copyFileSync(promptFile, snapshot);
    merged.sample_prompts = snapshot; merged.text_encoder = rt.models.text_encoder;
  }
  const configFile = path.join(jobPath, '_krea2_config.toml');
  fs.writeFileSync(configFile, TOML.stringify(merged), 'utf8');
  const stages = [
    { phase: 'cache_latents', args: ['-m', 'musubi_tuner.krea2_cache_latents', '--dataset_config', datasetPath,
      '--vae', rt.models.vae, '--batch_size', String(k.vae_batch_size || 1), '--num_workers', String(t.max_data_loader_n_workers || 0), '--skip_existing'] },
    { phase: 'cache_text', args: ['-m', 'musubi_tuner.krea2_cache_text_encoder_outputs', '--dataset_config', datasetPath,
      '--text_encoder', rt.models.text_encoder, '--batch_size', String(k.text_encoder_batch_size || 1), '--num_workers', String(t.max_data_loader_n_workers || 0), '--skip_existing'] },
    { phase: 'training', args: ['-m', 'accelerate.commands.launch', '--num_processes', '1', '--num_machines', '1',
      '--mixed_precision', 'bf16', '--num_cpu_threads_per_process', '1', '--module', 'musubi_tuner.krea2_train_network', '--config_file', configFile] },
  ];
  fs.writeFileSync(path.join(jobPath, '_krea2_launch.json'), JSON.stringify({ revision: REVISION, python: rt.python,
    cwd: rt.cwd, gpu_ids: config.gpu_ids || '0', stages }, null, 2));
  return { rt, stages, gpuIds: config.gpu_ids };
}
function validatePrompts(text) {
  const options = new Set(['w', 'h', 's', 'l', 'd', 'n']);
  const lines = text.split(/\r?\n/).filter(l => l.trim() && !l.trimStart().startsWith('#'));
  if (!lines.length) throw Error('At least one prompt is required');
  for (const line of lines) {
    for (const arg of line.split(' --').slice(1)) {
      const match = arg.match(/^(\w+)\s+([\s\S]+)$/);
      if (!match || !options.has(match[1])) throw Error(`Unsupported Krea 2 prompt option: --${arg}`);
      const [key, value] = match.slice(1), v = Number(value);
      if (key !== 'n' && !Number.isFinite(v)) throw Error(`Invalid prompt value: --${arg}`);
      if (['w','h'].includes(key) && (!Number.isInteger(v) || v < 256 || v % 16)) throw Error('Prompt resolution must be >=256 and a multiple of 16');
      if (key === 's' && (!Number.isInteger(v) || v < 1 || v > 1000)) throw Error('Prompt steps must be in 1..1000');
      if (key === 'd' && (!Number.isInteger(v) || v < 0)) throw Error('Prompt seed must be a nonnegative integer');
      if (key === 'l' && v <= 1) throw Error('RAW training previews require CFG > 1');
    }
  }
  return lines;
}
function prepareGeneration(config, jobPath, global, request, nativePath = x => x, options = {}) {
  K.validate(config);
  const rt = runtime(global, nativePath), base = request.krea2_base || 'turbo';
  if (!['raw', 'turbo'].includes(base)) throw Error('Generation base must be raw or turbo');
  checkModels(rt, true, base);
  const ids = String(request.gen_gpu_ids || config.gpu_ids || '0');
  if (!/^\d+$/.test(ids)) throw Error('Krea 2 generation supports one GPU');
  if (!options.skipPreflight) preflight(rt, { ...config, gpu_ids: ids });
  const prompts = validatePrompts(fs.readFileSync(path.join(jobPath, 'sample_prompts.txt'), 'utf8'));
  const stages = prompts.map((line, index) => {
    const parts = line.split(' --'), prompt = parts.shift(), values = {};
    for (const p of parts) { const match = p.match(/^(\w+)\s+([\s\S]*)$/); if (match) values[match[1]] = match[2]; }
    const args = ['-m', 'musubi_tuner.krea2_generate_image', prompt, '--dit', base === 'turbo' ? rt.models.turbo : rt.models.dit,
      '--vae', rt.models.vae, '--text_encoder', rt.models.text_encoder, '--text_encoder_cpu',
      '--width', values.w || '1024', '--height', values.h || '1024', '--seed', values.d || '0',
      '--steps', String(request.krea2_steps ?? (base === 'turbo' ? 8 : 52)),
      '--guidance_scale', String(request.krea2_cfg ?? (base === 'turbo' ? 1 : 3.5)),
      '--save_path', path.join(jobPath, 'samples'), '--attn_mode', config.training_arguments.flash_attn ? 'flash' :
        config.training_arguments.xformers ? 'xformers' : 'torch', '--blocks_to_swap', String(config.training_arguments.blocks_to_swap || 0)];
    if (values.n) args.push('--negative_prompt', values.n);
    if (base === 'turbo') args.push('--mu', '1.15');
    if (config.training_arguments.fp8_scaled) args.push('--fp8_scaled');
    if (config.training_arguments.split_attn) args.push('--split_attn');
    if (request.network_weights) {
      const file = nativePath(request.network_weights); fileIdentity(file);
      const multiplier = request.network_mul ?? 1;
      if (typeof multiplier !== 'number' || !Number.isFinite(multiplier)) throw Error('Invalid LoRA strength');
      args.push('--lora_weight', file, '--lora_multiplier', String(multiplier));
    }
    return { phase: `generating_${index + 1}`, args };
  });
  const steps = request.krea2_steps ?? (base === 'turbo' ? 8 : 52), cfg = request.krea2_cfg ?? (base === 'turbo' ? 1 : 3.5);
  if (!Number.isInteger(steps) || steps < 1 || steps > 1000 || !Number.isFinite(cfg) || cfg < 1) throw Error('Invalid generation steps/CFG');
  return { rt, stages, gpuIds: ids };
}

// A single owner spans all stages, including the gaps between child processes.
function pipeline(prepared, { onLog = () => {}, onPhase = () => {}, onDone = () => {}, spawnProcess = spawn, kill = p => p.kill() } = {}) {
  const job = { krea2: true, type: 'training', phase: 'preparing', cancelled: false, process: null, pid: null,
    startTime: Date.now(), logBuffer: [], gpuIds: prepared.gpuIds, outcome: null };
  let started = false;
  job.stop = async () => { job.cancelled = true; job.phase = 'stopping'; onPhase(job.phase); if (job.process) await kill(job.process); };
  job.start = async () => {
    if (started) throw Error('Pipeline already started'); started = true;
    let error;
    try {
      for (const stage of prepared.stages) {
        if (job.cancelled) break;
        job.phase = stage.phase; onPhase(stage.phase); onLog(`\n[Krea 2] ${stage.phase}\n`);
        await new Promise((resolve, reject) => {
          const proc = spawnProcess(prepared.rt.python, stage.args, { cwd: prepared.rt.cwd,
            env: processEnv(prepared.gpuIds), windowsHide: true, shell: false });
          job.process = proc; job.pid = proc.pid;
          proc.stdout?.on('data', data => onLog(data.toString())); proc.stderr?.on('data', data => onLog(data.toString()));
          proc.on('error', reject);
          proc.on('close', code => { job.process = null; job.pid = null; code === 0 || job.cancelled ? resolve() : reject(Error(`${stage.phase} failed (exit ${code})`)); });
        });
      }
    } catch (err) { error = err; onLog(`\nERROR: ${err.message}\n`); }
    job.outcome = job.cancelled ? 'stopped' : error ? 'failed' : 'completed';
    job.phase = job.outcome; onLog(`\n[Krea 2] ${job.outcome}\n`); onPhase(job.phase); onDone(job.outcome, error);
    return job.outcome;
  };
  return job;
}
module.exports = { REVISION, VENDOR, runtime, status, prepareDataset, prepareTraining, prepareGeneration, validatePrompts, pipeline };
