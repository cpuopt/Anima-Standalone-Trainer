const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { StringDecoder } = require('node:string_decoder');
const { spawn } = require('node:child_process');
const TOML = require('@iarna/toml');
const { killProcess } = require('./process-killer');

const DEFINITIONS = {
  main: { label: '主环境（轻量控制）', key: 'main_venv_path', directory: 'venv' },
  'anima-lumina': { label: 'Anima / Lumina', key: 'anima_lumina_venv_path', directory: 'venv-anima-lumina' },
  krea2: { label: 'Krea 2', key: 'krea2_venv_path', directory: 'venv-krea2' },
  moss: { label: 'MOSS-Image', key: 'moss_venv_path', directory: 'venv-moss' },
};
function pythonAt(directory, platform = process.platform) {
  return path.join(directory, platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
}
function environmentPath(root, id, config = {}, native = x => x) {
  const def = DEFINITIONS[id];
  if (!Object.hasOwn(DEFINITIONS, id)) throw Error('Unknown environment');
  const value = config[def.key] || (id === 'anima-lumina' ? config.venv_path : '');
  return native(value || path.join(root, def.directory));
}
function atomicJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2)); fs.renameSync(tmp, file);
}
function localRequest(req) {
  const ip = req.socket?.remoteAddress;
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)) return false;
  try {
    const host = new URL(`http://${req.headers.host}`);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host.hostname)) return false;
    if (req.headers.origin) {
      const origin = new URL(req.headers.origin);
      if (!['http:', 'https:'].includes(origin.protocol) || origin.host !== host.host) return false;
    }
    return true;
  } catch { return false; }
}

