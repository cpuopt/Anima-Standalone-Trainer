const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { countDatasetImages } = require('../lib/dataset-images');

test('counts supported dataset images in the top-level directory only', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'anima-dataset-images-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'one.png'), '');
  fs.writeFileSync(path.join(directory, 'two.JPEG'), '');
  fs.writeFileSync(path.join(directory, 'caption.txt'), '');
  fs.mkdirSync(path.join(directory, 'nested'));
  fs.writeFileSync(path.join(directory, 'nested', 'ignored.webp'), '');

  assert.deepEqual(countDatasetImages(directory), { count: 2, exists: true, readable: true });
});

test('reports missing and non-directory paths without throwing', () => {
  assert.deepEqual(countDatasetImages(''), { count: 0, exists: false, readable: true });
  assert.deepEqual(countDatasetImages(path.join(os.tmpdir(), 'missing-anima-dataset-directory')), {
    count: 0,
    exists: false,
    readable: true,
  });
});
