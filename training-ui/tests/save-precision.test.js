const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const TOML = require('@iarna/toml');

// Exercise the actual config builders without starting the UI server.
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
function loadFunction(name, globals) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0);
    const end = source.indexOf('\n}', start) + 2;
    return vm.runInNewContext(`(${source.slice(start, end)})`, globals);
}

test('Anima template and emergency defaults explicitly save bf16', () => {
    const template = TOML.parse(fs.readFileSync(path.join(root, 'templates/config_template.toml'), 'utf8'));
    assert.equal(template.training_arguments.save_precision, 'bf16');
    const fallback = loadFunction('getDefaultConfig', {
        path, TOML, TEMPLATES_DIR: '/missing', fs: { existsSync: () => false },
    })();
    assert.equal(fallback.config.training_arguments.save_precision, 'bf16');
});

test('training TOML uses the displayed bf16 default and preserves explicit precision', t => {
    const jobPath = fs.mkdtempSync(path.join(os.tmpdir(), 'anima-save-precision-'));
    t.after(() => fs.rmSync(jobPath, { recursive: true, force: true }));
    const build = loadFunction('buildTrainingConfig', {
        fs, path, TOML,
        getGlobalConfig: () => ({}), validateLayerArgs: () => {},
        getArchForJob: () => ({ id: 'anima' }), buildModelArgs: () => ({}),
        normalizeLogLanguage: () => 'en',
    });
    for (const precision of [undefined, 'bf16', 'fp16', 'float']) {
        const training = { mixed_precision: 'bf16' };
        if (precision !== undefined) training.save_precision = precision;
        const config = TOML.stringify({ training_arguments: training, network_arguments: { network_module: 'networks.lora_anima' } });
        fs.writeFileSync(path.join(jobPath, 'config.toml'), config);
        const merged = TOML.parse(TOML.stringify(build('test', jobPath)));
        assert.equal(merged.training_arguments.save_precision, precision ?? 'bf16');
        assert.equal(fs.readFileSync(path.join(jobPath, 'config.toml'), 'utf8'), config);
    }
});