class EnvironmentManager {
  constructor({ root, getConfig, isBusy = () => false, spawnProcess = spawn, kill = killProcess }) {
    Object.assign(this, { root, getConfig, isBusy, spawnProcess, kill });
    this.base = path.join(root, '.runtime'); this.tasksDir = path.join(this.base, 'environment-tasks');
    this.tasks = new Map(); this.children = new Map(); this.current = null;
    fs.mkdirSync(this.tasksDir, { recursive: true });
    for (const file of fs.readdirSync(this.tasksDir).filter(f => f.endsWith('.json'))) {
      try {
        const task = JSON.parse(fs.readFileSync(path.join(this.tasksDir, file), 'utf8'));
        if (['running', 'stopping', 'queued'].includes(task.status)) {
          task.status = 'interrupted'; task.error = 'UI service restarted; installation outcome was not committed';
          this.save(task);
        }
        this.tasks.set(task.id, task);
      } catch { /* Leave corrupt records for inspection, never execute them. */ }
    }
    this.tasks = new Map([...this.tasks.entries()].sort((a, b) => a[1].started - b[1].started));
  }
  save(task) { atomicJSON(path.join(this.tasksDir, `${task.id}.json`), task); }
  externalBusy() {
    try {
      const active = JSON.parse(fs.readFileSync(path.join(this.base, 'environment-active.json'), 'utf8'));
      process.kill(active.pid, 0); return true;
    } catch { return false; }
  }
  installing() { return !!this.current || this.externalBusy(); }
  append(task, text) {
    const file = path.join(this.tasksDir, `${task.id}.log`);
    // Bound persisted log size. Continue draining subprocess pipes even after the cap.
    if ((task.logBytes || 0) > 20 * 1024 * 1024) return;
    const value = String(text).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
    try {
      fs.appendFileSync(file, value); task.logBytes = (task.logBytes || 0) + Buffer.byteLength(value);
    } catch (err) { task.logError = err.message; }
  }
  list() {
    const cfg = this.getConfig(); let state = { active: {}, history: [] };
    try { state = JSON.parse(fs.readFileSync(path.join(this.base, 'environment-state.json'), 'utf8')); } catch {}
    return { environments: Object.entries(DEFINITIONS).map(([id, def]) => {
      const directory = environmentPath(this.root, id, cfg);
      const report = [...this.tasks.values()].reverse().find(t => t.environment === id && t.report?.path === directory)?.report;
      const cached = state.active?.[id];
      const installed = fs.existsSync(pythonAt(directory));
      return { id, label: def.label, path: directory, installed, status: installed ? 'unchecked' : 'missing',
        ...(installed ? (report || (cached?.path === directory ? cached : {})) : {}) };
    }), task: this.current || [...this.tasks.values()].at(-1) || null,
    busy: this.installing(), trainingBusy: this.isBusy(),
    history: (state.history || []).filter(h => !h.deleted), cache: path.join(this.base, 'uv-cache') };
  }
  task(id, after = 0) {
    const task = this.tasks.get(id); if (!task) throw Error('Task not found');
    const file = path.join(this.tasksDir, `${id}.log`);
    const log = fs.existsSync(file) ? fs.readFileSync(file) : Buffer.alloc(0);
    const offset = Math.max(0, Math.min(Number.isSafeInteger(after) ? after : 0, log.length));
    const end = Math.min(offset + 256 * 1024, log.length);
    // Byte cursor is stable across refreshes; TextDecoder on the client handles partial UTF-8.
    return { ...task, output: log.subarray(offset, end).toString('base64'), cursor: end, hasMore: end < log.length };
  }
  async run(task, command, args, timeout = 0) {
    return new Promise((resolve, reject) => {
      const child = this.spawnProcess(command, args, { cwd: this.root, shell: false,
        env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', ENVIRONMENT_PARENT_PID: String(process.pid), UV_CACHE_DIR: path.join(this.base, 'uv-cache') },
        windowsHide: true, detached: process.platform !== 'win32' });
      this.children.set(task.id, child); task.pid = child.pid; this.save(task);
      const outDecoder = new StringDecoder('utf8'), errDecoder = new StringDecoder('utf8');
      child.stdout?.on('data', b => this.append(task, outDecoder.write(b)));
      child.stderr?.on('data', b => this.append(task, errDecoder.write(b)));
      let timer;
      if (timeout) timer = setTimeout(() => { task.timedOut = true; this.kill(child.pid, 0); }, timeout);
      child.once('error', err => { clearTimeout(timer); this.children.delete(task.id); reject(err); });
      child.once('close', code => {
        this.append(task, outDecoder.end() + errDecoder.end());
        clearTimeout(timer); this.children.delete(task.id);
        if (task.cancelled) reject(Error('Installation stopped by user'));
        else if (task.timedOut) reject(Error('Environment check timed out'));
        else if (code !== 0) reject(Error(`Process exited with code ${code}; see installation log`));
        else resolve();
      });
    });
  }
  start(id, action, body = {}) {
    if (!Object.hasOwn(DEFINITIONS, id) || !['check', 'install'].includes(action)) throw Error('Unknown environment or action');
    if (Object.keys(body).some(k => k !== 'cuda')) throw Error('Unsupported request field');
    const cuda = body.cuda || 'cu128';
    if (!(id === 'krea2' ? ['cu124', 'cu128', 'cu130', 'cu132'] : ['cu128']).includes(cuda)) throw Error('Unsupported CUDA profile');
    if (this.installing()) throw Object.assign(Error('An environment operation is already running'), { status: 409 });
    if (action === 'install' && this.isBusy()) throw Object.assign(Error('Stop training, generation and TensorBoard; unload persistent models first'), { status: 409 });
    const main = pythonAt(environmentPath(this.root, 'main', this.getConfig()));
    if (!fs.existsSync(main)) throw Error('Run setup_env first to install the lightweight main environment');
    const task = { id: crypto.randomUUID(), environment: id, action, cuda, status: 'running', started: Date.now() };
    this.append(task, `Starting ${action}: ${id} (${cuda})\n`);
    this.save(task); this.tasks.set(task.id, task); this.current = task;
    // Reserve ownership synchronously before returning the task ID.
    this.execute(task, main).catch(() => {});
    return task;
  }
  async execute(task, main) {
    const reportFile = path.join(this.tasksDir, `${task.id}.result`);
    const script = path.join(this.root, 'scripts/environment_manager.py');
    const args = ['-u', script, task.action, task.environment, '--cuda', task.cuda, '--report', reportFile];
    if (task.action === 'install') args.push('--no-activate');
    try {
      await this.run(task, main, args, task.action === 'check' ? 150000 : 0);
      const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
      if (task.cancelled) throw Error('Stopped before activation');
      if (task.action === 'install') {
        // Commit is a short, synchronous Node operation after verification. No cancellation
        // can interleave between the final check and configuration switch.
        this.activate(task.environment, report);
      }
      task.report = report; task.status = report.dependencies ? 'completed' : 'failed';
      if (!report.dependencies) task.error = (report.errors || []).join('\n');
    } catch (err) {
      task.status = task.cancelled ? 'stopped' : 'failed'; task.error = err.message;
      this.append(task, `\n${task.status}: ${err.message}\n`);
    } finally {
      task.finished = Date.now(); delete task.pid;
      if (this.current?.id === task.id) this.current = null;
      try { this.save(task); } catch (err) { task.persistenceError = err.message; }
    }
  }
  activate(id, report) {
    if (!report.dependencies || report.id !== id) throw Error('Candidate did not pass validation');
    const cfg = this.getConfig();
    const old = environmentPath(this.root, id, cfg);
    const stateFile = path.join(this.base, 'environment-state.json');
    let state = { active: {}, history: [] };
    if (fs.existsSync(stateFile)) state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (old !== report.path && fs.existsSync(path.join(old, 'pyvenv.cfg')) && !state.history.some(h => h.path === old)) {
      state.history.push({ id, path: old, recorded: Date.now(), versions: state.active[id]?.versions || {} });
    }
    state.active[id] = report; atomicJSON(stateFile, state);
    cfg[DEFINITIONS[id].key] = report.path;
    const file = path.join(this.root, 'training-ui/global_config.toml');
    const tmp = `${file}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(tmp, TOML.stringify(cfg)); fs.renameSync(tmp, file);
  }
  async stop(id) {
    const task = this.tasks.get(id); if (!task) throw Error('Task not found');
    if (this.current?.id !== id) return task;
    task.cancelled = true; task.status = 'stopping'; this.save(task);
    const child = this.children.get(id); if (child) await this.kill(child.pid, 1000);
    return task;
  }
  cleanup(directory, confirmed) {
    if (!confirmed || this.installing() || this.isBusy()) throw Error('Confirmation required; stop all operations first');
    const file = path.join(this.base, 'environment-state.json');
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    const item = state.history.find(h => h.path === directory && !h.deleted);
    if (!item) throw Error('Not a registered migration backup');
    const target = path.resolve(directory), relative = path.relative(this.root, target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(path.join(target, 'pyvenv.cfg'))) throw Error('Unsafe cleanup target');
    for (let check = target; check !== this.root; check = path.dirname(check)) {
      if (fs.lstatSync(check).isSymbolicLink()) throw Error('Symlink cleanup is not supported');
    }
    const cfg = this.getConfig();
    const canonical = value => {
      let resolved = fs.existsSync(value) ? fs.realpathSync(value) : path.resolve(value);
      return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    };
    const normalized = canonical(target);
    if (Object.keys(DEFINITIONS).some(id => {
      const active = canonical(environmentPath(this.root, id, cfg));
      return active === normalized || active.startsWith(normalized + path.sep);
    })) throw Error('Environment is still active');
    fs.rmSync(target, { recursive: true }); item.deleted = Date.now(); atomicJSON(file, state);
  }
  mount(app) {
    const secure = (req, res, next) => localRequest(req) ? next() : res.status(403).json({ error: 'Environment management is available from localhost only' });
    app.use(['/api/environments', '/api/environment-tasks'], secure);
    const route = fn => async (req, res) => { try { await fn(req, res); } catch (e) { res.status(e.status || 400).json({ error: e.message }); } };
    app.get('/api/environments', route((req, res) => res.json(this.list())));
    app.post('/api/environments/cleanup', route((req, res) => { this.cleanup(req.body?.path, req.body?.confirm === true); res.json({ success: true }); }));
    for (const action of ['check', 'install']) app.post(`/api/environments/:id/${action}`, route((req, res) => res.status(202).json(this.start(req.params.id, action, req.body || {}))));
    app.get('/api/environment-tasks/:id', route((req, res) => res.json(this.task(req.params.id, Number(req.query.after || 0)))));
    app.post('/api/environment-tasks/:id/stop', route(async (req, res) => res.json(await this.stop(req.params.id))));
    app.get('/api/environment-tasks/:id/log', route((req, res) => {
      if (!this.tasks.has(req.params.id)) throw Error('Task not found');
      res.type('text/plain').attachment(`environment-${req.params.id}.log`).sendFile(path.join(this.tasksDir, `${req.params.id}.log`));
    }));
  }
}
module.exports = { EnvironmentManager, DEFINITIONS, environmentPath, pythonAt, localRequest };
