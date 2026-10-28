const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const backend = require('../lib/krea2-backend');
const { tensorboardPath } = require('../lib/tensorboard-proxy');

// Exercise the registered HTTP handler without starting the UI or real processes.
function fixture(architecture) {
  const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const section = source.slice(source.indexOf('// --- TensorBoard API ---'), source.indexOf("app.get('/api/jobs/:name/tensorboard/status'"));
  const job = path.resolve('test-job'), folders = new Set(), children = [], killed = [];
  let handler;
  function child(args, shell = false) {
    const p = new EventEmitter(); p.stderr = new EventEmitter(); p.pid = children.length + 100;
    children.push({ p, args, shell }); return p;
  }
  vm.runInNewContext(section, {
    app: { post: (_url, fn) => { handler = fn; } }, path, ROOT_DIR: '.', isWindows: process.platform === 'win32',
    sanitizeName: x => x, getJobPath: () => job,
    fs: { existsSync: p => folders.has(p), mkdirSync: p => folders.add(p), readFileSync: () => JSON.stringify({ architecture }) },
    TOML: { parse: JSON.parse }, getArchForJob: c => ({ id: c.architecture }), getGlobalConfig: () => ({}),
    toNativePath: x => x, getVenvPaths: () => ({ activate: 'activate' }),
    animaLuminaEnvironmentPath: require('../lib/anima-lumina-env').environmentPath,
    kreaBackend: { tensorboardLogDir: backend.tensorboardLogDir, runtime: () => ({ python: 'krea-python' }) },
    buildShellScript: (_activate, _cwd, cmd) => cmd, spawnShell: cmd => child(cmd, true),
    spawn: (_python, args) => child(args), killProcess: async pid => { killed.push(pid); },
    tensorboardPath, waitForTensorboard: async () => {},
    console: { log() {} }
  });
  return { job, folders, children, killed, async open() {
    let body, status = 200;
    await handler({ params: { name: 'test-job' } }, { json: x => { body = x; }, status: n => { status = n; return { json: x => { body = x; } }; } });
    assert.equal(status, 200, body?.error); return body;
  } };
}
test('Krea TensorBoard reads output/tensorboard and reuses the correct server', async () => {
  const f = fixture('krea2'), logs = backend.tensorboardLogDir(f.job); f.folders.add(logs);
  const first = await f.open(), second = await f.open();
  assert.equal(first.url, second.url); assert.equal(f.children.length, 1);
  assert.equal(first.url, tensorboardPath('test-job') + '/');
  const args = f.children[0].args;
  assert.equal(args[args.indexOf('--logdir') + 1], logs);
  assert.equal(args[args.indexOf('--path_prefix') + 1], tensorboardPath('test-job'));
  assert.equal(args[args.indexOf('--host') + 1], '127.0.0.1');
});
test('legacy Krea TensorBoard switches directories after training without stale close deleting the new process', async () => {
  const f = fixture('krea2'); await f.open();
  assert.ok(f.children[0].args.includes(path.join(f.job, 'logs')));
  f.folders.add(backend.tensorboardLogDir(f.job));
  const updated = await f.open(); assert.equal(f.killed[0], f.children[0].p.pid);
  f.children[0].p.emit('close', 0);
  assert.equal((await f.open()).url, updated.url); assert.equal(f.children.length, 2);
});
test('Anima TensorBoard retains its logs directory and environment launch', async () => {
  const f = fixture('anima'); f.folders.add(backend.tensorboardLogDir(f.job));
  await f.open();
  assert.equal(f.children[0].shell, true);
  assert.ok(f.children[0].args.includes(path.join(f.job, 'logs')));
  assert.ok(f.children[0].args.includes('--host=127.0.0.1'));
  assert.ok(f.children[0].args.includes('--path_prefix=' + tensorboardPath('test-job')));
});
