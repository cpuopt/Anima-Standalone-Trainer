const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { EventEmitter } = require('events');
const { spawnSync } = require('child_process');
const TOML = require('@iarna/toml');
const M = require('../public/js/moss');
const B = require('../lib/moss-backend');
function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'moss-test-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const images=path.join(root,'images with spaces');fs.mkdirSync(images);
  fs.writeFileSync(path.join(images,'fox.png'),'image');fs.writeFileSync(path.join(images,'fox.txt'),'a fox\nwith text');
  const models={};for(const k of ['dit','sft','text_encoder','vae']){models[k]=path.join(root,k+'.safetensors');fs.writeFileSync(models[k],'model');}
  const global={moss_venv_path:root,model_paths:{moss_dit_path:models.dit,moss_sft_path:models.sft,moss_text_encoder_path:models.text_encoder,moss_vae_path:models.vae}};
  const python=B.runtime(global).python;fs.mkdirSync(path.dirname(python));fs.writeFileSync(python,'runtime');
  const dataset=M.datasetDefaults();dataset.datasets[0].subsets[0].image_dir=images;
  fs.writeFileSync(path.join(root,'sample_prompts.txt'),'a fox --w 512 --h 768 --s 3 --l 0 --d 0 --n\n');
  return {root,images,models,global,dataset};
}
test('MOSS Base/SFT and all three adapters round-trip with explicit architecture',()=>{
  for(const flavour of ['base','sft'])for(const module of M.MODULES){const c=M.defaults();c.moss_arguments.flavour=flavour;c.network_arguments.network_module=module;M.validate(TOML.parse(TOML.stringify(c)));}
  M.validateDataset(TOML.parse(TOML.stringify(M.datasetDefaults())));
  const source=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
  const start=source.indexOf('function getArchForJob('),end=source.indexOf('// Build model_arguments',start);
  const get=vm.runInNewContext(source.slice(start,end)+';getArchForJob',{ARCH_REGISTRY:require('../architectures.json')});
  assert.equal(get({network_arguments:{network_module:'networks.lokr'}}).id,'anima');
  assert.equal(get({moss_arguments:{},network_arguments:{network_module:'networks.lokr'}}).id,'moss_image');
});
for(const [name,change] of [
  ['multiple GPUs',c=>c.gpu_ids='0,1'], ['Anima fields',c=>c.training_arguments.use_cuda_direct=true],
  ['FP8',c=>c.training_arguments.fp8_base=true],['TE training',c=>c.network_arguments.network_train_unet_only=false],
  ['non-BF16',c=>c.training_arguments.mixed_precision='fp16'], ['invalid boolean',c=>c.moss_arguments.convrot_int8='false'],
  ['unsafe output',c=>c.training_arguments.output_name='../outside'],['layer args',c=>c.network_arguments.network_args=['layer_configs={}']],
  ['bad factor',c=>{c.network_arguments.network_module='networks.lokr';c.network_arguments.network_args=['factor=0'];}],
  ['duplicate args',c=>c.network_arguments.network_args=['rank_dropout=0.1','rank_dropout=0.2']],
  ['offload with swap',c=>c.training_arguments.cpu_offload_checkpointing=true],
  ['H2D without checkpointing',c=>c.training_arguments.gradient_checkpointing=false],
])test(`MOSS rejects ${name}`,()=>{const c=M.defaults();change(c);assert.throws(()=>M.validate(c));});
test('MOSS datasets reject non-multiple resolutions and cached caption augmentation',()=>{
  for(const edit of [d=>d.datasets[0].resolution=[513,512],d=>d.general.bucket_reso_steps=17,d=>d.datasets[0].subsets[0].shuffle_caption=true,d=>d.datasets[0].subsets[0].epoch_sample_rate=0.5]){const ds=M.datasetDefaults();edit(ds);assert.throws(()=>M.validateDataset(ds));}
});
test('MOSS compile options validate strictly and old tasks remain compatible',()=>{
  const c=M.defaults();
  for(const k of M.TRAIN_KEYS.filter(k=>k.startsWith('compile')||k.startsWith('cuda_'))) delete c.training_arguments[k];
  M.validate(c);
  for(const [key,value] of Object.entries({compile:'true',compile_fullgraph:1,cuda_allow_tf32:'false',cuda_cudnn_benchmark:0,
    compile_backend:'unknown',compile_mode:'fast',compile_dynamic:true,compile_cache_size_limit:0})) {
    const bad=M.defaults();bad.training_arguments[key]=value;assert.throws(()=>M.validate(bad),key);
  }
  c.training_arguments.compile=true;c.training_arguments.compile_backend='eager';c.training_arguments.compile_mode='max-autotune';
  assert.throws(()=>M.validate(c),/default compile_mode/);
  c.training_arguments.compile_mode='default';M.validate(c);
  c.training_arguments.torch_compile=true;assert.throws(()=>M.validate(c),/torch_compile/);
});
test('MOSS compile and CUDA options survive TOML round-trip into native launch config',t=>{
  const f=fixture(t),c=M.defaults();
  const options={compile:true,compile_backend:'inductor',compile_mode:'default',compile_dynamic:'false',
    compile_fullgraph:true,compile_cache_size_limit:64,cuda_allow_tf32:true,cuda_cudnn_benchmark:true};
  Object.assign(c.training_arguments,options);
  B.prepareTraining(TOML.parse(TOML.stringify(c)),f.dataset,f.root,f.global);
  const native=TOML.parse(fs.readFileSync(path.join(f.root,'_moss_config.toml'),'utf8'));
  for(const [k,v] of Object.entries(options))assert.equal(native[k],v,k);
  c.training_arguments.compile=false;B.prepareTraining(c,f.dataset,f.root,f.global);
  assert.equal(TOML.parse(fs.readFileSync(path.join(f.root,'_moss_config.toml'),'utf8')).compile,false);
});
test('checkpoint sharding verifies first shard, all siblings and formats',t=>{
  const {root}=fixture(t),first=path.join(root,'model-00001-of-00002.safetensors'),second=path.join(root,'model-00002-of-00002.safetensors');
  fs.writeFileSync(first,'one');assert.throws(()=>B.checkpoint(first));fs.writeFileSync(second,'two');assert.equal(B.checkpoint(first).length,2);assert.throws(()=>B.checkpoint(second));
  const gptq=path.join(root,'qwen_w4a8_gptq.safetensors');fs.writeFileSync(gptq,'bad');assert.throws(()=>B.checkpoint(gptq));
});
test('dataset snapshots isolate cache, reuse unchanged input and invalidate captions/resolution/models',t=>{
  const f=fixture(t),c=M.defaults(),ids=B.checkModels(B.runtime(f.global),'base').identities;
  const read=()=>TOML.parse(fs.readFileSync(B.prepareDataset(f.dataset,f.root,ids,c),'utf8')).datasets[0].subsets[0].image_dir;
  const a=read();assert.notEqual(a,f.images);assert.equal(read(),a);
  fs.writeFileSync(path.join(f.images,'fox.txt'),'changed');const b=read();assert.notEqual(a,b);
  assert.equal(fs.readFileSync(path.join(a,'fox.txt'),'utf8'),'a fox\nwith text');
  f.dataset.datasets[0].resolution=[768,768];const d=read();assert.notEqual(d,b);
  ids.vae[0].mtime++;assert.notEqual(read(),d);
  assert.deepEqual(fs.readdirSync(f.images).sort(),['fox.png','fox.txt']);
});
test('missing captions and duplicate stems fail before launching',t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.images,'fox.jpg'),'same stem');
  assert.throws(()=>B.prepareTraining(M.defaults(),f.dataset,f.root,f.global));fs.unlinkSync(path.join(f.images,'fox.jpg'));fs.unlinkSync(path.join(f.images,'fox.txt'));
  assert.throws(()=>B.prepareTraining(M.defaults(),f.dataset,f.root,f.global));
});
test('native training config and sampling snapshots preserve zero/empty values and resume',t=>{
  const f=fixture(t),c=M.defaults();c.training_arguments.sample_every_n_epochs=1;c.network_arguments.auto_resume_last_state=true;
  const state=path.join(f.root,'output','saved-state');fs.mkdirSync(state,{recursive:true});
  const p=B.prepareTraining(c,f.dataset,f.root,f.global);
  assert.equal(p.rt.cwd,B.VENDOR);assert.equal(p.stages[0].phase,'preflight');assert.equal(p.stages[1].phase,'training');assert.ok(p.stages[1].args.includes('--num_processes'));
  const merged=TOML.parse(fs.readFileSync(path.join(f.root,'_moss_config.toml'),'utf8'));
  assert.equal(merged.resume,state);assert.equal(merged.pretrained_model_name_or_path,f.models.dit);assert.equal(merged.network_module,'networks.lora_generic');assert.equal(merged.flavour,undefined);
  const snapshot=JSON.parse(fs.readFileSync(merged.sample_prompts,'utf8'));assert.equal(snapshot[0].seed,0);assert.equal(snapshot[0].scale,0);assert.equal(snapshot[0].negative_prompt,'');assert.equal(snapshot[0].height,768);
  fs.writeFileSync(path.join(f.root,'sample_prompts.txt'),'edited');assert.equal(JSON.parse(fs.readFileSync(merged.sample_prompts,'utf8'))[0].prompt,'a fox');
});
test('generation uses selected SFT, adapter type/factor, zero strength and snapshot',t=>{
  const f=fixture(t),c=M.defaults();c.moss_arguments.flavour='sft';c.network_arguments.network_module='networks.lokr';c.network_arguments.network_args=['factor=3'];
  const p=B.prepareGeneration(c,f.root,f.global,{network_weights:f.models.dit,network_mul:0,moss_flow_shift:5});
  assert.equal(p.stages[1].phase,'generating');const spec=JSON.parse(fs.readFileSync(path.join(f.root,'_moss_generate.json')));
  assert.equal(spec.dit,f.models.sft);assert.equal(spec.multiplier,0);assert.equal(spec.network_args.factor,'3');assert.equal(spec.prompts[0].seed,0);assert.equal(spec.prompts[0].negative_prompt,'');
  assert.throws(()=>B.prepareGeneration(c,f.root,f.global,{gen_gpu_ids:'0,1'}));
});
test('legacy MOSS prompt round-trip preserves zero seed, zero CFG and empty negative',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../public/js/app.js'),'utf8');
  const start=source.indexOf('function parsePromptLine('),end=source.indexOf('async function savePrompts',start);
  const ctx={currentArchitecture:'moss_image',lastSavedNegativePrompt:'', $:()=>({value:''})};
  vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);
  const p=ctx.parsePromptLine('fox --w 512 --h 768 --s 3 --l 0 --d 0 --n');
  assert.equal(p.text,'fox');assert.equal(p.d,0);assert.equal(p.l,0);assert.equal(p.sourceNegative,'');
  const line=ctx.serializePrompt(p);assert.match(line,/--d 0/);assert.match(line,/--l 0/);assert.doesNotMatch(line,/--ss|--n/);
});
for(const fail of ['preflight','training'])test(`MOSS pipeline ${fail} failure never reports completed`,async()=>{
  const seen=[];let environment;
  const prepared={rt:{python:'python',cwd:B.VENDOR},gpuIds:'0',label:'MOSS',stages:[{phase:'preflight',args:[]},{phase:'training',args:[]}]};
  const job=B.pipeline(prepared,{spawnProcess:(cmd,args,opts)=>{environment=opts.env;const e=new EventEmitter();e.stdout=e.stderr=new EventEmitter();const phase=prepared.stages[seen.length].phase;seen.push(phase);queueMicrotask(()=>e.emit('close',phase===fail?1:0));return e;}});
  assert.equal(await job.start(),'failed');assert.equal(job.krea2,undefined);assert.equal(job.moss,true);assert.equal(environment.PYTHONPATH,undefined);assert.equal(environment.CUDA_VISIBLE_DEVICES,'0');
  if(fail==='preflight')assert.deepEqual(seen,['preflight']);
});
test('MOSS stop retains ownership until the child closes and skips later stages',async()=>{
  let child;const job=B.pipeline({rt:{python:'python',cwd:B.VENDOR},gpuIds:'0',stages:[{phase:'preflight',args:[]},{phase:'training',args:[]}]},
    {spawnProcess:()=>{child=new EventEmitter();child.stdout=child.stderr=new EventEmitter();return child;},kill:p=>queueMicrotask(()=>p.emit('close',1))});
  const result=job.start();await job.stop();assert.equal(await result,'stopped');assert.equal(job.outcome,'stopped');
});
test('MOSS create, save, lock and reset routes keep architecture and avoid Anima validation',t=>{
  const f=fixture(t),source=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
  const runningJobs=new Map();let handler;
  const helpers=source.slice(source.indexOf('function getArchForJob('),source.indexOf('// Build model_arguments'));
  const context={Moss:M,Krea2:require('../public/js/krea2'),TOML,fs,path,JOBS_DIR:f.root,TEMPLATES_DIR:f.root,runningJobs,
    ARCH_REGISTRY:require('../architectures.json'),sanitizeName:n=>n,getJobPath:n=>path.join(f.root,n),stripQuotes:s=>s,
    getGlobalConfig:()=>({}),validateLayerArgs:()=>{throw Error('Must not call Anima validator')},
    getDefaultConfig:()=>{throw Error('Must not use Anima defaults')},app:{post:(url,fn)=>handler=fn,put:(url,fn)=>handler=fn}};
  vm.createContext(context);vm.runInContext(helpers,context);
  function route(verb,url){const start=source.indexOf(`app.${verb}('${url}'`),end=source.indexOf('\n});',start)+5;assert.ok(start>=0);vm.runInContext(source.slice(start,end),context);return handler;}
  const response=()=>({code:200,body:null,status(n){this.code=n;return this},json(v){this.body=v;return this}});
  let res=response();route('post','/api/jobs')({body:{name:'new-moss',architecture:'moss_image'}},res);assert.equal(res.code,200,JSON.stringify(res.body));
  const configPath=path.join(f.root,'new-moss','config.toml');const config=TOML.parse(fs.readFileSync(configPath,'utf8'));assert.equal(config.architecture,'moss_image');
  config.network_arguments.network_module='networks.lokr';config.network_arguments.network_args=['factor=3'];
  const save=route('put','/api/jobs/:name');res=response();save({params:{name:'new-moss'},body:{config}},res);assert.equal(res.code,200,JSON.stringify(res.body));
  runningJobs.set('new-moss',{});res=response();save({params:{name:'new-moss'},body:{config}},res);assert.equal(res.code,400);
  runningJobs.clear();res=response();route('post','/api/jobs/:name/reset-config')({params:{name:'new-moss'}},res);assert.equal(res.code,200,JSON.stringify(res.body));
  assert.equal(TOML.parse(fs.readFileSync(configPath,'utf8')).architecture,'moss_image');
});
test('MOSS route dispatch and GPU ownership are symmetric across training and generation',async t=>{
  const f=fixture(t),source=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
  fs.writeFileSync(path.join(f.root,'config.toml'),TOML.stringify(M.defaults()));fs.writeFileSync(path.join(f.root,'dataset.toml'),TOML.stringify(f.dataset));
  const runningJobs=new Map();const calls=[];let handler;
  const context={fs,path,TOML,runningJobs,persistentGenProcess:null,sanitizeName:x=>x,getJobPath:()=>f.root,getArchForJob:c=>({id:c.architecture}),getGlobalConfig:()=>f.global,toNativePath:x=>x,
    mossBackend:{prepareTraining:()=>{calls.push('training');return {}},prepareGeneration:()=>{calls.push('generation');return {}}},
    startMossPipeline:(name,root,prepared,type)=>runningJobs.set(name,{moss:true,type}),app:{post:(url,fn)=>handler=fn}};
  vm.createContext(context);
  const res=()=>({code:200,body:null,status(code){this.code=code;return this},json(body){this.body=body;return this}});
  for(const route of ['train/start','generate']) {
    const start=source.indexOf(`app.post('/api/jobs/:name/${route}'`),end=source.indexOf('\n});',start)+5;vm.runInContext(source.slice(start,end),context);
    runningJobs.clear();let response=res();await handler({params:{name:'moss'},body:{}},response);assert.equal(response.code,200,JSON.stringify(response.body));assert.equal(runningJobs.get('moss').moss,true);
    runningJobs.clear();runningJobs.set('another',{type:'training'});response=res();await handler({params:{name:'moss'},body:{}},response);assert.equal(response.code,400);assert.match(response.body.error,/GPU busy/);
    runningJobs.clear();runningJobs.set('moss-owner',{moss:true});fs.writeFileSync(path.join(f.root,'config.toml'),TOML.stringify({architecture:'anima'}));response=res();await handler({params:{name:'anima'},body:{}},response);assert.equal(response.code,400);assert.match(response.body.error,/MOSS operation/);
    fs.writeFileSync(path.join(f.root,'config.toml'),TOML.stringify(M.defaults()));
  }
  assert.deepEqual(calls,['training','generation']);
});
test('generated config keys are accepted by the real pinned parser and dataset sanitizer',t=>{
  const python=process.env.MOSS_TEST_PYTHON||path.resolve(__dirname,'../../venv-moss',process.platform==='win32'?'Scripts/python.exe':'bin/python');
  if(!fs.existsSync(python))return t.skip('Install setup_moss first for native parser verification');
  const f=fixture(t),c=M.defaults();c.training_arguments.compile=true;B.prepareTraining(c,f.dataset,f.root,f.global);
  const script=`import sys, json, toml\nfrom pathlib import Path\nsys.path.insert(0,${JSON.stringify(path.resolve(__dirname,'../../scripts'))})\nimport moss_runtime\nmoss_runtime.isolate()\nimport moss_image_train_network as train\nfrom library.config_util import ConfigSanitizer\np=train.setup_parser()\nc=toml.load(sys.argv[1])\nunknown=set(c)-{a.dest for a in p._actions}\nassert not unknown, unknown\na=p.parse_args(['--config_file',sys.argv[1]])\nfrom library.args import read_config_from_file\na=read_config_from_file(a,p)\nassert a.network_train_unet_only and a.mixed_precision=='bf16'\nConfigSanitizer(True,True,False,True).sanitize_user_config(toml.load(a.dataset_config))\nprint('NATIVE MOSS CONFIG OK')`;
  const runnable=script.replace("a=read_config_from_file(a,p)","sys.argv=[sys.argv[0],'--config_file',sys.argv[1]]\na=read_config_from_file(a,p)");
  const result=spawnSync(python,['-c',runnable,path.join(f.root,'_moss_config.toml')],{encoding:'utf8',timeout:60000,windowsHide:true});
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);assert.match(result.stdout,/NATIVE MOSS CONFIG OK/);
});
