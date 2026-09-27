(function () {
  const $ = id => document.getElementById(id);
  let config = null, layers = [], loadError = '', invalidRaw = null, requestId = 0;
  const supported = () => ['networks.lora_anima', 'networks.loha', 'networks.lokr'].includes($('cfg-network-module').value);
  const isLokr = () => $('cfg-network-module').value === 'networks.lokr';
  const active = () => supported() && $('cfg-training-type').value !== 'full_finetune' && $('cfg-layer-advanced').checked;
  const full = () => isLokr() && $('cfg-lokr-full-matrix').checked;
  const changed = () => { if (typeof checkDirty === 'function') checkDirty(); };
  function message(text) { $('layer-rank-message').textContent = text; }
  function currentConfig() { return config && LayerRank.compact(config, isLokr()); }
  function update() {
    $('layer-advanced-toggle').classList.toggle('hidden', !supported());
    $('layer-rank-panel').classList.toggle('hidden', !active());
    $('cfg-network-dim').disabled = active() || full();
    $('network-rank-group').classList.remove('disabled-section');
    $('network-rank-help').textContent = active() ? 'Block 层使用下方分层设置；原 Rank 值保留。' : full() ? 'Ignored because LoKr Full Matrix is enabled.' : 'Higher = more capacity, more VRAM.';
    $('layer-full-matrix-note').classList.toggle('hidden', !full());
    render();
  }
  async function fetchLayers() {
    const id = ++requestId;
    layers = []; loadError = '正在读取模型层列表…'; message(loadError);
    try {
      const response = await fetch('/api/anima-layers');
      const data = await response.json();
      if (!response.ok) throw Error(data.error || '无法读取模型');
      if (id !== requestId) return;
      layers = data.layers;
      if (invalidRaw) throw Error('layer_configs JSON 无效，请修正配置文件');
      loadError = ''; message(`已读取 ${data.block_count} 个 Block，${layers.length} 个可配置层。`);
    } catch (error) {
      if (id !== requestId) return;
      loadError = error.message; message(loadError);
    }
    render();
  }
  function render() {
    const container = $('layer-rank-rows');
    container.replaceChildren();
    if (!config || !active()) return;
    document.querySelectorAll('input[name="layer-rank-mode"]').forEach(el => el.checked = el.value === config.mode);
    if (loadError || !layers.length) return;
    const visible = currentConfig();
    const group = config.mode === 'type' ? 'types' : 'layers';
    const names = config.mode === 'type' ? Object.keys(LayerRank.types) : layers;
    let block = null, target = container;
    for (const name of names) {
      if (group === 'layers' && name.split('.')[1] !== block) {
        block = name.split('.')[1];
        target = document.createElement('details'); target.open = block === layers[0].split('.')[1];
        const summary = document.createElement('summary'); summary.textContent = `Block ${block}`;
        target.append(summary); container.append(target);
      }
      const values = LayerRank.resolve(visible, name, group === 'types');
      const row = document.createElement('div'); row.className = 'layer-rank-row';
      const title = document.createElement('span'); title.className = 'layer-rank-name';
      title.textContent = group === 'types' ? LayerRank.types[name] : name;
      row.append(title);
      const toggleLabel = document.createElement('label');
      const toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.checked = values.enabled;
      toggleLabel.append(toggle, '训练该层'); row.append(toggleLabel);
      const inputs = {};
      function edit(key, value) {
        config[group] ||= {}; config[group][name] ||= {};
        config[group][name][key] = value;
      }
      for (const key of ['rank', 'alpha', ...(isLokr() ? ['factor'] : [])]) {
        const label = document.createElement('label');
        label.textContent = key === 'alpha' ? 'Alpha（默认=Rank）' : key === 'rank' ? 'Rank' : 'Factor';
        const input = document.createElement('input'); input.type = 'number'; input.required = true;
        input.step = key === 'alpha' ? 'any' : '1'; input.min = key === 'factor' ? '-1' : key === 'alpha' ? '0.000001' : '1';
        input.value = values[key]; input.setAttribute('aria-label', `${name} ${key}`);
        input.disabled = !toggle.checked || (full() && key !== 'factor');
        input.addEventListener('input', () => {
          const value = input.value === '' ? null : Number(input.value);
          edit(key, value);
          if (key === 'alpha' && value === Number(inputs.rank.value)) delete config[group][name].alpha;
          if (key === 'rank' && !Object.hasOwn(config[group][name], 'alpha')) inputs.alpha.value = input.value;
          changed();
        });
        inputs[key] = input; label.append(input); row.append(label);
      }
      toggle.addEventListener('change', () => {
        edit('enabled', toggle.checked);
        for (const [key, input] of Object.entries(inputs)) input.disabled = !toggle.checked || (full() && key !== 'factor');
        changed();
      });
      target.append(row);
    }
  }
  $('cfg-layer-advanced').addEventListener('change', () => {
    if ($('cfg-layer-advanced').checked && !config) {
      config = LayerRank.create($('cfg-network-dim').value, $('cfg-lokr-factor').value || -1);
    }
    update(); if (active()) fetchLayers(); changed();
  });
  document.querySelectorAll('input[name="layer-rank-mode"]').forEach(input => input.addEventListener('change', () => {
    config.mode = input.value; render(); changed();
  }));
  $('layer-rank-refresh').addEventListener('click', fetchLayers);
  $('layer-rank-reset').addEventListener('click', () => {
    config = LayerRank.create($('cfg-network-dim').value, $('cfg-lokr-factor').value || -1);
    invalidRaw = null; update(); fetchLayers(); changed();
  });
  window.LayerRankUI = {
    active, update,
    load(raw) {
      ++requestId; config = null; invalidRaw = null; layers = []; loadError = '';
      $('cfg-layer-advanced').checked = raw != null;
      if (raw != null) {
        try { config = JSON.parse(raw); } catch (_) { invalidRaw = raw; config = LayerRank.create($('cfg-network-dim').value); }
      }
      update(); if (active()) fetchLayers();
    },
    token() { return active() ? `layer_configs=${invalidRaw ?? JSON.stringify(currentConfig())}` : null; },
    draftToken() { return $('cfg-layer-advanced').checked && config ? `layer_configs=${invalidRaw ?? JSON.stringify(LayerRank.compact(config, true))}` : null; },
    async validate() {
      if (!active()) return;
      await fetchLayers();
      if (loadError) throw Error(loadError);
      LayerRank.validate(currentConfig(), layers);
    }
  };
})();
