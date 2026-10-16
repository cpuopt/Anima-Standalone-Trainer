const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const Krea2 = require('../public/js/krea2');

function setup(saved) {
  const elements = new Map();
  const $ = id => {
    if (!elements.has(id)) elements.set(id, { value: '', checked: false, innerHTML: '', children: [],
      classList: { toggle() {} }, setAttribute() {}, replaceChildren() {}, closest() { return null; } });
    return elements.get(id);
  };
  const context = { Krea2, document: { getElementById: $, querySelectorAll: () => [], body: { classList: { toggle() {} } } },
    Option: function (label, value) { this.value = value; }, LayerRank: { tokenize: text => text ? text.split(' ') : [] },
    localStorage: { getItem: () => null }, currentJob: 'test' };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/krea2-ui.js'), 'utf8') + ';globalThis.ui = KreaUI;', context);
  context.ui.beforePopulate(saved);
  $('cfg-network-module').value = saved.network_arguments.network_module;
  $('krea2-attention').value = 'sdpa'; $('krea2-fp8').checked = true;
  $('cfg-timestep-method').value = 'krea2_shift'; $('cfg-flow-shift').value = '2.5';
  $('cfg-vae-batch').value = '1'; $('krea2-te-batch').value = '1';
  context.ui.$ = $;
  return context.ui;
}

test('reopened Adafactor task can switch to either AdamW without passing Adafactor kwargs', () => {
  const saved = Krea2.defaults(); saved.training_arguments.optimizer_type = 'Adafactor';
  saved.training_arguments.optimizer_args = ['weight_decay=0.01', 'relative_step=False', 'scale_parameter=False', 'clip_threshold=0.5'];
  const ui = setup(saved);
  for (const optimizer of ['AdamW', 'AdamW8bit']) {
    const raw = Krea2.defaults(); raw.training_arguments.optimizer_type = optimizer;
    const config = ui.config(raw);
    assert.deepEqual(Array.from(config.training_arguments.optimizer_args), ['weight_decay=0.01']);
    assert.doesNotThrow(() => Krea2.validate(config));
  }
  const raw = Krea2.defaults(); raw.training_arguments.optimizer_type = 'Adafactor';
  assert.deepEqual(Array.from(ui.config(raw).training_arguments.optimizer_args), saved.training_arguments.optimizer_args);
});

test('LoKR controls round-trip and switching modules isolates LoRA+ and Kronecker options', () => {
  const saved = Krea2.defaults(); saved.network_arguments.network_module = Krea2.LOKR_MODULE;
  saved.network_arguments.network_args = ['factor=8','full_matrix=true','rank_dropout=0.1','module_dropout=0.2'];
  const ui = setup(saved), $ = ui.$;
  ui.populate(saved);
  assert.equal($('krea2-lokr-factor').value, '8');
  assert.equal($('krea2-lokr-full-matrix').checked, true);
  assert.equal($('cfg-network-dim').disabled, true);
  $('krea2-loraplus').value = '16';
  const config = ui.config(saved);
  assert.equal(config.network_arguments.network_module, Krea2.LOKR_MODULE);
  assert.deepEqual(Array.from(config.network_arguments.network_args).sort(), saved.network_arguments.network_args.sort());
  assert.doesNotThrow(() => Krea2.validate(config));
  $('cfg-network-module').value = Krea2.MODULE;
  ui.updateNetworkControls(); assert.equal($('cfg-network-dim').disabled, false);
  const lora = ui.config(saved); assert.ok(!lora.network_arguments.network_args.some(x => /^(factor|full_matrix)=/.test(x)));
  assert.ok(lora.network_arguments.network_args.includes('loraplus_lr_ratio=16'));
  assert.doesNotThrow(() => Krea2.validate(lora));
});

test('optimizer extras survive same-optimizer edits and stay isolated after switching', () => {
  const saved = Krea2.defaults(); saved.training_arguments.optimizer_type = 'AdamW';
  saved.training_arguments.optimizer_args = ['weight_decay=0.01', 'betas=(0.9,0.95)', 'eps=1e-6'];
  const ui = setup(saved), raw = Krea2.defaults();
  raw.training_arguments.optimizer_type = 'AdamW';
  assert.deepEqual(Array.from(ui.config(raw).training_arguments.optimizer_args), saved.training_arguments.optimizer_args);
  raw.training_arguments.optimizer_type = 'Adafactor';
  const config = ui.config(raw);
  assert.deepEqual(Array.from(config.training_arguments.optimizer_args), ['weight_decay=0.01', 'relative_step=False', 'scale_parameter=False']);
  assert.doesNotThrow(() => Krea2.validate(config));
});
