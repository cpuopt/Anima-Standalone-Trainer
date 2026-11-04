const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { TensorBenchmark } = require('../lib/tensor-benchmark');
const { pythonAt } = require('../lib/environment-manager');

function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tensor-benchmark-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const python = pythonAt(path.join(root, 'venv-anima-lumina'));
  fs.mkdirSync(path.dirname(python), { recursive: true }); fs.writeFileSync(python, '');
  const children = [], killed = [];
  const manager = new TensorBenchmark({ root, getConfig: () => ({}),
    spawnProcess: (command, args, opts) => {
      const child = Object.assign(new EventEmitter(), { pid: 123456, stdout: new EventEmitter(), stderr: new EventEmitter() });
      children.push({ child, command, args, opts }); return child;
    }, kill: async pid => { killed.push(pid); }, ...options });
  t.after(() => children.forEach(({child}) => child.emit('close', 1)));
  return { manager, children, killed, python };
}
test('validates inputs and locks against GPU/environment contention', t => {
  const f = fixture(t);
  for (const options of [{gpu:-1}, {gpu:'0'}, {environment:'main'}, {sizes:[123]}, {sizes:[]}, {sizes:[2048,2048]}, {command:'x'}, ...[0,-1,51,1.5,'5',null].map(repeats=>({repeats}))]) {
    assert.throws(() => f.manager.start(options), /参数无效/);
  }
  f.manager.start({sizes:[2048]});
  assert.throws(() => f.manager.start(), /请先停止/);
  assert.equal(f.children[0].command, f.python);
  assert.equal(f.children[0].opts.shell, false);
  assert.equal(f.children[0].opts.windowsHide, true);
  assert.ok(f.children[0].args.includes('2048'));
  assert.equal(f.manager.task.repeats, 5);
  assert.deepEqual(f.children[0].args.slice(-2), ['--repeats', '5']);
});
test('custom rounds reach the subprocess and exported task', t => {
  const f=fixture(t), task=f.manager.start({repeats:10});
  assert.equal(task.repeats,10);
  assert.deepEqual(f.children[0].args.slice(-2),['--repeats','10']);
});
test('busy and missing environments do not spawn subprocesses', t => {
  const f = fixture(t, {isBusy:()=>true});
  assert.throws(()=>f.manager.start(), /请先停止/);
  f.manager.isBusy=()=>false; fs.unlinkSync(f.python);
  assert.throws(()=>f.manager.start(), /未安装/);
  assert.equal(f.children.length, 0);
});
test('parses chunked UTF-8 and keeps skipped precisions distinct from measurements', t => {
  const f=fixture(t), task=f.manager.start({sizes:[2048]}), child=f.children[0].child;
  const data=Buffer.from([
    {type:'metadata',gpu:'测试 GPU'},
    ...['bf16','fp16','tf32','fp32','fp8','int8'].map(mode=>({type:'result',mode,size:2048,status:mode==='bf16'?'skipped':'completed',reason:mode==='bf16'?'不支持':undefined})),
  ].map(r=>JSON.stringify(r)+'\n').join(''));
  for(let i=0;i<data.length;i+=7)child.stdout.emit('data',data.subarray(i,i+7));
  child.emit('close',0);
  assert.equal(task.status,'completed');assert.equal(task.metadata.gpu,'测试 GPU');
  assert.equal(task.results[0].tflops,undefined);assert.equal(f.manager.busy(),false);
  assert.deepEqual(task.modes,['bf16','fp16','tf32','fp32','fp8','int8']);
  assert.equal(task.results.length,6);
});
test('retains the complete 18-result suite including FP8 and INT8', t => {
  const f=fixture(t), task=f.manager.start(), child=f.children[0].child;
  for(const mode of task.modes)for(const size of task.sizes){
    child.stdout.emit('data',Buffer.from(JSON.stringify({type:'result',mode,size,status:'completed'})+'\n'));
  }
  child.emit('close',0);
  assert.equal(task.results.length,18);assert.equal(task.status,'completed');
});
test('cancellation retains ownership until process closes', async t => {
  const f=fixture(t), task=f.manager.start(); await f.manager.stop();
  assert.equal(task.status,'stopping');assert.equal(f.manager.busy(),true);
  assert.deepEqual(f.killed,[123456]);
  f.children[0].child.emit('close',1);
  assert.equal(task.status,'stopped');assert.equal(f.manager.busy(),false);
});
test('spawn errors, CUDA errors and incomplete output fail visibly', t => {
  const f=fixture(t);
  let task=f.manager.start();f.children[0].child.emit('error',Error('ENOENT'));
  assert.equal(task.status,'failed');assert.match(task.error,/ENOENT/);
  task=f.manager.start();f.children[1].child.stdout.emit('data',Buffer.from('{"type":"error","error":"CUDA unavailable"}\n'));f.children[1].child.emit('close',1);
  assert.equal(task.error,'CUDA unavailable');
  task=f.manager.start();f.children[2].child.emit('close',0);
  assert.equal(task.status,'failed');assert.match(task.error,/完整结果/);
});
