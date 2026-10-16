const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const M = require('../public/js/adapter-matrix');
const Krea2 = require('../public/js/krea2');

test('ordinary LoRA reproduces Anima and Krea2 examples, with output/input matrix order', () => {
  const anima = M.calculate({ input: 2048, output: 2048, rank: 32 });
  assert.equal(anima.count, 131072); assert.equal(anima.percent, 3.125);
  const krea = M.calculate({ input: 6144, output: 6144, rank: 32 });
  assert.equal(krea.count, 393216);
  assert.deepEqual(krea.matrices, [['down', [32, 6144]], ['up', [6144, 32]]]);
});
test('low-rank LoKR factor 3/rank32 and full factor16 match the discussed calculations', () => {
  const low = M.calculate({ input: 6144, output: 6144, rank: 32, factor: 3, kind: 'lokr' });
  assert.equal(low.count, 131081); assert.ok(Math.abs(low.percent - 0.347246) < 0.000001);
  assert.deepEqual(low.matrices, [['W1', [3, 3]], ['W2a', [2048, 32]], ['W2b', [32, 2048]]]);
  const full = M.calculate({ input: 6144, output: 6144, rank: 32, factor: 16, kind: 'lokr', full: true });
  assert.equal(full.count, 147712);
  assert.deepEqual(full.matrices, [['W1', [16, 16]], ['W2', [384, 384]]]);
  assert.match(full.mode, /手动/);
});
test('factorization follows Python normalization, including non-divisors and reversed factors', () => {
  for (const [factor, expected] of [[-1, [64, 96]], [10, [8, 768]], [96, [64, 96]], [6144, [1, 6144]]]) {
    assert.deepEqual(M.factorization(6144, factor), expected);
  }
  assert.deepEqual(M.factorization(2048, 3), [2, 1024]);
});
test('automatic full uses the backend threshold, including equality and non-square matrices', () => {
  assert.match(M.calculate({ input: 6144, output: 6144, rank: 47, kind: 'lokr' }).mode, /rank 47/);
  const auto = M.calculate({ input: 6144, output: 6144, rank: 48, kind: 'lokr' });
  assert.equal(auto.count, 13312); assert.match(auto.mode, /自动/);
  const rectangular = M.calculate({ input: 6144, output: 1536, rank: 32, factor: 3, kind: 'lokr' });
  assert.deepEqual(rectangular.matrices, [['W1', [3, 3]], ['W2a', [512, 32]], ['W2b', [32, 2048]]]);
  assert.equal(rectangular.base, 6144 * 1536);
});
test('LoHa and DoRA/DoKr count all trainable matrices, not alpha/bias', () => {
  const args = { input: 1024, output: 2048, rank: 32 };
  assert.equal(M.calculate({ ...args, kind: 'loha' }).count, 2 * 32 * (1024 + 2048));
  assert.equal(M.calculate({ ...args, dora: true }).count, 32 * (1024 + 2048) + 2048);
  const plain = M.calculate({ ...args, kind: 'lokr', factor: 4, full: true });
  const dokr = M.calculate({ ...args, kind: 'lokr', factor: 4, full: true, dora: true });
  assert.equal(dokr.count, plain.count + 2048); assert.match(dokr.mode, /DoKr/);
});
test('invalid and incomplete settings do not produce a plausible count', () => {
  for (const rank of [NaN, 0, -1, 1.5]) assert.throws(() => M.calculate({ input: 2048, output: 2048, rank }));
  for (const factor of [0, -2, NaN, 2.5]) assert.throws(() => M.calculate({ input: 2048, output: 2048, rank: 32, factor, kind: 'lokr' }));
  assert.equal(M.calculate({ input: 2048, output: 2048, rank: NaN, factor: 4, kind: 'lokr', full: true }).count, 262160);
});
test('advanced Anima settings override global rank/factor and represent disabled samples', () => {
  const args = ['factor=4', 'layer_configs=' + JSON.stringify({ version: 1, mode: 'type', default_rank: 8, default_factor: 3,
    types: { self_attn: { rank: 32, factor: 8 }, mlp: { enabled: false } } })];
  const rows = M.preview({ architecture: 'anima', networkModule: 'networks.lokr', rank: 16, args });
  assert.equal(rows[0].count, 8 * 8 + 2 * 256 * 32);
  assert.equal(rows[1].count, 2 * 2 + (1024 + 512) * 8);
  assert.equal(rows[2].count, 0);
  assert.match(rows[2].mode, /关闭/);
});
test('per-layer Anima settings and legacy per-type rank controls are respected', () => {
  const options = { architecture: 'anima', networkModule: 'networks.lora_anima', rank: 32 };
  assert.equal(M.preview({ ...options, args: ['self_attn_dim=4'] })[0].count, 16384);
  const config = { version: 1, mode: 'layer', default_rank: 16,
    layers: { 'blocks.0.self_attn.q_proj': { rank: 8 } } };
  const rows = M.preview({ ...options, args: ['layer_configs=' + JSON.stringify(config)] });
  assert.equal(rows[0].count, 32768); assert.equal(rows[1].count, 49152);
});
test('Krea2 preview reads actual module-specific args without sharing Anima advanced settings', () => {
  const rows = M.preview({ architecture: 'krea2', networkModule: Krea2.LOKR_MODULE, rank: 32, args: ['factor=3'] });
  assert.equal(rows[0].count, 131081); assert.equal(rows[1].count, 81929);
  assert.throws(() => M.preview({ architecture: 'krea2', networkModule: Krea2.LOKR_MODULE, rank: 32, args: ['factor=3', 'factor=4'] }), /重复/);
});

