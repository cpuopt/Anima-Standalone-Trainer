(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.Krea2 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const MODULE = 'musubi_tuner.networks.lora_krea2';
  const TRAIN_KEYS = ['output_name', 'max_train_epochs', 'max_train_steps', 'save_every_n_epochs', 'save_every_n_steps',
    'sample_every_n_epochs', 'sample_every_n_steps', 'learning_rate', 'optimizer_type', 'optimizer_args',
    'lr_scheduler', 'lr_scheduler_num_cycles', 'lr_scheduler_min_lr_ratio', 'lr_warmup_steps', 'mixed_precision',
    'save_precision', 'max_data_loader_n_workers', 'persistent_data_loader_workers', 'gradient_accumulation_steps',
    'max_grad_norm', 'gradient_checkpointing', 'gradient_checkpointing_cpu_offload', 'blocks_to_swap',
    'seed', 'log_with', 'compile', 'sdpa', 'flash_attn', 'xformers', 'split_attn', 'fp8_base', 'fp8_scaled'];
  const NETWORK_KEYS = ['network_module', 'network_dim', 'network_alpha', 'network_dropout', 'network_args',
    'network_weights', 'resume', 'auto_resume_last_state'];
  const MODEL_KEYS = ['timestep_sampling', 'discrete_flow_shift', 'weighting_scheme', 'vae_batch_size', 'text_encoder_batch_size'];
  const ARG_KEYS = ['rank_dropout', 'module_dropout', 'loraplus_lr_ratio', 'include_patterns', 'exclude_patterns', 'verbose'];
  const OPTIMIZERS = ['AdamW', 'AdamW8bit', 'Adafactor'];
  const SCHEDULERS = ['constant', 'linear', 'cosine', 'cosine_with_restarts', 'cosine_with_min_lr', 'polynomial'];
  const TIMESTEPS = ['krea2_shift', 'shift', 'sigmoid', 'uniform', 'sigma'];
  const pick = (object, keys) => Object.fromEntries(keys.filter(k => object[k] !== undefined).map(k => [k, object[k]]));
  function architecture(config) {
    return config.architecture || (config.network_arguments?.network_module === MODULE || config.krea2_arguments ? 'krea2' :
      config.network_arguments?.network_module === 'networks.lora_lumina' || config.lumina_arguments ? 'lumina' : 'anima');
  }
  function defaults() {
    return { architecture: 'krea2', gpu_ids: '', training_arguments: {
      output_name: 'my_krea2_lora', max_train_epochs: 15, save_every_n_epochs: 1,
      learning_rate: 1e-4, optimizer_type: 'AdamW8bit', optimizer_args: ['weight_decay=0.01'],
      lr_scheduler: 'constant', lr_warmup_steps: 0, mixed_precision: 'bf16', save_precision: 'bf16',
      gradient_checkpointing: true, gradient_accumulation_steps: 1, max_grad_norm: 1,
      max_data_loader_n_workers: 2, persistent_data_loader_workers: true, seed: 42,
      log_with: 'tensorboard', sdpa: true, fp8_base: true, fp8_scaled: true, blocks_to_swap: 26,
    }, network_arguments: { network_module: MODULE, network_dim: 32, network_alpha: 32 },
    krea2_arguments: { timestep_sampling: 'krea2_shift', weighting_scheme: 'none', discrete_flow_shift: 2.5,
      vae_batch_size: 1, text_encoder_batch_size: 1 } };
  }
  function datasetDefaults() {
    return { general: { enable_bucket: true, bucket_no_upscale: true }, datasets: [{
      resolution: [1024, 1024], batch_size: 1, caption_extension: '.txt',
      subsets: [{ image_dir: '', num_repeats: 1 }],
    }] };
  }
  function assertKeys(object, keys, name) {
    if (!object || typeof object !== 'object' || Array.isArray(object)) throw Error(`${name}: expected an object`);
    for (const k of Object.keys(object)) if (!keys.includes(k)) throw Error(`Krea 2 does not support ${name}.${k}`);
  }
  function number(value, label, min, max = Infinity, integer = false) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
      throw Error(`${label}: expected ${integer ? 'integer' : 'number'} in ${min}..${max}`);
    }
  }
  function validate(config) {
    assertKeys(config, ['architecture', 'gpu_ids', 'training_arguments', 'network_arguments', 'krea2_arguments'], 'config');
    if (architecture(config) !== 'krea2') throw Error('Expected Krea 2 architecture');
    const t = config.training_arguments || {}, n = config.network_arguments || {}, k = config.krea2_arguments || {};
    assertKeys(t, TRAIN_KEYS, 'training_arguments'); assertKeys(n, NETWORK_KEYS, 'network_arguments'); assertKeys(k, MODEL_KEYS, 'krea2_arguments');
    for (const key of ['gradient_checkpointing', 'gradient_checkpointing_cpu_offload', 'persistent_data_loader_workers', 'compile', 'sdpa', 'flash_attn', 'xformers', 'split_attn', 'fp8_base', 'fp8_scaled']) {
      if (t[key] !== undefined && typeof t[key] !== 'boolean') throw Error(`${key}: expected boolean`);
    }
    if (typeof t.output_name !== 'string' || !t.output_name.trim() || /[\\/]/.test(t.output_name) || /^\.{1,2}$/.test(t.output_name)) throw Error('Invalid output name');
    if (n.network_module !== MODULE) throw Error('Krea 2 supports native LoRA only');
    number(n.network_dim, 'rank', 1, 4096, true); number(n.network_alpha, 'alpha', Number.EPSILON);
    if (n.network_dropout !== undefined) number(n.network_dropout, 'network_dropout', 0, 1 - Number.EPSILON);
    if (t.mixed_precision !== 'bf16') throw Error('Krea 2 v1 requires bf16 mixed precision');
    if (!OPTIMIZERS.includes(t.optimizer_type)) throw Error('Unsupported Krea 2 optimizer');
    if (!SCHEDULERS.includes(t.lr_scheduler)) throw Error('Unsupported Krea 2 LR scheduler');
    if (!TIMESTEPS.includes(k.timestep_sampling)) throw Error('Unsupported Krea 2 timestep sampling');
    if (k.weighting_scheme !== 'none') throw Error('Krea 2 v1 uses weighting_scheme=none');
    number(t.learning_rate, 'learning_rate', Number.EPSILON);
    number(t.blocks_to_swap ?? 0, 'blocks_to_swap', 0, 26, true);
    for (const key of ['max_train_epochs','max_train_steps','save_every_n_epochs','save_every_n_steps', 'sample_every_n_epochs','sample_every_n_steps','gradient_accumulation_steps']) {
      if (t[key] !== undefined) number(t[key], key, 1, Infinity, true);
    }
    if (!t.max_train_epochs && !t.max_train_steps) throw Error('Training duration is required');
    number(t.max_data_loader_n_workers ?? 0, 'workers', 0, Infinity, true);
    if (t.persistent_data_loader_workers && !t.max_data_loader_n_workers) throw Error('Persistent workers require workers > 0');
    if (t.fp8_base !== t.fp8_scaled) throw Error('Krea 2 FP8 requires fp8_base and fp8_scaled together');
    if (t.gradient_checkpointing_cpu_offload && !t.gradient_checkpointing) throw Error('CPU activation offload requires gradient checkpointing');
    if ([t.sdpa, t.flash_attn, t.xformers].filter(Boolean).length !== 1) throw Error('Choose exactly one attention backend');
    const ids = String(config.gpu_ids || '').trim();
    if (ids && !/^\d+$/.test(ids)) throw Error('Krea 2 v1 supports exactly one GPU');
    if (n.network_args !== undefined && !Array.isArray(n.network_args)) throw Error('network_args must be an array');
    const seenArgs = new Set();
    for (const token of n.network_args || []) {
      if (typeof token !== 'string') throw Error('network_args must contain strings');
      const eq = token.indexOf('='), key = token.slice(0, eq).trim(), value = token.slice(eq + 1).trim();
      if (eq < 1 || !ARG_KEYS.includes(key)) throw Error(`Unsupported Krea 2 network argument: ${token}`);
      if (seenArgs.has(key)) throw Error(`Duplicate network argument: ${key}`); seenArgs.add(key);
      if (key.endsWith('patterns') && (!value.startsWith('[') || !value.endsWith(']'))) throw Error(`${key} must be a Python/JSON list`);
      if (key.endsWith('dropout')) number(Number(value), key, 0, 1 - Number.EPSILON);
      if (key === 'loraplus_lr_ratio') number(Number(value), key, Number.EPSILON);
    }
    for (const key of ['vae_batch_size', 'text_encoder_batch_size']) number(k[key] ?? 1, key, 1, Infinity, true);
    if (k.discrete_flow_shift !== undefined) number(k.discrete_flow_shift, 'discrete_flow_shift', Number.EPSILON);
    if (t.save_precision && !['float','fp32','fp16','bf16'].includes(t.save_precision)) throw Error('Unsupported save precision');
    if (t.log_with && t.log_with !== 'tensorboard') throw Error('Krea 2 UI uses TensorBoard logging');
    if (t.optimizer_args !== undefined && (!Array.isArray(t.optimizer_args) || t.optimizer_args.some(x => typeof x !== 'string' || !x.includes('=')))) throw Error('Invalid optimizer arguments');
    if (t.optimizer_type !== 'Adafactor' && (t.optimizer_args || []).some(x =>
      ['relative_step', 'scale_parameter', 'warmup_init', 'clip_threshold', 'decay_rate', 'beta1'].includes(x.split('=')[0].trim()))) {
      throw Error('Adafactor arguments cannot be used with AdamW/AdamW8bit; remove incompatible optimizer arguments');
    }
    if (t.lr_warmup_steps !== undefined) number(t.lr_warmup_steps, 'warmup', 0, Infinity, true);
    if (t.lr_scheduler_num_cycles !== undefined) number(t.lr_scheduler_num_cycles, 'cycles', 1, Infinity, true);
    if (t.lr_scheduler_min_lr_ratio !== undefined) number(t.lr_scheduler_min_lr_ratio, 'min_lr_ratio', 0, 1);
    return config;
  }
  function validateDataset(dataset, requirePaths = false) {
    assertKeys(dataset, ['general', 'datasets'], 'dataset');
    assertKeys(dataset.general || {}, ['enable_bucket', 'bucket_no_upscale'], 'general');
    for (const v of Object.values(dataset.general || {})) if (typeof v !== 'boolean') throw Error('Bucket settings must be booleans');
    if (!Array.isArray(dataset.datasets) || !dataset.datasets.length) throw Error('At least one dataset is required');
    for (const d of dataset.datasets) {
      assertKeys(d, ['resolution', 'batch_size', 'caption_extension', 'subsets'], 'dataset');
      const res = Array.isArray(d.resolution) ? d.resolution : [d.resolution, d.resolution];
      if (res.length !== 2) throw Error('Resolution must have two dimensions');
      res.forEach(v => { number(v, 'resolution', 256, Infinity, true); if (v % 16) throw Error('Krea 2 resolution must be a multiple of 16'); });
      number(d.batch_size, 'batch_size', 1, Infinity, true);
      if (typeof d.caption_extension !== 'string' || !/^\.[a-zA-Z0-9]+$/.test(d.caption_extension)) throw Error('Invalid caption extension');
      if (!Array.isArray(d.subsets) || !d.subsets.length) throw Error('At least one image folder is required');
      for (const s of d.subsets) {
        assertKeys(s, ['image_dir', 'num_repeats'], 'subset');
        if (typeof s.image_dir !== 'string' || (requirePaths && !s.image_dir.trim())) throw Error('Image directory is required');
        number(s.num_repeats, 'num_repeats', 1, Infinity, true);
      }
    }
    return dataset;
  }
  return { MODULE, TRAIN_KEYS, NETWORK_KEYS, MODEL_KEYS, ARG_KEYS, OPTIMIZERS, SCHEDULERS, TIMESTEPS,
    pick, architecture, defaults, datasetDefaults, validate, validateDataset };
});
