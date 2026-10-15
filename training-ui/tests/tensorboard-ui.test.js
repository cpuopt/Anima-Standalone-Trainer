const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('iframe and open link resolve relative TensorBoard URLs against the HTTPS WebUI without reload loops', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
  const update = source.slice(source.indexOf('function updateTbState('), source.indexOf('async function launchTensorBoard('));
  const nodes = new Map(); let src = '', writes = 0;
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, { classList: { toggle() {}, add() {}, remove() {} }, style: {} });
    return nodes.get(id);
  };
  Object.defineProperty(get('tb-iframe'), 'src', { get: () => src, set: value => { src = value; writes++; } });
  const context = { $: get, URL, window: { location: { href: 'https://training.example.com/' } } };
  vm.runInNewContext('let tbUrl; ' + update + '; getUrl = () => tbUrl;', context);
  context.updateTbState(true, '/tensorboard/test/');
  assert.equal(src, 'https://training.example.com/tensorboard/test/');
  assert.equal(context.getUrl(), src); assert.equal(get('tb-status').textContent, 'Running');
  context.updateTbState(true, '/tensorboard/test/'); assert.equal(writes, 1);
  context.updateTbState(false, null); assert.equal(src, ''); assert.equal(context.getUrl(), null);
});
