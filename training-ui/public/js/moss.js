(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.Moss = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const MODULES = ['networks.lora_generic', 'networks.loha', 'networks.lokr'];
  const TRAIN_KEYS = ['output_name','max_train_epochs','max_train_steps','save_every_n_epochs','save_every_n_steps',
    'sample_every_n_epochs','sample_every_n_steps','learning_rate','optimizer_type','optimizer_args','lr_scheduler',
    'lr_warmup_steps','lr_scheduler_num_cycles','lr_scheduler_min_lr_ratio','mixed_precision','save_precision',
    'max_data_loader_n_workers','persistent_data_loader_workers','gradient_accumulation_steps','max_grad_norm',
    'gradient_checkpointing','blocks_to_swap','block_swap_h2d_only','block_swap_ring_size','use_pinned_memory_for_block_swap',
    'seed','log_with','cpu_offload_checkpointing','unsloth_offload_checkpointing','vae_batch_size',
    'cache_latents_to_disk','cache_text_encoder_outputs_to_disk'];
  const NETWORK_KEYS = ['network_module','network_dim','network_alpha','network_dropout','network_args',
    'network_weights','resume','auto_resume_last_state','network_train_unet_only'];
  const MODEL_KEYS = ['flavour','timestep_sampling','discrete_flow_shift','weighting_scheme','convrot_int8',
    'convrot_int8_text_encoder','text_encoder_batch_size','moss_max_token_length'];
  const TIMESTEPS = ['sigma','uniform','sigmoid','shift','flux_shift'];
  const OPTIMIZERS = ['AdamW8bit','AdamW','Adafactor'];
  const SCHEDULERS = ['constant','linear','cosine','cosine_with_restarts','cosine_with_min_lr','polynomial'];
  const pick = (obj, keys) => Object.fromEntries(keys.filter(k => obj[k] !== undefined).map(k => [k,obj[k]]));
  function defaults() {
    return { architecture:'moss_image', gpu_ids:'0', training_arguments:{ output_name:'my_moss_lora', max_train_epochs:10,
      save_every_n_epochs:1, learning_rate:1e-4, optimizer_type:'AdamW8bit', optimizer_args:['weight_decay=0.01'],
      lr_scheduler:'constant', lr_warmup_steps:0, mixed_precision:'bf16', save_precision:'bf16',
      gradient_checkpointing:true, gradient_accumulation_steps:1, max_grad_norm:1, max_data_loader_n_workers:0,
      persistent_data_loader_workers:false, seed:42, log_with:'tensorboard', blocks_to_swap:20,
      block_swap_h2d_only:true, block_swap_ring_size:2, cache_latents_to_disk:true,
      cache_text_encoder_outputs_to_disk:true, vae_batch_size:1 },
      network_arguments:{network_module:MODULES[0], network_dim:16, network_alpha:16, network_train_unet_only:true},
      moss_arguments:{flavour:'base', timestep_sampling:'shift', discrete_flow_shift:3, weighting_scheme:'uniform',
        convrot_int8:false, convrot_int8_text_encoder:false, text_encoder_batch_size:1, moss_max_token_length:4096} };
  }
  function datasetDefaults() { return {general:{enable_bucket:true,bucket_no_upscale:true,bucket_reso_steps:64,enable_multiline_caption:true},
    datasets:[{resolution:[512,512],batch_size:1,caption_extension:'.txt',subsets:[{image_dir:'',num_repeats:1}]}]}; }
  function keys(obj, allowed, name) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw Error(`${name}: expected object`);
    for (const k of Object.keys(obj)) if (!allowed.includes(k)) throw Error(`MOSS does not support ${name}.${k}`);
  }
  function number(v, name, min, max=Infinity, integer=false) {
    if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max||(integer&&!Number.isInteger(v))) throw Error(`${name}: invalid number (${min}..${max})`);
  }
  function validate(c) {
    keys(c,['architecture','gpu_ids','training_arguments','network_arguments','moss_arguments'],'config');
    if(c.architecture!=='moss_image') throw Error('Expected explicit MOSS architecture');
    if(!/^\d+$/.test(String(c.gpu_ids||'0'))) throw Error('MOSS supports one GPU only');
    const t=c.training_arguments, n=c.network_arguments, m=c.moss_arguments;
    keys(t,TRAIN_KEYS,'training_arguments'); keys(n,NETWORK_KEYS,'network_arguments'); keys(m,MODEL_KEYS,'moss_arguments');
    if(!MODULES.includes(n.network_module)) throw Error('Unsupported MOSS adapter');
    if(n.network_train_unet_only!==true) throw Error('MOSS v1 freezes the text encoder');
    if(t.mixed_precision!=='bf16') throw Error('MOSS requires bf16');
    if(!['base','sft'].includes(m.flavour)) throw Error('Choose MOSS Base or SFT');
    if(!OPTIMIZERS.includes(t.optimizer_type)||!SCHEDULERS.includes(t.lr_scheduler)) throw Error('Unsupported optimizer/scheduler');
    if(!TIMESTEPS.includes(m.timestep_sampling)||!['uniform','sigma_sqrt','cosmap','none'].includes(m.weighting_scheme)) throw Error('Unsupported MOSS timestep/weighting');
    if(typeof t.output_name!=='string'||!t.output_name.trim()||/[\\/:*?"<>|]/.test(t.output_name)||/^\.{1,2}$/.test(t.output_name)) throw Error('Invalid output name');
    number(n.network_dim,'rank',1,4096,true); number(n.network_alpha,'alpha',Number.EPSILON);
    number(t.learning_rate,'learning_rate',Number.EPSILON); number(t.blocks_to_swap??0,'blocks_to_swap',0,40,true);
    if(t.seed!==undefined)number(t.seed,'seed',0,0xffffffff,true);
    if(t.max_grad_norm!==undefined)number(t.max_grad_norm,'max_grad_norm',0);
    if(t.lr_scheduler_num_cycles!==undefined)number(t.lr_scheduler_num_cycles,'cycles',1,Infinity,true);
    if(t.lr_scheduler_min_lr_ratio!==undefined)number(t.lr_scheduler_min_lr_ratio,'min_lr_ratio',0,1);
    if(n.auto_resume_last_state!==undefined&&typeof n.auto_resume_last_state!=='boolean')throw Error('auto_resume_last_state: expected boolean');
    for(const k of ['resume','network_weights'])if(n[k]!==undefined&&typeof n[k]!=='string')throw Error(`${k}: expected path string`);
    if(!t.max_train_epochs&&!t.max_train_steps) throw Error('Training duration required');
    for(const k of ['max_train_epochs','max_train_steps','save_every_n_epochs','save_every_n_steps','sample_every_n_epochs','sample_every_n_steps','gradient_accumulation_steps','vae_batch_size','block_swap_ring_size']) if(t[k]!==undefined) number(t[k],k,1,Infinity,true);
    for(const k of ['max_data_loader_n_workers','lr_warmup_steps']) if(t[k]!==undefined) number(t[k],k,0,Infinity,true);
    for(const k of ['gradient_checkpointing','persistent_data_loader_workers','block_swap_h2d_only','use_pinned_memory_for_block_swap','cpu_offload_checkpointing','unsloth_offload_checkpointing','cache_latents_to_disk','cache_text_encoder_outputs_to_disk']) if(t[k]!==undefined&&typeof t[k]!=='boolean') throw Error(`${k}: expected boolean`);
    for(const k of ['convrot_int8','convrot_int8_text_encoder']) if(m[k]!==undefined&&typeof m[k]!=='boolean') throw Error(`${k}: expected boolean`);
    if(t.persistent_data_loader_workers&&!t.max_data_loader_n_workers) throw Error('Persistent workers require workers > 0');
    const offload=t.cpu_offload_checkpointing||t.unsloth_offload_checkpointing;
    if(offload&&(!t.gradient_checkpointing||t.blocks_to_swap>0)||(t.cpu_offload_checkpointing&&t.unsloth_offload_checkpointing)) throw Error('Activation offload requires checkpointing and excludes Block Swap/other offload');
    if(t.block_swap_h2d_only&&!t.gradient_checkpointing) throw Error('H2D-only requires gradient checkpointing');
    if(t.save_precision&&!['bf16','fp16','float'].includes(t.save_precision)) throw Error('Unsupported save precision');
    if(t.log_with&&t.log_with!=='tensorboard') throw Error('MOSS uses TensorBoard');
    number(m.discrete_flow_shift,'flow shift',Number.EPSILON); number(m.text_encoder_batch_size??1,'TE batch',1,Infinity,true);
    number(m.moss_max_token_length??4096,'token length',1,4096,true);
    if(n.network_dropout!==undefined) number(n.network_dropout,'dropout',0,0.999999);
    const allowed=['rank_dropout','module_dropout','include_patterns','exclude_patterns','verbose',
      ...(n.network_module===MODULES[2]?['factor','full_matrix']:[]), ...(n.network_module===MODULES[0]?['loraplus_lr_ratio']:[])];
    if(n.network_args!==undefined&&!Array.isArray(n.network_args)) throw Error('network_args must be an array');
    const seen=new Set();
    for(const token of n.network_args||[]) {
      if(typeof token!=='string'||!token.includes('=')) throw Error('Invalid network argument');
      const eq=token.indexOf('='), k=token.slice(0,eq).trim(), v=token.slice(eq+1).trim();
      if(!allowed.includes(k)||seen.has(k)) throw Error(`Unsupported or duplicate MOSS argument: ${k}`); seen.add(k);
      if(k.endsWith('dropout')) number(Number(v),k,0,0.999999);
      if(k==='factor'&&(!/^-?\d+$/.test(v)||!Number.isSafeInteger(Number(v))||(Number(v)!==-1&&Number(v)<1))) throw Error('factor must be -1 or positive integer');
      if(['full_matrix','verbose'].includes(k)&&!['true','false'].includes(v.toLowerCase())) throw Error(`${k}: expected boolean`);
      if(k==='loraplus_lr_ratio') number(Number(v),k,Number.EPSILON);
      if(k.endsWith('patterns')) {let a;try{a=JSON.parse(v)}catch{throw Error(`${k}: expected JSON list`)}if(!Array.isArray(a)||a.some(x=>typeof x!=='string'))throw Error(`${k}: expected string list`);}
    }
    if(t.optimizer_args!==undefined&&(!Array.isArray(t.optimizer_args)||t.optimizer_args.some(x=>typeof x!=='string'||!x.includes('=')))) throw Error('Invalid optimizer args');
    if(t.optimizer_type!=='Adafactor'&&(t.optimizer_args||[]).some(x=>/^(relative_step|scale_parameter|warmup_init|clip_threshold|decay_rate|beta1)=/.test(x.trim()))) throw Error('Adafactor arguments cannot be used with AdamW');
    return c;
  }
  function validateDataset(ds, required=false) {
    keys(ds,['general','datasets'],'dataset');
    keys(ds.general||{},['enable_bucket','bucket_no_upscale','bucket_reso_steps','min_bucket_reso','max_bucket_reso','enable_multiline_caption'],'general');
    for(const [k,v] of Object.entries(ds.general||{})) {if(k.includes('reso')){number(v,k,16,Infinity,true);if(v%16)throw Error('Bucket resolutions must be multiples of 16');}else if(typeof v!=='boolean')throw Error(`${k}: expected boolean`);}
    if(!Array.isArray(ds.datasets)||!ds.datasets.length) throw Error('Dataset required');
    for(const d of ds.datasets) {
      keys(d,['resolution','batch_size','caption_extension','subsets'],'dataset');
      const res=Array.isArray(d.resolution)?d.resolution:[d.resolution,d.resolution];
      if(res.length!==2) throw Error('Resolution requires two dimensions');
      for(const v of res){number(v,'resolution',256,Infinity,true);if(v%16)throw Error('Resolution must be multiple of 16');}
      number(d.batch_size,'batch_size',1,Infinity,true);
      if(typeof d.caption_extension!=='string'||!/^\.[a-zA-Z0-9]+$/.test(d.caption_extension))throw Error('Invalid caption extension');
      if(!Array.isArray(d.subsets)||!d.subsets.length)throw Error('Image subset required');
      for(const s of d.subsets){
        keys(s,['image_dir','num_repeats','caption_prefix','caption_suffix','caption_dropout_rate'],'subset');
        if(typeof s.image_dir!=='string'||(required&&!s.image_dir.trim()))throw Error('Image directory required');
        number(s.num_repeats,'num_repeats',1,Infinity,true);
        if(s.caption_dropout_rate!==undefined)number(s.caption_dropout_rate,'caption dropout',0,1);
        for(const key of ['caption_prefix','caption_suffix'])if(s[key]!==undefined&&typeof s[key]!=='string')throw Error(`${key}: expected string`);
      }
    }
    return ds;
  }
  return {MODULES,TRAIN_KEYS,NETWORK_KEYS,MODEL_KEYS,TIMESTEPS,OPTIMIZERS,SCHEDULERS,pick,defaults,datasetDefaults,validate,validateDataset};
});
