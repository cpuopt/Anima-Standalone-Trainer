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
  assert.match(fs.readFileSync(merged.sample_prompts,'utf8'), /A fox/);
  assert.ok(prepared.stages[2].args.includes('--module'));
});
test('Turbo generation uses separate defaults, original Turbo, seed zero and strength zero', t => {
  const f = fixture(t); const lora = path.join(f.root,'lora.safetensors'); fs.writeFileSync(lora,'weights');
  const config = K.defaults();
  const p = B.prepareGeneration(config,f.root,f.global,{network_weights:lora,network_mul:0},x=>x,{skipPreflight:true});
  const args = p.stages[0].args, value = flag => args[args.indexOf(flag)+1];
  assert.equal(value('--dit'),f.models.turbo); assert.equal(value('--steps'),'8'); assert.equal(value('--guidance_scale'),'1');
  assert.equal(value('--mu'),'1.15'); assert.equal(value('--seed'),'0'); assert.equal(value('--lora_multiplier'),'0');
  assert.ok(args.includes('--text_encoder_cpu'));
  assert.match(fs.readFileSync(path.join(f.root,'sample_prompts.txt'),'utf8'), /--s 52/);
  assert.throws(()=>B.prepareGeneration(config,f.root,f.global,{gen_gpu_ids:'0,1'},x=>x,{skipPreflight:true}),/one GPU/);
});
test('unsupported or invalid prompt controls fail explicitly', () => {
  for (const line of ['fox --ss heun','fox --ls 1','fox --w nope','fox --w 1000','fox --s 0','fox --d -1','fox --l 1']) assert.throws(()=>B.validatePrompts(line));
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
