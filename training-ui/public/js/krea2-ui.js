const KreaUI = (() => {
  const $ = id => document.getElementById(id);
  const originalOptions = new Map();
  let optimizerExtras = new Map();
  function options(id, entries) {
    const el = $(id);
    if (!originalOptions.has(id)) originalOptions.set(id, el.innerHTML);
    el.replaceChildren(...entries.map(([value, label]) => new Option(label, value)));
  }
  function markControl(id) {
    const el = $(id); if (el) (el.closest('.form-group, .compact-input, .checkbox-group') || el).setAttribute('data-anima-only', '');
  }
  function beforePopulate(config) {
    const active = Krea2.architecture(config) === 'krea2';
    $('cfg-flow-shift').disabled = false;
    optimizerExtras = new Map();
    if (active) optimizerExtras.set(config.training_arguments.optimizer_type,
      (config.training_arguments.optimizer_args || []).filter(x => !x.startsWith('weight_decay=')));
    document.body.classList.toggle('krea2-mode', active);
    const registry = typeof archRegistry !== 'undefined' ? archRegistry?.architectures?.krea2 : null;
    const hidden = registry?.capabilities?.hidden_fields || [];
    hidden.forEach(markControl);
    ['global-sampler','global-scheduler','global-strength','gen-flash-attn','gen-sage-attn','chk-keep-loaded'].forEach(markControl);
    ['btn-unload-model','gen-multi-gpu-options','layer-rank-panel','layer-advanced-toggle','lbai-meter'].forEach(id => $(id)?.setAttribute('data-anima-only', ''));
    const children = Array.from($('tab-multigpu').children); let afterAllocation = false;
    children.forEach(el => { if (el.tagName === 'HR') afterAllocation = true; if (afterAllocation) el.setAttribute('data-anima-only', ''); });
    $('krea2-settings').classList.toggle('hidden', !active);
    $('krea2-generation').classList.toggle('hidden', !active);
    $('krea2-notice').classList.toggle('hidden', !active);
    if (active) {
      options('cfg-network-module', [[Krea2.MODULE, 'LoRA (Krea 2)']]);
      options('cfg-training-type', [['lora', 'LoRA']]);
      options('cfg-optimizer', Krea2.OPTIMIZERS.map(x => [x, x]));
      options('cfg-timestep-method', Krea2.TIMESTEPS.map(x => [x, x]));
      options('cfg-mixed-precision', [['bf16','BFloat16']]);
      options('cfg-activation-offload', [['none','None'],['cpu','CPU Offload']]);
      $('cfg-network-dropout').max = '0.999';
      $('global-w').value = 1024; $('global-h').value = 1024; $('global-s').value = 52; $('global-l').value = 3.5;
      $('global-negative-prompt').value = '';
    } else {
      for (const [id, html] of originalOptions) $(id).innerHTML = html;
      $('cfg-network-dropout').max = '1';
    }
  }
  function populate(config) {
    if (Krea2.architecture(config) !== 'krea2') return;
    for (const selector of ['#cfg-gpu-selection input[type="checkbox"]', '#gen-gpu-selection input[type="checkbox"]']) {
      const selected = Array.from(document.querySelectorAll(selector)).filter(el => el.checked);
      selected.slice(1).forEach(el => { el.checked = false; el.closest('.gpu-card')?.classList.remove('selected'); });
    }
    const t = config.training_arguments, k = config.krea2_arguments;
    $('cfg-timestep-method').value = k.timestep_sampling;
    $('cfg-flow-shift').value = k.discrete_flow_shift ?? 2.5;
    $('cfg-flow-shift').disabled = k.timestep_sampling === 'krea2_shift';
    $('cfg-torch-compile').checked = t.compile || false;
    $('cfg-activation-offload').value = t.gradient_checkpointing_cpu_offload ? 'cpu' : 'none';
    $('krea2-fp8').checked = !!t.fp8_scaled;
    $('krea2-attention').value = t.flash_attn ? 'flash' : t.xformers ? 'xformers' : 'sdpa';
    $('krea2-split-attn').checked = !!t.split_attn;
    $('krea2-te-batch').value = k.text_encoder_batch_size || 1;
    $('cfg-vae-batch').value = k.vae_batch_size || 1;
    const values = Object.fromEntries((config.network_arguments.network_args || []).map(token => {
      const eq = token.indexOf('='); return [token.slice(0,eq), token.slice(eq+1)];
    }));
    $('krea2-rank-dropout').value = values.rank_dropout || 0;
    $('krea2-module-dropout').value = values.module_dropout || 0;
    $('krea2-loraplus').value = values.loraplus_lr_ratio || '';
    $('cfg-network-args').value = (config.network_arguments.network_args || []).filter(x => !/^(rank_dropout|module_dropout|loraplus_lr_ratio)=/.test(x)).join(' ');
    const setting = JSON.parse(localStorage.getItem(`krea2_generation_${currentJob}`) || 'null');
    $('krea2-gen-base').value = setting?.base || 'turbo';
    $('krea2-gen-steps').value = setting?.steps ?? 8;
    $('krea2-gen-cfg').value = setting?.cfg ?? 1;
  }
  function networkArgs() {
    const tokens = LayerRank.tokenize($('cfg-network-args').value.trim());
    for (const [id, key] of [['krea2-rank-dropout','rank_dropout'],['krea2-module-dropout','module_dropout'],['krea2-loraplus','loraplus_lr_ratio']]) {
      const raw = $(id).value.trim();
      if (raw && Number(raw) !== 0) tokens.push(`${key}=${raw}`);
    }
    return tokens;
  }
  function config(raw) {
    const t = Krea2.pick(raw.training_arguments, Krea2.TRAIN_KEYS);
    t.optimizer_args = [...(t.optimizer_args || []), ...(optimizerExtras.get(t.optimizer_type) || [])];
    if (t.optimizer_type === 'Adafactor') {
      for (const arg of ['relative_step=False', 'scale_parameter=False']) if (!t.optimizer_args.some(x => x.split('=')[0] === arg.split('=')[0])) t.optimizer_args.push(arg);
    }
    t.compile = $('cfg-torch-compile').checked;
    t.gradient_checkpointing_cpu_offload = $('cfg-activation-offload').value === 'cpu';
    const attn = $('krea2-attention').value;
    t.sdpa = attn === 'sdpa'; t.flash_attn = attn === 'flash'; t.xformers = attn === 'xformers';
    t.split_attn = $('krea2-split-attn').checked;
    t.fp8_base = t.fp8_scaled = $('krea2-fp8').checked;
    const n = Krea2.pick(raw.network_arguments, Krea2.NETWORK_KEYS);
    n.network_module = Krea2.MODULE; n.network_args = networkArgs();
    return { architecture: 'krea2', gpu_ids: raw.gpu_ids, training_arguments: t, network_arguments: n,
      krea2_arguments: { timestep_sampling: $('cfg-timestep-method').value,
        discrete_flow_shift: Number($('cfg-flow-shift').value), weighting_scheme: 'none',
        vae_batch_size: Number($('cfg-vae-batch').value), text_encoder_batch_size: Number($('krea2-te-batch').value) } };
  }
  function dataset() {
    const resolutions = $('cfg-resolution').value.split(',').map(x => Number(x.trim()));
    const batches = $('cfg-batch-size').value.split(',').map(x => Number(x.trim()));
    return { general: { enable_bucket: $('cfg-enable-bucket').checked, bucket_no_upscale: $('cfg-bucket-no-upscale').checked },
      datasets: resolutions.map((r, i) => ({ resolution: [r,r], batch_size: batches[i] ?? batches.at(-1),
        caption_extension: $('cfg-caption-ext').value,
        subsets: currentSubsets.map(s => ({ image_dir: s.image_dir, num_repeats: Number(s.num_repeats) })) })) };
  }
  function dynamicControls() {
    document.querySelectorAll('.sub-epoch-sample-rate,.sub-keep-tokens,.sub-caption-prefix,.sub-caption-dropout,.sub-tag-dropout,.sub-dropout-every-n,.sub-shuffle-caption,.sub-flip-aug,.sub-is-reg')
      .forEach(el => (el.closest('.form-group') || el).setAttribute('data-anima-only',''));
    document.querySelectorAll('.p-sampler,.p-scheduler,.p-strength').forEach(el => el.closest('.compact-input').setAttribute('data-anima-only',''));
  }
  function generation(payload) {
    const setting = { base: $('krea2-gen-base').value, steps: Number($('krea2-gen-steps').value), cfg: Number($('krea2-gen-cfg').value) };
    localStorage.setItem(`krea2_generation_${currentJob}`, JSON.stringify(setting));
    return { network_weights: payload.network_weights, network_mul: payload.network_mul,
      gen_gpu_ids: payload.gen_gpu_ids, krea2_base: setting.base, krea2_steps: setting.steps, krea2_cfg: setting.cfg };
  }
  return { beforePopulate, populate, networkArgs, config, dataset, dynamicControls, generation };
})();
