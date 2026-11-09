const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');
const { environmentPath, pythonAt } = require('./environment-manager');
const { killProcess } = require('./process-killer');
const MODES = ['bf16', 'fp16', 'tf32', 'fp32', 'fp8', 'int8'];

class TensorBenchmark {
  constructor({ root, getConfig, isBusy = () => false, nativePath = x => x, spawnProcess = spawn, kill = killProcess }) {
    Object.assign(this, { root, getConfig, isBusy, nativePath, spawnProcess, kill });
    this.task = null;
    this.child = null;
  }
  busy() { return !!this.child; }
  start(options = {}) {
    if (this.busy() || this.isBusy()) throw Error('请先停止训练、采样或环境操作，并卸载驻留模型');
    const { environment = 'anima-lumina', gpu = 0, sizes = [2048, 4096, 8192], repeats = 5 } = options;
    if (Object.keys(options).some(k => !['environment', 'gpu', 'sizes', 'repeats'].includes(k)) ||
        !Number.isInteger(repeats) || repeats < 1 || repeats > 50 ||
        !['anima-lumina', 'krea2', 'moss'].includes(environment) ||
        !Number.isInteger(gpu) || gpu < 0 || gpu > 63 || !Array.isArray(sizes) ||
        !sizes.length || sizes.length > 3 || new Set(sizes).size !== sizes.length ||
        sizes.some(n => ![2048, 4096, 8192].includes(n))) throw Error('性能测试参数无效');
    const python = pythonAt(environmentPath(this.root, environment, this.getConfig(), this.nativePath));
    if (!fs.existsSync(python)) throw Error('模型 Python 环境未安装，请先在环境管理中安装');
    const task = { status: 'running', started: new Date().toISOString(), environment, gpu, sizes, repeats, modes: [...MODES], results: [] };
    const child = this.spawnProcess(python, ['-u', path.join(__dirname, '../scripts/tensor-benchmark.py'),
      '--gpu', String(gpu), '--sizes', sizes.join(','), '--repeats', String(repeats)], {
      cwd: this.root, shell: false, windowsHide: true, detached: process.platform !== 'win32',
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    this.child = child; this.task = task;
    let buffer = '', stderr = '', settled = false;
    const decoder = new StringDecoder('utf8');
    const finish = (code, error) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      const stopped = task.status === 'stopping';
      task.status = stopped ? 'stopped' : (code === 0 && !task.error && task.results.length === sizes.length * MODES.length ? 'completed' : 'failed');
      if (error || (task.status === 'failed' && !task.error)) task.error = error || stderr || '性能测试进程未返回完整结果';
      task.finished = new Date().toISOString(); delete task.progress;
      this.child = null;
    };
    const timer = setTimeout(() => { task.error = '性能测试超过 5 分钟，已终止'; this.kill(child.pid, 0); }, 300000);
    child.stdout.on('data', chunk => {
      buffer += decoder.write(Buffer.from(chunk));
      if (buffer.length > 128000) { task.error = '性能测试输出超出限制'; this.kill(child.pid, 0); buffer = ''; return; }
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        try {
          const record = JSON.parse(line);
          if (record.type === 'metadata') task.metadata = record;
          if (record.type === 'progress') task.progress = record;
          if (record.type === 'result' && task.results.length < sizes.length * MODES.length) task.results.push(record);
          if (record.type === 'error') task.error = record.error;
        } catch { /* Torch extensions may print diagnostics on stdout. */ }
      }
    });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-8000); });
    child.once('error', error => finish(1, error.message));
    child.once('close', code => finish(code));
    return task;
  }
  async stop() {
    if (this.child) { this.task.status = 'stopping'; await this.kill(this.child.pid, 0); }
    return this.task;
  }
  mount(app) {
    app.get('/api/benchmarks/tensor', (req, res) => res.json({ task: this.task, busy: this.busy(), blocked: !!this.isBusy() }));
    app.post('/api/benchmarks/tensor', (req, res) => {
      try { res.json(this.start(req.body || {})); }
      catch (error) { res.status(400).json({ error: error.message }); }
    });
    app.post('/api/benchmarks/tensor/stop', async (req, res) => {
      try { res.json(await this.stop()); } catch (error) { res.status(500).json({ error: error.message }); }
    });
  }
}
module.exports = { TensorBenchmark };
