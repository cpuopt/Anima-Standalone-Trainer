const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const TOML = require('@iarna/toml');
const M = require('../public/js/moss');
const { pipeline: ownedPipeline } = require('./krea2-backend');
const REVISION = '11d8cedd0c67b93a10f8b2d75f43554f6f12c794';
const ROOT = path.resolve(__dirname, '../..');
const VENDOR = path.join(ROOT, 'vendor/sd-scripts');
const RUNNER = path.join(ROOT, 'scripts/moss_runtime.py');
const MODEL_KEYS = { dit:'moss_dit_path', sft:'moss_sft_path', text_encoder:'moss_text_encoder_path', vae:'moss_vae_path' };
function runtime(global, native=x=>x) {
  const venv=require('./environment-manager').environmentPath(ROOT,'moss',global,native);
  return {python:path.join(venv,process.platform==='win32'?'Scripts/python.exe':'bin/python'), cwd:VENDOR,
    models:Object.fromEntries(Object.entries(MODEL_KEYS).map(([k,v])=>[k,native(global.model_paths?.[v]||'')])),
    tokenizer:native(global.model_paths?.moss_tokenizer_path||'')};
}
function identity(file) {
  if(!file||!fs.existsSync(file)||!fs.statSync(file).isFile())throw Error(`MOSS file not found: ${file||'(empty)'}`);
  const s=fs.statSync(file); return {path:path.resolve(file),size:s.size,mtime:s.mtimeMs};
}
function checkpoint(file) {
  identity(file);
  if(!file.endsWith('.safetensors')||/gptq|w4a8|fp8|nf4/i.test(path.basename(file))) throw Error('MOSS expects bf16 or ConvRot INT8 safetensors, not GPTQ/FP8/NF4');
  const match=path.basename(file).match(/^(.*)-(\d{5})-of-(\d{5})\.safetensors$/);
  if(!match)return [identity(file)];
  if(Number(match[2])!==1) throw Error('Select the first MOSS checkpoint shard');
  const count=Number(match[3]); if(count<1||count>128)throw Error('Invalid shard count');
  return Array.from({length:count},(_,i)=>identity(path.join(path.dirname(file),`${match[1]}-${String(i+1).padStart(5,'0')}-of-${match[3]}.safetensors`)));
}
function checkModels(rt, flavour) {
  identity(rt.python);
  const dit=rt.models[flavour==='sft'?'sft':'dit'];
  const result={dit:checkpoint(dit),text_encoder:checkpoint(rt.models.text_encoder),vae:checkpoint(rt.models.vae)};
  if(rt.tokenizer&&(!fs.existsSync(rt.tokenizer)||!fs.statSync(rt.tokenizer).isDirectory()))throw Error('MOSS tokenizer path must be a directory');
  if(rt.tokenizer)result.tokenizer=fs.readdirSync(rt.tokenizer).sort().filter(n=>fs.statSync(path.join(rt.tokenizer,n)).isFile()).map(n=>identity(path.join(rt.tokenizer,n)));
  return {dit,identities:result};
}
function preflightStage() {return {phase:'preflight',args:[RUNNER,'preflight'],timeout:60000,errorPrefix:'MOSS environment check failed. Run setup_moss.bat / setup_moss.sh.'};}
async function status(global,native) {
  const rt=runtime(global,native);
  const result={revision:REVISION,python:rt.python,installed:fs.existsSync(rt.python),
    models:Object.fromEntries(Object.entries(rt.models).map(([k,v])=>[k,!!v&&fs.existsSync(v)])),dependencies:false};
  if(!result.installed)return result;
  const env={...process.env,PYTHONIOENCODING:'utf-8'}; delete env.PYTHONPATH;
  return new Promise(resolve=>execFile(rt.python,[RUNNER,'check'],{cwd:VENDOR,env,windowsHide:true,timeout:15000,maxBuffer:1024*1024},(err,out,stderr)=>{
    result.dependencies=!err; if(err)result.error=String(stderr||err.message).slice(-2000); else {try{Object.assign(result,JSON.parse(out.trim().split(/\r?\n/).pop()))}catch{result.dependencies=false;result.error='Invalid environment response';}}
    resolve(result);
  }));
}
function digest(value){return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,24);}
function networkArgs(tokens=[]) {return tokens.map(token=>{const eq=token.indexOf('=');return token.slice(0,eq).trim()+'='+token.slice(eq+1).trim();});}
function prepareDataset(ds,jobPath,models,config,native=x=>x) {
  M.validateDataset(ds,true);
  const result=structuredClone(ds);
  for(const [di,d] of result.datasets.entries()) for(const [si,s] of d.subsets.entries()) {
    const dir=native(s.image_dir);
    if(!fs.statSync(dir).isDirectory())throw Error(`Not an image directory: ${dir}`);
    const names=fs.readdirSync(dir,{withFileTypes:true}).filter(e=>e.isFile()).map(e=>e.name).sort();
    if(names.some(n=>/\.(avif|jxl)$/i.test(n)))throw Error('Convert AVIF/JXL to PNG/JPG/WEBP/BMP before MOSS training');
    const images=names.filter(n=>/\.(png|jpe?g|webp|bmp)$/i.test(n));
    if(!images.length)throw Error(`No supported images in ${dir}`);
    const stems=images.map(n=>path.parse(n).name.toLowerCase());
    if(new Set(stems).size!==stems.length)throw Error('Duplicate image stems: rename before caching');
    const files=images.map(name=>({image:identity(path.join(dir,name)),caption:fs.readFileSync(path.join(dir,path.parse(name).name+d.caption_extension),'utf8')}));
    const id=digest({revision:REVISION,models,files,general:ds.general,dataset:{...d,subsets:undefined},subset:s,
      tokenLength:config.moss_arguments.moss_max_token_length, tokenizer:models.tokenizer,
      quantizedText:config.moss_arguments.convrot_int8_text_encoder});
    const cache=path.join(jobPath,'cache','moss',`${di}-${si}`,id);
    fs.mkdirSync(cache,{recursive:true});
    for(const f of files) {
      const destination=path.join(cache,path.basename(f.image.path));
      if(!fs.existsSync(destination)){try{fs.linkSync(f.image.path,destination)}catch{fs.copyFileSync(f.image.path,destination)}}
      const caption=path.join(cache,path.parse(f.image.path).name+d.caption_extension);
      if(!fs.existsSync(caption))fs.writeFileSync(caption,f.caption,'utf8');
    }
    s.image_dir=cache;
  }
  const file=path.join(jobPath,'_moss_dataset.toml'); fs.writeFileSync(file,TOML.stringify(result),'utf8');return file;
}
function parsePrompts(text) {
  const lines=text.split(/\r?\n/).map(s=>s.trim()).filter(s=>s&&!s.startsWith('#'));
  if(!lines.length)throw Error('MOSS sampling requires non-empty prompts');
  return lines.map(line=>{
    const parts=line.split(/\s+--/), prompt=parts.shift(), values={};
    for(const part of parts){const match=part.match(/^(w|h|s|l|d|n)(?:\s+([\s\S]*))?$/);if(!match)throw Error(`Unsupported MOSS prompt option: --${part}`);if(Object.hasOwn(values,match[1]))throw Error('Duplicate prompt option');values[match[1]]=match[2]??'';}
    const result={prompt,negative_prompt:values.n??'',width:Number(values.w??512),height:Number(values.h??512),
      sample_steps:Number(values.s??30),scale:Number(values.l??3),seed:Number(values.d??0)};
    for(const k of ['width','height']) if(!Number.isInteger(result[k])||result[k]<16||result[k]%16)throw Error('MOSS sampling resolution must be a positive multiple of 16');
    if(!Number.isInteger(result.seed)||result.seed<0||!Number.isFinite(result.scale)||result.scale<0||!Number.isInteger(result.sample_steps)||result.sample_steps<1||result.sample_steps>1000)throw Error('Invalid MOSS prompt seed/steps/CFG');
    return result;
  });
}
function snapshot(jobPath,name) {
  const text=fs.readFileSync(path.join(jobPath,'sample_prompts.txt'),'utf8'); const prompts=parsePrompts(text);
  const file=path.join(jobPath,name); fs.writeFileSync(file,JSON.stringify(prompts,null,2),'utf8');return file;
}
function lastState(jobPath) {
  const dir=path.join(jobPath,'output');if(!fs.existsSync(dir))return null;
  return fs.readdirSync(dir).filter(n=>n.endsWith('-state')&&fs.statSync(path.join(dir,n)).isDirectory())
    .map(n=>({path:path.join(dir,n),time:fs.statSync(path.join(dir,n)).mtimeMs})).sort((a,b)=>b.time-a.time)[0]?.path;
}
function tensorboardLogDir(jobPath){return path.join(jobPath,'output','tensorboard');}
function processEnv(gpuIds='0') {const env={...process.env,PYTHONIOENCODING:'utf-8',PYTHONUNBUFFERED:'1',CUDA_VISIBLE_DEVICES:String(gpuIds)};delete env.PYTHONPATH;return env;}
function prepareTraining(c,ds,jobPath,global,native=x=>x,options={}) {
  M.validate(c); M.validateDataset(ds,true);
  const rt=runtime(global,native), models=checkModels(rt,c.moss_arguments.flavour);
  const dataset=prepareDataset(ds,jobPath,models.identities,c,native);
  const t=c.training_arguments,n=c.network_arguments,m=c.moss_arguments;
  const merged={...M.pick(t,M.TRAIN_KEYS),...M.pick(n,M.NETWORK_KEYS),...M.pick(m,M.MODEL_KEYS),
    pretrained_model_name_or_path:models.dit,text_encoder:rt.models.text_encoder,vae:rt.models.vae,dataset_config:dataset,
    output_dir:path.join(jobPath,'output'),logging_dir:tensorboardLogDir(jobPath),save_model_as:'safetensors',
    save_state:true,save_state_on_train_end:true,save_last_n_epochs_state:1,save_last_n_steps_state:1,
    sdpa:true,cache_latents:!!t.cache_latents_to_disk,cache_text_encoder_outputs:!!t.cache_text_encoder_outputs_to_disk};
  delete merged.flavour;delete merged.auto_resume_last_state;
  if(n.network_args)merged.network_args=networkArgs(n.network_args);
  if(rt.tokenizer)merged.tokenizer_cache_dir=rt.tokenizer;
  if(n.network_weights){merged.network_weights=native(n.network_weights);identity(merged.network_weights);merged.dim_from_weights=true;}
  if(n.resume)merged.resume=native(n.resume);else if(n.auto_resume_last_state)merged.resume=lastState(jobPath);
  if(!merged.resume)delete merged.resume;else if(!fs.existsSync(merged.resume)||!fs.statSync(merged.resume).isDirectory())throw Error('MOSS resume state directory not found');
  if(t.sample_every_n_epochs||t.sample_every_n_steps)merged.sample_prompts=snapshot(jobPath,'_moss_sample_prompts.json');
  fs.mkdirSync(merged.output_dir,{recursive:true});fs.mkdirSync(merged.logging_dir,{recursive:true});
  const file=path.join(jobPath,'_moss_config.toml');fs.writeFileSync(file,TOML.stringify(merged),'utf8');
  const stages=[...(options.skipPreflight?[]:[preflightStage()]),{phase:'training',args:['-m','accelerate.commands.launch','--num_processes','1','--num_machines','1','--mixed_precision','bf16','--num_cpu_threads_per_process','1',RUNNER,'train','--config_file',file]}];
  fs.writeFileSync(path.join(jobPath,'_moss_launch.json'),JSON.stringify({revision:REVISION,python:rt.python,cwd:rt.cwd,stages},null,2));
  return {rt,stages,gpuIds:c.gpu_ids||'0',label:'MOSS'};
}
function prepareGeneration(c,jobPath,global,request,native=x=>x,options={}) {
  M.validate(c);const rt=runtime(global,native),models=checkModels(rt,c.moss_arguments.flavour);
  const gpuIds=String(request.gen_gpu_ids||c.gpu_ids||'0');if(!/^\d+$/.test(gpuIds))throw Error('MOSS generation supports one GPU');
  const flow=request.moss_flow_shift??5;
  if(typeof flow!=='number'||!Number.isFinite(flow)||flow<=0)throw Error('Invalid generation flow shift');
  const strength=request.network_mul??1;if(typeof strength!=='number'||!Number.isFinite(strength))throw Error('Invalid adapter strength');
  const spec={dit:models.dit,text_encoder:rt.models.text_encoder,vae:rt.models.vae,tokenizer:rt.tokenizer,
    prompts:JSON.parse(fs.readFileSync(snapshot(jobPath,'_moss_generate_prompts.json'),'utf8')),
    output:path.join(jobPath,'samples'),flow_shift:flow,network_module:c.network_arguments.network_module,
    network_weights:request.network_weights?native(request.network_weights):null,multiplier:strength,
    network_args:Object.fromEntries(networkArgs(c.network_arguments.network_args).filter(x=>x.startsWith('factor=')).map(x=>x.split('='))),
    blocks_to_swap:c.training_arguments.blocks_to_swap??0,...M.pick(c.moss_arguments,['convrot_int8','convrot_int8_text_encoder','moss_max_token_length'])};
  if(spec.network_weights)identity(spec.network_weights);
  fs.mkdirSync(spec.output,{recursive:true});const file=path.join(jobPath,'_moss_generate.json');fs.writeFileSync(file,JSON.stringify(spec,null,2));
  return {rt,gpuIds,label:'MOSS',stages:[...(options.skipPreflight?[]:[preflightStage()]),{phase:'generating',args:[RUNNER,'generate','--spec',file]}]};
}
function pipeline(prepared,options){const job=ownedPipeline(prepared,options);delete job.krea2;job.moss=true;return job;}
module.exports={REVISION,VENDOR,runtime,status,checkpoint,checkModels,prepareDataset,parsePrompts,prepareTraining,prepareGeneration,tensorboardLogDir,processEnv,pipeline};
