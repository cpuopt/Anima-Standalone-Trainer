const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const TOML = require('@iarna/toml');
const K = require('../public/js/krea2');
const B = require('../lib/krea2-backend');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anima-krea2-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const images = path.join(root, '图片 with spaces'); fs.mkdirSync(images);
  fs.writeFileSync(path.join(images, 'one.png'), 'image'); fs.writeFileSync(path.join(images, 'one.txt'), 'a fox');
  const models = {};
  for (const k of ['dit','turbo','vae','text_encoder']) { models[k] = path.join(root, `${k}.safetensors`); fs.writeFileSync(models[k], 'model'); }
  const dataset = K.datasetDefaults(); dataset.datasets[0].subsets[0].image_dir = images;
  const rt = { python: process.execPath, cwd: B.VENDOR, models };
  const global = { krea2_venv_path: root, model_paths: {
    krea2_raw_path: models.dit, krea2_turbo_path: models.turbo, krea2_vae_path: models.vae, krea2_text_encoder_path: models.text_encoder } };
  const python = path.join(root, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  fs.mkdirSync(path.dirname(python)); fs.writeFileSync(python, 'fake runtime');
  fs.writeFileSync(path.join(root, 'sample_prompts.txt'), 'A fox --w 1024 --h 1024 --s 52 --l 3.5 --d 0\n');
  return { root, images, models, dataset, rt, global };
}
test('new Krea 2 config and dataset round-trip, legacy architecture detection is preserved', () => {
  const config = K.defaults(); K.validate(TOML.parse(TOML.stringify(config)));
  K.validateDataset(TOML.parse(TOML.stringify(K.datasetDefaults())));
  assert.equal(K.architecture({}), 'anima'); assert.equal(K.architecture({ lumina_arguments: {} }), 'lumina');
  assert.equal(K.architecture(config), 'krea2');
});
for (const [label, mutate] of [
  ['DoRA', c => c.network_arguments.network_args = ['use_dora=true']],
  ['LoKr', c => c.network_arguments.network_module = 'networks.lokr'],
  ['Anima block ranks', c => c.network_arguments.network_args = ['layer_configs={}']],
  ['dropout 1', c => c.network_arguments.network_args = ['rank_dropout=1']],
  ['duplicate argument', c => c.network_arguments.network_args = ['rank_dropout=0.1','rank_dropout=0.2']],
  ['bad patterns', c => c.network_arguments.network_args = ['include_patterns=all']],
  ['multi GPU', c => c.gpu_ids = '0,1'],
  ['unscaled FP8', c => c.training_arguments.fp8_scaled = false],
  ['unknown field', c => c.training_arguments.resolution_schedule = '512:0.5'],
  ['boolean string', c => c.training_arguments.fp8_base = 'false'],
  ['too many swaps', c => c.training_arguments.blocks_to_swap = 27],
  ['offload without checkpointing', c => { c.training_arguments.gradient_checkpointing = false; c.training_arguments.gradient_checkpointing_cpu_offload = true; }],
  ['unsafe output name', c => c.training_arguments.output_name = '../outside'],
  ['Adafactor arguments on AdamW', c => { c.training_arguments.optimizer_type = 'AdamW'; c.training_arguments.optimizer_args = ['relative_step=False']; }],
  ['Adafactor arguments on AdamW8bit', c => c.training_arguments.optimizer_args = ['scale_parameter=False']],
]) test(`Krea 2 rejects ${label}`, () => { const c = K.defaults(); mutate(c); assert.throws(() => K.validate(c)); });