class Element {
  constructor() {
    this.value = ''; this.children = []; this.textContent = ''; this.hidden = false;
    this.classList = { toggle: (_, value) => { this.hidden = value; } };
  }
  append(node) { this.children.push(node); }
  replaceChildren() { this.children = []; }
}
function ui() {
  const elements = new Map();
  const $ = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const context = { $, Krea2, AdapterMatrix: M, currentArchitecture: 'anima',
    document: { createElement: () => new Element() }, gatherNetworkArgs: () => context.args, args: [] };
  const source = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
  const start = source.indexOf('function updateAdapterMatrixPreview()');
  vm.runInNewContext(source.slice(start, source.indexOf('\nfunction checkDirty()', start)), context);
  $('cfg-network-module').value = 'networks.lora_anima'; $('cfg-network-dim').value = '32'; $('cfg-training-type').value = 'lora';
  return { $, context, update: context.updateAdapterMatrixPreview };
}
test('UI updates shapes/counts after module, rank, factor, full and architecture changes', () => {
  const { $, context, update } = ui();
  const row = () => $('adapter-matrix-rows').children[0].children.map(cell => cell.textContent);
  update(); assert.equal(row()[4], '131,072'); assert.equal(row()[5], '3.1250%');
  $('cfg-network-dim').value = '16'; update(); assert.equal(row()[4], '65,536');
  context.currentArchitecture = 'krea2'; $('cfg-network-module').value = Krea2.LOKR_MODULE;
  $('cfg-network-dim').value = '32'; context.args = ['factor=3']; update();
  assert.equal(row()[1], '6144 × 6144'); assert.equal(row()[4], '131,081');
  context.args = ['factor=16', 'full_matrix=true']; update(); assert.equal(row()[4], '147,712'); assert.match(row()[2], /手动/);
  context.args = ['factor=-1']; $('cfg-network-dim').value = '48'; update(); assert.match(row()[2], /自动/);
  assert.match($('adapter-matrix-description').textContent, /Krea2/);
});
test('UI clears stale counts on errors and hides for full finetuning or other architectures', () => {
  const { $, context, update } = ui(); update();
  $('cfg-network-dim').value = ''; update(); assert.equal($('adapter-matrix-rows').children.length, 0);
  assert.match($('adapter-matrix-error').textContent, /Rank/);
  $('cfg-network-dim').value = '32'; update(); assert.equal($('adapter-matrix-error').textContent, '');
  $('cfg-network-module').value = 'networks.lokr'; $('cfg-lokr-factor').value = '1.5'; update();
  assert.equal($('adapter-matrix-rows').children.length, 0); assert.match($('adapter-matrix-error').textContent, /Factor/);
  $('cfg-training-type').value = 'full_finetune'; update(); assert.equal($('adapter-matrix-preview').hidden, true);
  $('cfg-training-type').value = 'lora'; context.currentArchitecture = 'lumina'; update();
  assert.equal($('adapter-matrix-preview').hidden, true);
});
