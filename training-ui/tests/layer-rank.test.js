const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const TOML = require('@iarna/toml');
const L = require('../public/js/layer-rank');
const {readAnimaLayers, validateLayerArgs} = require('../lib/anima-layers');

function fixture(count, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anima-layers-'));
  try {
    const header = {};
    for (let i = 0; i < count; i++) for (const key of ['self_attn.q_proj', 'cross_attn.k_proj', 'mlp.layer1', 'adaln_modulation_mlp.1']) {
      header[`net.blocks.${i}.${key}.weight`] = {shape: [64, 64], dtype: 'F32', data_offsets: [0, 0]};
    }
    header['net.llm_adapter.blocks.0.self_attn.q_proj.weight'] = {shape: [64, 64]};
    header['net.blocks.0.self_attn.q_norm.weight'] = {shape: [64]};
    const json = Buffer.from(JSON.stringify(header)); const size = Buffer.alloc(8); size.writeBigUInt64LE(BigInt(json.length));
    const file = path.join(dir, 'model.safetensors'); fs.writeFileSync(file, Buffer.concat([size, json]));
    run(file);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
}

test('read actual block layers from header, exclude adapter and normalization', () => {
  for (const count of [20, 28, 36]) fixture(count, file => {
    const found = readAnimaLayers(file); assert.equal(found.block_count, count); assert.equal(found.layers.length, count * 4);
  });
  assert.throws(() => readAnimaLayers('missing.safetensors'));
  fixture(1, file => { fs.writeFileSync(file, 'broken'); assert.throws(() => readAnimaLayers(file)); });
});
test('mode isolation, defaults, alpha override and TOML roundtrip', () => {
  const config = L.create(16, 4);
  assert.deepEqual(L.resolve(config, 'mlp', true), {rank: 16, alpha: 16, enabled: true, factor: 4});
  config.types = {mlp: {rank: 8, alpha: 3, enabled: false, factor: 2}};
  config.layers = {'blocks.0.self_attn.q_proj': {rank: 4, alpha: 2, factor: 8}};
  let saved = L.compact(config, true); assert.ok(!saved.layers); assert.equal(saved.types.mlp.enabled, false);
  config.mode = 'layer'; saved = L.compact(config, true); assert.ok(!saved.types);
  assert.equal(L.resolve(saved, 'blocks.0.mlp.layer1').rank, 16);
  assert.equal(L.resolve(saved, 'blocks.0.self_attn.q_proj').alpha, 2);
  const args = [`layer_configs=${JSON.stringify(saved)}`];
  const decoded = TOML.parse(TOML.stringify({network_arguments: {network_args: args}}));
  assert.deepEqual(decoded.network_arguments.network_args, args);
  assert.deepEqual(L.tokenize(`factor=4 layer_configs=${JSON.stringify(saved, null, 1)} use_dora=true`), ['factor=4', `layer_configs=${JSON.stringify(saved, null, 1)}`, 'use_dora=true']);
  const nonLokr = L.compact(config, false); assert.ok(!('factor' in nonLokr.layers['blocks.0.self_attn.q_proj']));
});
test('reject empty ranks, invalid factors and unknown layers when saving', () => fixture(1, file => {
  const config = L.create(8); config.mode = 'layer';
  validateLayerArgs({network_arguments: {network_module: 'networks.lokr', network_args: [`layer_configs=${JSON.stringify(config)}`]}}, file);
  for (const entry of [{rank: null}, {rank: 0}, {alpha: 0}, {factor: 0}]) {
    config.layers = {'blocks.0.self_attn.q_proj': entry};
    assert.throws(() => validateLayerArgs({network_arguments: {network_module: 'networks.lokr', network_args: [`layer_configs=${JSON.stringify(config)}`]}}, file));
  }
  config.layers = {'blocks.9.self_attn.q_proj': {rank: 4}};
  assert.throws(() => L.validate(config, readAnimaLayers(file).layers));
}));
