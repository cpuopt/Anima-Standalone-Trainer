(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LayerRank = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const types = {self_attn: 'Self Attention', cross_attn: 'Cross Attention', mlp: 'MLP', modulation: 'AdaLN Modulation'};
  function typeOf(name) {
    const m = /^blocks\.\d+\.(self_attn|cross_attn|mlp|adaln_modulation_[^.]+)\..+$/.exec(name);
    return m ? (m[1].startsWith('adaln_') ? 'modulation' : m[1]) : null;
  }
  function create(rank, factor = -1) {
    return {version: 1, mode: 'type', default_rank: Number(rank), default_factor: Number(factor), types: {}, layers: {}};
  }
  function resolve(config, name, isType = false) {
    const row = {rank: config.default_rank, enabled: true, factor: config.default_factor ?? -1,
      ...(config.types?.[isType ? name : typeOf(name)] || {}), ...(isType ? {} : config.layers?.[name] || {})};
    row.alpha ??= row.rank;
    return row;
  }
  function validate(config, names) {
    const positive = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;
    const factor = (n) => Number.isInteger(n) && (n === -1 || n > 0);
    if (!config || config.version !== 1 || !['type', 'layer'].includes(config.mode)) throw Error('不支持的分层配置版本或模式');
    if (!positive(config.default_rank) || !Number.isInteger(config.default_rank)) throw Error('Rank 必须为正整数');
    if (!factor(config.default_factor ?? -1)) throw Error('Factor 必须为 -1 或正整数');
    for (const group of ['types', 'layers']) {
      const entries = config[group] || {};
      if (typeof entries !== 'object' || Array.isArray(entries)) throw Error('分层配置格式错误');
      for (const [name, entry] of Object.entries(entries)) {
        if (group === 'types' ? !Object.hasOwn(types, name) : !names.includes(name)) throw Error(`模型中不存在该层：${name}`);
        if (!entry || typeof entry !== 'object' || Object.keys(entry).some(k => !['rank', 'alpha', 'factor', 'enabled'].includes(k))) throw Error(`无效的层配置：${name}`);
        if ('enabled' in entry && typeof entry.enabled !== 'boolean') throw Error('训练开关必须为布尔值');
        if ('rank' in entry && (!positive(entry.rank) || !Number.isInteger(entry.rank))) throw Error(`${name}: Rank 必须为正整数`);
        if ('alpha' in entry && !positive(entry.alpha)) throw Error(`${name}: Alpha 必须大于 0`);
        if ('factor' in entry && !factor(entry.factor)) throw Error(`${name}: Factor 必须为 -1 或正整数`);
      }
    }
  }
  // Only the selected mode is serialized. Switching modes keeps separate drafts.
  function compact(config, isLokr) {
    const out = {version: 1, mode: config.mode, default_rank: config.default_rank};
    if (isLokr) out.default_factor = config.default_factor ?? -1;
    const group = config.mode === 'type' ? 'types' : 'layers';
    const entries = {};
    for (const [name, entry] of Object.entries(config[group] || {})) {
      const next = {};
      if (entry.enabled === false) next.enabled = false;
      if ('rank' in entry && entry.rank !== config.default_rank) next.rank = entry.rank;
      if ('alpha' in entry) next.alpha = entry.alpha;
      if (isLokr && 'factor' in entry && entry.factor !== (config.default_factor ?? -1)) next.factor = entry.factor;
      if (Object.keys(next).length) entries[name] = next;
    }
    out[group] = entries;
    return out;
  }
  function tokenize(text) {
    const tokens = []; let token = '', depth = 0, quote = '', escaped = false;
    for (const char of text) {
      if (!quote && !depth && /\s/.test(char)) { if (token) tokens.push(token); token = ''; continue; }
      token += char;
      if (escaped) { escaped = false; continue; }
      if (quote) { if (char === '\\') escaped = true; else if (char === quote) quote = ''; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === '{' || char === '[') depth++;
      else if (char === '}' || char === ']') depth--;
    }
    if (token) tokens.push(token);
    return tokens;
  }
  return {types, typeOf, create, resolve, validate, compact, tokenize};
});
