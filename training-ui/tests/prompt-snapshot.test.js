const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
    RUNNING_PROMPTS_FILENAME,
    snapshotSamplePrompts,
} = require('../lib/prompt-snapshot');

test('training prompt snapshot is not changed by later UI saves', (t) => {
    const jobPath = fs.mkdtempSync(path.join(os.tmpdir(), 'anima-prompts-'));
    t.after(() => fs.rmSync(jobPath, { recursive: true, force: true }));

    const editablePath = path.join(jobPath, 'sample_prompts.txt');
    fs.writeFileSync(editablePath, 'initial prompt\n', 'utf8');
    const config = { sample_arguments: { sample_every_n_epochs: 1 } };

    const snapshotPath = snapshotSamplePrompts(jobPath, config);
    fs.writeFileSync(editablePath, 'prompt saved during training\n', 'utf8');

    assert.equal(snapshotPath, path.join(jobPath, RUNNING_PROMPTS_FILENAME));
    assert.equal(config.sample_arguments.sample_prompts, snapshotPath);
    assert.equal(fs.readFileSync(snapshotPath, 'utf8'), 'initial prompt\n');
    assert.equal(fs.readFileSync(editablePath, 'utf8'), 'prompt saved during training\n');
});

test('missing prompt file leaves the training config unchanged', (t) => {
    const jobPath = fs.mkdtempSync(path.join(os.tmpdir(), 'anima-prompts-'));
    t.after(() => fs.rmSync(jobPath, { recursive: true, force: true }));
    const config = {};

    assert.equal(snapshotSamplePrompts(jobPath, config), null);
    assert.deepEqual(config, {});
});
