(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./layer-rank') : root.LayerRank);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AdapterMatrix = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (LayerRank) {
  const samples = {
    anima: [
      { name: 'blocks.0.self_attn.q_proj', input: 2048, output: 2048 },
      { name: 'blocks.0.cross_attn.k_proj', input: 1024, output: 2048 },
      { name: 'blocks.0.mlp.layer1', input: 2048, output: 8192 },
    ],
    krea2: [
      { name: 'blocks.0.attn.wq', input: 6144, output: 6144 },
      { name: 'blocks.0.attn.wk', input: 6144, output: 1536 },
      { name: 'blocks.0.mlp.up', input: 6144, output: 16384 },
    ],
  };
  function integer(value, name, min = 1) {
    if (!Number.isSafeInteger(value) || value < min) throw Error(`${name} 必须为${min === 1 ? '正' : '非负'}整数`);
  }
  // Mirrors factorization() in both networks/lokr.py and Musubi networks/lokr.py.
  function factorization(dimension, factor = -1) {
    integer(dimension, '矩阵维度');
    if (!Number.isSafeInteger(factor) || (factor !== -1 && factor < 1)) throw Error('Factor 必须为 -1 或正整数');
    if (factor > 0 && dimension % factor === 0) return [factor, dimension / factor].sort((a, b) => a - b);
    const limit = factor < 0 ? dimension : factor;
    let m = 1, n = dimension;
    while (m < n) {
      let next = m + 1;
      while (dimension % next !== 0) next++;
      const other = dimension / next;
      if (next + other > m + n || next > limit) break;
      m = next; n = other;
    }
    return [m, n].sort((a, b) => a - b);
  }
  function calculate({ input, output, rank, factor = -1, kind = 'lora', full = false, dora = false }) {
    integer(input, '输入维度'); integer(output, '输出维度');
    if (!['lora', 'loha', 'lokr'].includes(kind)) throw Error('不支持的适配器类型');
    if (!(kind === 'lokr' && full)) integer(rank, 'Rank');
    let matrices, mode, split = null;
    if (kind === 'lokr') {
      const [im, inn] = factorization(input, factor), [ol, ok] = factorization(output, factor);
      split = { input: [im, inn], output: [ol, ok] };
      const useFull = full || rank >= Math.max(ok, inn) / 2;
      mode = full ? 'Full（手动）' : useFull ? 'Full（自动）' : `LoKR · rank ${rank}`;
      matrices = [['W1', [ol, im]], ...(useFull ? [['W2', [ok, inn]]] : [['W2a', [ok, rank]], ['W2b', [rank, inn]]])];
    } else if (kind === 'loha') {
      mode = `LoHa · rank ${rank}`;
      matrices = [['W1a', [output, rank]], ['W1b', [rank, input]], ['W2a', [output, rank]], ['W2b', [rank, input]]];
    } else {
      mode = `LoRA · rank ${rank}`;
      matrices = [['down', [rank, input]], ['up', [output, rank]]];
    }
    if (dora) {
      matrices.push(['magnitude', [output, 1]]);
      mode = mode.replace('LoKR', 'DoKr').replace('LoRA', 'DoRA');
      if (kind === 'lokr' && mode.startsWith('Full')) mode = `DoKr · ${mode}`;
    }
    const count = matrices.reduce((sum, [, shape]) => sum + shape.reduce((a, b) => a * b, 1), 0);
    const base = input * output;
    if (!Number.isSafeInteger(count) || !Number.isSafeInteger(base)) throw Error('参数量超出可计算范围');
    return { matrices, count, base, percent: count / base * 100, mode, split };
  }
  function boolean(value) { return /^(true|1|yes|y|on)$/i.test(String(value)); }
  function preview({ architecture, networkModule, rank, args = [] }) {
    const kind = networkModule.endsWith('.lokr') ? 'lokr' : networkModule.endsWith('.loha') ? 'loha' : 'lora';
    const values = {};
    for (const token of args) {
      const eq = token.indexOf('='), key = token.slice(0, eq).trim();
      if (eq < 1) throw Error('Network Args 必须为 key=value');
      if (Object.hasOwn(values, key)) throw Error(`Network Args 重复参数：${key}`);
      values[key] = token.slice(eq + 1).trim();
    }
    const config = values.layer_configs ? JSON.parse(values.layer_configs) : null;
    if (config && (config.version !== 1 || !['type', 'layer'].includes(config.mode))) throw Error('无效的分层配置');
    return (samples[architecture] || []).map(sample => {
      const type = LayerRank.typeOf(sample.name);
      let selected = { rank: Number(rank), factor: Number(values.factor ?? -1), enabled: true };
      const typeKey = { self_attn: 'self_attn_dim', cross_attn: 'cross_attn_dim', mlp: 'mlp_dim' }[type];
      if (architecture === 'anima' && typeKey && values[typeKey] !== undefined) {
        selected.rank = Number(values[typeKey]); selected.enabled = selected.rank !== 0;
      }
      if (architecture === 'anima' && config) selected = LayerRank.resolve(config, sample.name);
      if (!selected.enabled) return { ...sample, matrices: [], count: 0,
        base: sample.input * sample.output, percent: 0, mode: '该样例层已关闭' };
      return { ...sample, ...calculate({ ...sample, ...selected, kind,
        full: boolean(values.full_matrix), dora: architecture === 'anima' && boolean(values.use_dora) }) };
    });
  }
  function render(document, rows, results) {
    rows.replaceChildren();
    for (const result of results) {
      const tr = document.createElement('tr');
      const content = [result.name, `${result.output} × ${result.input}`, result.mode,
        result.matrices.map(([name, shape]) => `${name}: ${shape.join(' × ')}`).join('\n') || '—',
        result.count.toLocaleString('en-US'), `${result.percent.toFixed(4)}%`];
      for (const text of content) { const td = document.createElement('td'); td.textContent = text; tr.append(td); }
      rows.append(tr);
    }
  }
  return { factorization, calculate, preview, render };
});
