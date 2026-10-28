const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { environmentPath } = require('../lib/anima-lumina-env');

test('Anima/Lumina defaults to its dedicated sibling environment', () => {
  assert.equal(environmentPath('/project'), path.join('/project', 'venv-anima-lumina'));
  assert.equal(environmentPath('/project', { venv_path: '' }), path.join('/project', 'venv-anima-lumina'));
});
test('explicit new path wins; legacy explicit paths and native conversion remain supported', () => {
  assert.equal(environmentPath('/project', { venv_path: '/old' }), '/old');
  assert.equal(environmentPath('/project', { venv_path: '/old', anima_lumina_venv_path: '/new' }, p => `native:${p}`), 'native:/new');
});