test('native dropout and LoRA+ arguments survive config round-trip', () => {
  const c = K.defaults(); c.network_arguments.network_args = ['rank_dropout=0.1','module_dropout=0.1','loraplus_lr_ratio=16', "include_patterns=['.*attn.*']"];
  assert.deepEqual(K.validate(TOML.parse(TOML.stringify(c))).network_arguments.network_args, c.network_arguments.network_args);
});
test('datasets reject Anima-only features and invalid dimensions', () => {
  for (const change of [d => d.datasets[0].subsets[0].epoch_sample_rate = 0.5,
    d => d.general.min_bucket_reso = 512, d => d.datasets[0].resolution = [1000,1024]]) {
    const d = K.datasetDefaults(); change(d); assert.throws(() => K.validateDataset(d));
  }
});
test('cache directories separate folders/resolutions, reuse identical input and invalidate captions/models', t => {
  const f = fixture(t), load = () => TOML.parse(fs.readFileSync(B.prepareDataset(f.dataset,f.root,f.rt),'utf8'));
  const first = load().datasets[0].cache_directory; assert.equal(load().datasets[0].cache_directory,first);
  fs.writeFileSync(path.join(f.images,'one.txt'),'changed caption');
  const second = load().datasets[0].cache_directory; assert.notEqual(second,first);
  fs.appendFileSync(f.models.text_encoder,'changed'); assert.notEqual(load().datasets[0].cache_directory,second);
  f.dataset.datasets.push({ ...f.dataset.datasets[0], resolution: [512,512] });
  const converted = load(); assert.equal(converted.datasets.length,2); assert.notEqual(converted.datasets[0].cache_directory,converted.datasets[1].cache_directory);
  assert.equal(converted.datasets[0].image_directory,f.images); assert.ok(!('subsets' in converted.datasets[0]));
  assert.ok(!fs.readdirSync(f.images).some(x => x.endsWith('.safetensors')));
});
test('same filename stems are rejected before creating ambiguous Musubi caches', t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.images,'one.jpg'),'image');
  assert.throws(() => B.prepareDataset(f.dataset,f.root,f.rt), /Duplicate image stems/);
});
test('missing captions are listed before producing a usable training dataset; empty captions are allowed', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.images, 'two.png'), 'image');
  fs.writeFileSync(path.join(f.images, 'three.jpg'), 'image');
  assert.throws(() => B.prepareDataset(f.dataset, f.root, f.rt), err => {
    assert.match(err.message, /Missing caption files/);
    assert.ok(err.message.includes(path.join(f.images, 'two.txt')));
    assert.ok(err.message.includes(path.join(f.images, 'three.txt')));
    return true;
  });
  assert.ok(!fs.existsSync(path.join(f.root, '_krea2_dataset.toml')));
  fs.writeFileSync(path.join(f.images, 'two.txt'), '');
  fs.writeFileSync(path.join(f.images, 'three.txt'), '');
  assert.doesNotThrow(() => B.prepareDataset(f.dataset, f.root, f.rt));
});
for (const ext of ['avif', 'AVIF', 'jxl', 'JXL']) test(`mixed directory rejects ${ext} instead of silently caching untracked images`, t => {
  const f = fixture(t), extra = path.join(f.images, `one.${ext}`);
  fs.writeFileSync(extra, 'image');
  assert.throws(() => B.prepareDataset(f.dataset, f.root, f.rt), err => {
    assert.match(err.message, /Unsupported Krea 2 images/); assert.ok(err.message.includes(extra)); return true;
  });
});
test('three-stage launch uses isolated module names, snapshots and correct CLI flags', t => {
  const f = fixture(t), config = K.defaults(); config.training_arguments.sample_every_n_steps = 5;
  config.network_arguments.auto_resume_last_state = true;
  fs.mkdirSync(path.join(f.root,'output','saved-state'), { recursive: true });
  const prepared = B.prepareTraining(config,f.dataset,f.root,f.global, x=>x, {skipPreflight:true});
  assert.deepEqual(prepared.stages.map(x=>x.phase), ['cache_latents','cache_text','training']);
  const merged = TOML.parse(fs.readFileSync(path.join(f.root,'_krea2_config.toml'),'utf8'));
  assert.equal(merged.network_module,K.MODULE); assert.ok(merged.resume.endsWith('saved-state'));
  assert.ok(!('text_encoder_lr' in merged)); assert.ok(!('auto_resume_last_state' in merged));
  fs.writeFileSync(path.join(f.root,'sample_prompts.txt'),'changed');
  const prompts = JSON.parse(fs.readFileSync(merged.sample_prompts,'utf8'));
  assert.deepEqual(prompts, [{ prompt: 'A fox', negative_prompt: '', width: 1024, height: 1024, sample_steps: 52, cfg_scale: 3.5, seed: 0 }]);
  assert.ok(prepared.stages[2].args.includes('--module'));
});
test('Turbo generation uses separate defaults, original Turbo, seed zero and strength zero', t => {
  const f = fixture(t); const lora = path.join(f.root,'lora.safetensors'); fs.writeFileSync(lora,'weights');
  const config = K.defaults();
  const p = B.prepareGeneration(config,f.root,f.global,{network_weights:lora,network_mul:0},x=>x,{skipPreflight:true});
  const args = p.stages[0].args, value = flag => args[args.indexOf(flag)+1];
  assert.equal(value('--dit'),f.models.turbo); assert.equal(value('--steps'),'8'); assert.equal(value('--guidance_scale'),'1');
  assert.equal(value('--mu'),'1.15'); assert.equal(value('--lora_multiplier'),'0');
  assert.match(fs.readFileSync(value('--from_file'), 'utf8'), /--d 0/);
  assert.ok(args.includes('--text_encoder_cpu'));
  assert.match(fs.readFileSync(path.join(f.root,'sample_prompts.txt'),'utf8'), /--s 52/);
  assert.throws(()=>B.prepareGeneration(config,f.root,f.global,{gen_gpu_ids:'0,1'},x=>x,{skipPreflight:true}),/one GPU/);
});
test('training snapshots preserve explicit and empty negatives for CFG', t => {
  const f = fixture(t), config = K.defaults(); config.training_arguments.sample_every_n_steps = 5;
  fs.writeFileSync(path.join(f.root, 'sample_prompts.txt'), 'fox --l 4 --n blurry\ncat --n \n');
  B.prepareTraining(config, f.dataset, f.root, f.global, x => x, { skipPreflight: true });
  const prompts = JSON.parse(fs.readFileSync(path.join(f.root, '_krea2_sample_prompts.json'), 'utf8'));
  assert.equal(prompts[0].negative_prompt, 'blurry'); assert.equal(prompts[0].cfg_scale, 4);
  assert.equal(prompts[1].negative_prompt, ''); assert.equal(prompts[1].cfg_scale, 3.5);
});
test('manual generation loads models once, snapshots per-prompt values and overrides training steps/CFG', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, 'sample_prompts.txt'), '# comment\nfox --w 512 --h 768 --s 52 --l 3.5 --d 0 --n blurry\ncat --s 80 --l 5 --d 42\n');
  const prepared = B.prepareGeneration(K.defaults(), f.root, f.global, { krea2_steps: 12, krea2_cfg: 2 }, x => x, { skipPreflight: true });
  assert.equal(prepared.stages.length, 1);
  const args = prepared.stages[0].args, value = flag => args[args.indexOf(flag) + 1];
  assert.equal(value('--steps'), '12'); assert.equal(value('--guidance_scale'), '2');
  const snapshot = fs.readFileSync(value('--from_file'), 'utf8');
  assert.equal(snapshot, 'fox --w 512 --h 768 --d 0 --n blurry\ncat --w 1024 --h 1024 --d 42\n');
  fs.writeFileSync(path.join(f.root, 'sample_prompts.txt'), 'changed');
  assert.equal(fs.readFileSync(value('--from_file'), 'utf8'), snapshot);
});
test('preflight is deferred until the owned pipeline runs', t => {
  const f = fixture(t), config = K.defaults();
  const train = B.prepareTraining(config, f.dataset, f.root, f.global);
  const gen = B.prepareGeneration(config, f.root, f.global, {});
  for (const prepared of [train, gen]) {
    assert.equal(prepared.stages[0].phase, 'preflight');
    assert.equal(prepared.stages[0].timeout, 60000);
    assert.match(prepared.stages[0].args[1], /torch.cuda.is_available/);
  }
});
test('unsupported or invalid prompt controls fail explicitly', () => {
  for (const line of ['fox --ss heun','fox --ls 1','fox --w nope','fox --w 1000','fox --s 0','fox --d -1','fox --l 1','fox --w',' --w 512']) assert.throws(()=>B.validatePrompts(line));
});
function fakeSpawn(codes, children) {
  return () => {
    const p = new EventEmitter(); p.stdout = new EventEmitter(); p.stderr = new EventEmitter(); p.pid = children.length + 1;
    children.push(p); const code = codes.shift(); if (code !== undefined) setImmediate(()=>p.emit('close',code));
    return p;
  };
}
const fakePrepared = { rt: { python:'isolated-python', cwd:'vendor' }, stages: ['cache_latents','cache_text','training'].map(phase=>({phase,args:[]})), gpuIds:'0' };
test('all stages run in order and publish a completed outcome', async () => {
  const children=[], phases=[];
  const p=B.pipeline(fakePrepared,{spawnProcess:fakeSpawn([0,0,0],children),onPhase:x=>phases.push(x)});
  assert.equal(await p.start(),'completed'); assert.equal(children.length,3);
  assert.deepEqual(phases,['cache_latents','cache_text','training','completed']);
});
test('failed cache halts the pipeline and reports failed rather than stopped', async () => {
  const children=[]; const p=B.pipeline(fakePrepared,{spawnProcess:fakeSpawn([0,2,0],children)});
  assert.equal(await p.start(),'failed'); assert.equal(children.length,2);
});
for (const phase of ['cache_latents','cache_text','training']) test(`stop during ${phase} prevents all later launches`, async () => {
  const children=[], codes=phase==='cache_latents'?[]:phase==='cache_text'?[0]:[0,0];
  let entered; const ready=new Promise(r=>entered=r);
  const p=B.pipeline(fakePrepared,{spawnProcess:fakeSpawn(codes,children),onPhase:x=>{if(x===phase) setImmediate(entered);},kill:proc=>proc.emit('close',null)});
  const done=p.start(); await ready; await p.stop(); assert.equal(await done,'stopped');
  assert.equal(children.length, ['cache_latents','cache_text','training'].indexOf(phase)+1);
});
test('spawn failure becomes a failed outcome without a later launch', async () => {
  let count=0;
  const p=B.pipeline(fakePrepared,{spawnProcess:()=>{count++;throw Error('runtime missing');}});
  assert.equal(await p.start(),'failed'); assert.equal(count,1);
});
test('preflight failure halts launch and preserves environment diagnostics', async () => {
  const children = [], logs = [];
  const prepared = { ...fakePrepared, stages: [{ phase: 'preflight', args: [], errorPrefix: 'Run setup_krea2 first.' }, ...fakePrepared.stages] };
  const p = B.pipeline(prepared, { spawnProcess: fakeSpawn([1], children), onLog: text => logs.push(text) });
  assert.equal(await p.start(), 'failed'); assert.equal(children.length, 1);
  assert.match(logs.join(''), /Run setup_krea2 first/);
});
test('preflight remains responsive to stop and prevents training', async () => {
  const children = [];
  const prepared = { ...fakePrepared, stages: [{ phase: 'preflight', args: [] }, ...fakePrepared.stages] };
  const p = B.pipeline(prepared, { spawnProcess: fakeSpawn([], children), kill: proc => proc.emit('close', null) });
  const done = p.start(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(p.phase, 'preflight'); await p.stop();
  assert.equal(await done, 'stopped'); assert.equal(children.length, 1);
});
test('preflight timeout kills its process and blocks all subsequent stages', async () => {
  const children = [], killed = [];
  const prepared = { ...fakePrepared, stages: [{ phase: 'preflight', args: [], timeout: 5 }, ...fakePrepared.stages] };
  const p = B.pipeline(prepared, { spawnProcess: fakeSpawn([], children), kill: proc => { killed.push(proc.pid); proc.emit('close', null); } });
  assert.equal(await p.start(), 'failed'); assert.equal(children.length, 1); assert.deepEqual(killed, [1]);
});
