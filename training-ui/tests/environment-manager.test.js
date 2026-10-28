const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const TOML = require('@iarna/toml');
const { EnvironmentManager, environmentPath, pythonAt, localRequest } = require('../lib/environment-manager');

function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'environment manager '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'training-ui'));
  const file = path.join(root, 'training-ui/global_config.toml');
  fs.writeFileSync(file, 'main_venv_path = ' + JSON.stringify(path.join(root, 'control')) + '\n');
  const getConfig = () => TOML.parse(fs.readFileSync(file, 'utf8'));
  fs.mkdirSync(path.dirname(pythonAt(path.join(root, 'control'))), { recursive: true });
  fs.writeFileSync(pythonAt(path.join(root, 'control')), '');
  const children = [];
  const spawnProcess = (command, args, opts) => {
    const child = new EventEmitter(); Object.assign(child, { pid: 12345678, stdout: new EventEmitter(), stderr: new EventEmitter() });
    children.push({ child, command, args, opts }); return child;
  };
  const manager = new EnvironmentManager({ root, getConfig, spawnProcess, ...options });
  return { root, manager, children, getConfig, file };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('all backends keep independent paths and native executable layout', () => {
  assert.equal(environmentPath('/project', 'main', {main_venv_path:'/control'}), '/control');
  assert.equal(environmentPath('/project', 'krea2', {venv_path:'/legacy'}), path.join('/project', 'venv-krea2'));
  assert.equal(environmentPath('/project', 'anima-lumina', {venv_path:'/legacy'}), '/legacy');
  assert.match(pythonAt('/env', 'win32'), /Scripts[\\/]python.exe$/);
  assert.match(pythonAt('/env', 'linux'), /bin[\\/]python$/);
});
test('management rejects remote, rebinding and cross-origin requests', () => {
  const req = {socket:{remoteAddress:'127.0.0.1'}, headers:{host:'localhost:3000',origin:'http://localhost:3000'}};
  assert.equal(localRequest(req), true);
  assert.equal(localRequest({...req,socket:{remoteAddress:'192.168.1.1'}}),false);
  assert.equal(localRequest({...req,headers:{host:'evil.example'}}),false);
  assert.equal(localRequest({...req,headers:{host:'localhost:3000',origin:'https://evil.example'}}),false);
});
test('UI inventory works with every model absent and does not trust a stale ready cache', t => {
  const f=fixture(t);
  fs.writeFileSync(path.join(f.root,'.runtime/environment-state.json'),JSON.stringify({active:{krea2:{id:'krea2',path:path.join(f.root,'venv-krea2'),status:'ready',dependencies:true}},history:[]}));
  const models=f.manager.list().environments.filter(e=>e.id!=='main');
  assert.equal(models.length,3);assert.ok(models.every(e=>e.status==='missing'&&!e.installed));
});
test('missing control Python produces a bootstrap hint without launching a process', t => {
  const f=fixture(t);fs.unlinkSync(pythonAt(path.join(f.root,'control')));
  assert.throws(()=>f.manager.start('krea2','install'),/setup_env/);assert.equal(f.children.length,0);
});
test('installation reserves single-flight ownership, validates input and uses argv without a shell', async t => {
  const f=fixture(t), task=f.manager.start('krea2','install');
  assert.throws(()=>f.manager.start('moss','install'),/already running/);
  assert.equal(f.children[0].opts.shell,false); assert.equal(f.children[0].opts.windowsHide,true);
  assert.ok(f.children[0].args.includes('--no-activate'));
  f.children[0].child.emit('close',1); await flush();
  assert.equal(task.status,'failed'); assert.equal(f.getConfig().krea2_venv_path,undefined);
  assert.throws(()=>f.manager.start('moss','install',{command:'anything'}),/Unsupported/);
  assert.throws(()=>f.manager.start('moss','install',{cuda:'cu132'}),/Unsupported/);
});
test('busy trainer blocks installations but not read-only checks', async t => {
  const f=fixture(t,{isBusy:()=>true});
  assert.throws(()=>f.manager.start('moss','install'),/Stop training/);
  const task=f.manager.start('moss','check'); f.children[0].child.emit('close',1);await flush();assert.equal(task.status,'failed');
});
test('successful installation switches only verified candidate and retains source', async t => {
  const f=fixture(t), old=path.join(f.root,'venv-krea2');fs.mkdirSync(old);fs.writeFileSync(path.join(old,'pyvenv.cfg'),'');
  const task=f.manager.start('krea2','install');
  const report={id:'krea2',path:path.join(f.root,'.runtime/environments/krea2/generation'),dependencies:true,status:'ready'};
  const args=f.children[0].args;fs.writeFileSync(args[args.indexOf('--report')+1],JSON.stringify(report));
  f.children[0].child.emit('close',0);await flush();
  assert.equal(task.status,'completed');assert.equal(f.getConfig().krea2_venv_path,report.path);assert.ok(fs.existsSync(old));
  assert.equal(f.manager.list().history[0].path,old);
});
test('failed validation and spawn errors never commit a new environment', async t => {
  const f=fixture(t),task=f.manager.start('moss','install');
  const args=f.children[0].args;fs.writeFileSync(args[args.indexOf('--report')+1],JSON.stringify({id:'moss',path:'/invalid',dependencies:false,errors:['missing dependency']}));
  f.children[0].child.emit('close',0);await flush();assert.equal(task.status,'failed');assert.equal(f.getConfig().moss_venv_path,undefined);
  const next=f.manager.start('krea2','install');f.children[1].child.emit('error',Error('network or process failure'));await flush();
  assert.equal(next.status,'failed');assert.equal(f.getConfig().krea2_venv_path,undefined);
});
test('timed-out check kills its process tree and reports a failure', async t => {
  const killed=[],f=fixture(t,{kill:async pid=>killed.push(pid)});
  const task={id:'timeout-test',status:'running'};f.manager.save(task);
  const pending=f.manager.run(task,'python',['probe'],5);
  await new Promise(resolve=>setTimeout(resolve,15));assert.equal(killed.length,1);
  f.children[0].child.emit('close',1);await assert.rejects(pending,/timed out/);
});
test('stop kills owned tree and never commits candidate; cursor reconnect preserves UTF-8', async t => {
  const killed=[], f=fixture(t,{kill:async pid=>{killed.push(pid)}}),task=f.manager.start('moss','install');
  const bytes=Buffer.from('安装中\r50%');f.children[0].child.stdout.emit('data',bytes.subarray(0,2));f.children[0].child.stdout.emit('data',bytes.subarray(2));
  const first=f.manager.task(task.id);assert.match(Buffer.from(first.output,'base64').toString(),/安装中/);
  assert.equal(f.manager.task(task.id,first.cursor).output,'');
  await f.manager.stop(task.id);assert.equal(killed.length,1);assert.equal(f.manager.installing(),true);
  f.children[0].child.emit('close',0);await flush();assert.equal(task.status,'stopped');assert.equal(f.getConfig().moss_venv_path,undefined);
});
test('restart marks unfinished records interrupted and cleanup rejects active/unregistered paths', t => {
  const f=fixture(t);const task=f.manager.start('moss','check');
  const restarted=new EnvironmentManager({root:f.root,getConfig:f.getConfig});assert.equal(restarted.task(task.id).status,'interrupted');
  assert.throws(()=>restarted.cleanup(f.root,true),/ENOENT|registered/);
  f.children[0].child.emit('close',1);
});
test('verified history cleanup is confined to unused, registered project environments', t => {
  const f=fixture(t);const old=path.join(f.root,'old-env');fs.mkdirSync(old);fs.writeFileSync(path.join(old,'pyvenv.cfg'),'');
  fs.writeFileSync(path.join(f.root,'.runtime/environment-state.json'),JSON.stringify({active:{},history:[{id:'krea2',path:old}]}));
  assert.throws(()=>f.manager.cleanup(old,false),/Confirmation/);
  f.manager.cleanup(old,true);assert.equal(fs.existsSync(old),false);
});
