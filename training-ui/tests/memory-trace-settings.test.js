const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const TOML = require('@iarna/toml');
const { memoryTraceUpdateError: validate } = require('../lib/memory-trace-settings');
const config = values => ({ training_arguments: values });

test('new jobs default recording off and idle jobs can opt in', () => {
    const template = TOML.parse(fs.readFileSync(path.join(__dirname, '../templates/config_template.toml'), 'utf8'));
    assert.equal(template.training_arguments.memory_trace, false);
    assert.equal(validate({}, config({ memory_trace: true }), false), null);
    assert.equal(validate(config({memory_trace:true}), config({memory_trace:false}), false), null);
});
test('running jobs cannot change or remove recording settings; unrelated edits still work', () => {
    assert.match(validate({}, config({ memory_trace: true }), true), /停止任务/);
    assert.match(validate(config({memory_trace:true}), {}, true), /停止任务/);
    assert.match(validate({}, config({memory_trace_sync:true}), true), /停止任务/);
    assert.match(validate({}, config({memory_trace_every_n_steps:1}), true), /停止任务/);
    assert.equal(validate(config({memory_trace:true}), config({memory_trace:true,learning_rate:0.0001}), true), null);
    assert.equal(validate({}, config({learning_rate:0.0001}), true), null);
});
test('invalid recording values are rejected', () => {
    assert.match(validate({}, config({memory_trace:'false'}), false), /Invalid/);
    assert.match(validate({}, config({memory_trace_every_n_steps:0}), false), /Invalid/);
});
