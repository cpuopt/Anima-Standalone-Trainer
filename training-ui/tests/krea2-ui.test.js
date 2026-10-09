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
  const context = { Krea2, document: { getElementById: $, body: { classList: { toggle() {} } } },
    Option: function (label, value) { this.value = value; }, LayerRank: { tokenize: () => [] } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/krea2-ui.js'), 'utf8') + ';globalThis.ui = KreaUI;', context);
  context.ui.beforePopulate(saved);
  $('krea2-attention').value = 'sdpa'; $('krea2-fp8').checked = true;
  $('cfg-timestep-method').value = 'krea2_shift'; $('cfg-flow-shift').value = '2.5';
  $('cfg-vae-batch').value = '1'; $('krea2-te-batch').value = '1';
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
