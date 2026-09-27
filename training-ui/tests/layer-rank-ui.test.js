const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const LayerRank = require('../public/js/layer-rank');

// Exercise the real controller with DOM primitives, without a browser or server.
class Element {
  constructor() {
    this.children = []; this.events = {}; this.value = ''; this.checked = false;
    this.classList = {toggle() {}, remove() {}};
  }
  addEventListener(type, fn) { this.events[type] = fn; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren() { this.children = []; }
  setAttribute(key, value) { this[key] = value; }
  fire(type) { return this.events[type]?.(); }
}
function setup() {
  const elements = new Map();
  const $ = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  $('cfg-network-module').value = 'networks.lokr'; $('cfg-training-type').value = 'lora';
  $('cfg-network-dim').value = '16'; $('cfg-lokr-factor').value = '4';
  const radios = [new Element(), new Element()]; radios[0].value = 'type'; radios[1].value = 'layer';
  const names = ['blocks.0.self_attn.q_proj', 'blocks.0.cross_attn.k_proj', 'blocks.1.mlp.layer1'];
  let failure = false;
  const context = {LayerRank, window: {}, checkDirty() {}, document: {
    getElementById: $, querySelectorAll: () => radios, createElement: () => new Element(),
  }, fetch: async () => ({ok: !failure, json: async () => failure ? {error: '模型不可读取'} : {layers: names, block_count: 2}})};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/layer-rank-ui.js'), 'utf8'), context);
  const all = node => [node, ...node.children.filter(n => typeof n === 'object').flatMap(all)];
  const field = name => all($('layer-rank-rows')).find(el => el['aria-label'] === name);
  return {$, radios, field, ui: context.window.LayerRankUI, fail: () => { failure = true; }};
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('advanced toggle, auto alpha, independent alpha, modes and reload', async () => {
  const {$, radios, field, ui} = setup();
  $('cfg-layer-advanced').checked = true; $('cfg-layer-advanced').fire('change'); await tick();
  assert.equal($('cfg-network-dim').disabled, true);
  assert.equal(field('self_attn rank').value, 16); assert.equal(field('self_attn factor').value, 4);
  field('self_attn rank').value = '8'; field('self_attn rank').fire('input');
  assert.equal(field('self_attn alpha').value, '8');
  field('self_attn alpha').value = '2'; field('self_attn alpha').fire('input');
  field('self_attn rank').value = '4'; field('self_attn rank').fire('input');
  assert.equal(field('self_attn alpha').value, '2');
  radios[1].fire('change'); assert.equal(radios[1].checked, true); assert.equal(radios[0].checked, false);
  assert.equal(field('blocks.0.self_attn.q_proj rank').value, 16);
  field('blocks.0.self_attn.q_proj factor').value = '2'; field('blocks.0.self_attn.q_proj factor').fire('input');
  const saved = ui.token().slice('layer_configs='.length); ui.load(saved); await tick();
  assert.equal(field('blocks.0.self_attn.q_proj factor').value, 2);
  $('cfg-layer-advanced').checked = false; $('cfg-layer-advanced').fire('change');
  assert.equal(ui.token(), null); assert.equal($('cfg-network-dim').disabled, false);
});
test('full matrix retains factor and training switches; errors prevent save', async () => {
  const {$, field, ui, fail} = setup();
  ui.load(JSON.stringify({version: 1, mode: 'type', default_rank: 16, types: {mlp: {enabled: false}}})); await tick();
  $('cfg-lokr-full-matrix').checked = true; ui.update();
  assert.equal(field('self_attn rank').disabled, true); assert.equal(field('self_attn alpha').disabled, true);
  assert.equal(field('self_attn factor').disabled, false); assert.equal(field('mlp factor').disabled, true);
  await ui.validate();
  fail(); await assert.rejects(ui.validate(), /模型不可读取/);
});
