/* Legacy interface uses the same schema/validation as Vue and the server. */
const MossUI = (() => {
  const $ = id => document.getElementById(id);
  let state, data;
  function field(parent, object, key, label, type='number', choices) {
    const group=document.createElement('div');group.className='form-group';
    const caption=document.createElement('label');caption.textContent=label;group.appendChild(caption);
    const input=document.createElement(type==='json'?'textarea':choices?'select':'input');input.id=`moss-${key}-${parent.childElementCount}`;
    if(choices) for(const value of choices)input.appendChild(new Option(value,value));
    else if(type!=='json'){input.type=type; if(type==='number')input.step='any';}
    if(type==='checkbox')input.checked=!!object[key];
    else input.value=type==='json'?JSON.stringify(object[key]||[],null,2):object[key]??'';
    input.addEventListener('input',()=>{
      input.setCustomValidity('');
      try {
        if(type==='checkbox')object[key]=input.checked;
        else if(type==='json')object[key]=JSON.parse(input.value);
        else if(type==='number'){if(input.value==='')delete object[key];else object[key]=Number(input.value);}
        else object[key]=input.value;
      } catch {input.setCustomValidity('Invalid JSON');}
    });
    group.appendChild(input);parent.appendChild(group);return input;
  }
  function panel(tab,title) {
    let el=$(tab).querySelector('.moss-panel');if(!el){el=document.createElement('fieldset');el.className='moss-panel';$(tab).prepend(el);}
    el.replaceChildren();const h=document.createElement('h3');h.textContent=title;el.appendChild(h);return el;
  }
  function training() {
    const el=panel('tab-training','MOSS-Image · sd-scripts v0.12.2'),t=state.training_arguments,m=state.moss_arguments;
    field(el,m,'flavour','Model flavour','text',['base','sft']);
    field(el,t,'output_name','Output name','text');
    const duration={unit:t.max_train_steps?'steps':'epochs'};
    const radio=document.querySelector(`input[name="duration-unit"][value="${duration.unit}"]`);
    if(radio){radio.checked=true;radio.dispatchEvent(new Event('change'));}
    $('container-sample-every-epochs').classList.toggle('hidden',duration.unit==='steps');
    $('container-sample-every-steps').classList.toggle('hidden',duration.unit!=='steps');
    const unit=field(el,duration,'unit','Duration unit','text',['epochs','steps']);
    unit.addEventListener('change',()=>{if(duration.unit==='steps'){t.max_train_steps??=1000;t.save_every_n_steps??=500;delete t.max_train_epochs;delete t.save_every_n_epochs;}else{t.max_train_epochs??=10;t.save_every_n_epochs??=1;delete t.max_train_steps;delete t.save_every_n_steps;}training();});
    field(el,t,duration.unit==='steps'?'max_train_steps':'max_train_epochs','Training duration');
    field(el,t,duration.unit==='steps'?'save_every_n_steps':'save_every_n_epochs','Save every N');
    for(const key of ['learning_rate','lr_warmup_steps','seed','gradient_accumulation_steps','max_grad_norm','max_data_loader_n_workers','vae_batch_size','blocks_to_swap','block_swap_ring_size'])field(el,t,key,key);
    field(el,t,'optimizer_type','Optimizer','text',Moss.OPTIMIZERS);
    field(el,t,'optimizer_args','Optimizer args (JSON array)','json');
    field(el,t,'lr_scheduler','Scheduler','text',Moss.SCHEDULERS);
    field(el,t,'save_precision','Save precision','text',['bf16','fp16','float']);
    for(const key of ['gradient_checkpointing','block_swap_h2d_only','use_pinned_memory_for_block_swap','cache_latents_to_disk','cache_text_encoder_outputs_to_disk','cpu_offload_checkpointing','unsloth_offload_checkpointing'])field(el,t,key,key,'checkbox');
    field(el,m,'timestep_sampling','Timestep sampling','text',Moss.TIMESTEPS);
    field(el,m,'discrete_flow_shift','Training flow shift');
    field(el,m,'weighting_scheme','Loss weighting','text',['uniform','none','sigma_sqrt','cosmap']);
    for(const key of ['convrot_int8','convrot_int8_text_encoder'])field(el,m,key,key,'checkbox');
    for(const key of ['text_encoder_batch_size','moss_max_token_length'])field(el,m,key,key);
    const heading=document.createElement('h3');heading.textContent='编译与 CUDA 加速';el.appendChild(heading);
    field(el,t,'compile','启用 torch.compile（按 DiT Block）','checkbox');
    field(el,t,'compile_backend','Compile Backend','text',Moss.COMPILE_BACKENDS);
    field(el,t,'compile_mode','Compile Mode','text',Moss.COMPILE_MODES);
    field(el,t,'compile_dynamic','Compile Dynamic Shapes','text',Moss.COMPILE_DYNAMIC);
    field(el,t,'compile_cache_size_limit','Compile Cache Size Limit');
    for(const key of ['compile_fullgraph','cuda_allow_tf32','cuda_cudnn_benchmark'])field(el,t,key,key,'checkbox');
    const compileNote=document.createElement('p');compileNote.textContent='推荐 inductor / default / auto；其他 Backend 仅用于诊断且 Mode 必须为 default。首次编译和新尺寸需要预热，可能增加显存，不保证加速。INT8 / Block Swap 会排除对应 Linear 层。CUDA 开关独立生效。Linux 需要 Triton 和 C/C++ 编译器；Windows dynamic=true 需要 VS 2022 C++。';el.appendChild(compileNote);
    const note=document.createElement('p');note.textContent='BF16, single GPU, frozen text encoder. Activation offload excludes Block Swap. H2D-only requires gradient checkpointing. No FP8 support.';el.appendChild(note);
  }
  function network() {
    const el=panel('tab-network','MOSS Adapter'),n=state.network_arguments;
    const module=field(el,n,'network_module','Adapter','text',Moss.MODULES);
    module.addEventListener('change',()=>{const allowed=n.network_module===Moss.MODULES[2]?['factor','full_matrix']:n.network_module===Moss.MODULES[0]?['loraplus_lr_ratio']:[];n.network_args=(n.network_args||[]).filter(x=>!['factor','full_matrix','loraplus_lr_ratio'].includes(x.split('=')[0])||allowed.includes(x.split('=')[0]));network();});
    for(const key of ['network_dim','network_alpha','network_dropout'])field(el,n,key,key);
    if(n.network_module===Moss.MODULES[2]) {
      const args=Object.fromEntries((n.network_args||[]).map(x=>x.split('=')));
      const controls={factor:args.factor===undefined?undefined:Number(args.factor),full_matrix:args.full_matrix?.toLowerCase()==='true'};
      const factor=field(el,controls,'factor','LoKR Factor (-1 = auto)');
      const full=field(el,controls,'full_matrix','LoKR Full Matrix','checkbox');
      for(const input of [factor,full])input.addEventListener('change',()=>{n.network_args=(n.network_args||[]).filter(x=>!x.startsWith('factor=')&&!x.startsWith('full_matrix='));if(controls.factor!==undefined)n.network_args.push(`factor=${controls.factor}`);if(controls.full_matrix)n.network_args.push('full_matrix=true');});
    }
    field(el,n,'network_args','Network args (JSON array; whitelist validated on save)','json');
    for(const key of ['network_weights','resume'])field(el,n,key,key,'text');
    field(el,n,'auto_resume_last_state','Auto resume latest state','checkbox');
  }
  function dataset() {
    const el=panel('tab-dataset','MOSS Dataset (isolated cache snapshots)');
    for(const key of ['enable_bucket','bucket_no_upscale','enable_multiline_caption'])field(el,data.general,key,key,'checkbox');
    field(el,data.general,'bucket_reso_steps','Bucket steps (multiple of 16)');
    data.datasets.forEach((d,i)=>{
      const card=document.createElement('fieldset');el.appendChild(card);
      const legend=document.createElement('legend');legend.textContent=`Dataset ${i+1}`;card.appendChild(legend);
      field(card,d,'resolution','Resolution [width,height]','json');field(card,d,'batch_size','Batch size');field(card,d,'caption_extension','Caption extension','text');
      d.subsets.forEach((s,j)=>{
        const sub=document.createElement('fieldset');card.appendChild(sub);
        for(const key of ['image_dir','caption_prefix','caption_suffix'])field(sub,s,key,key,'text');
        field(sub,s,'num_repeats','Repeats');field(sub,s,'caption_dropout_rate','Caption dropout');
        button(sub,'Remove subset',()=>{if(d.subsets.length>1){d.subsets.splice(j,1);dataset();}});
      });
      button(card,'Add subset',()=>{d.subsets.push({image_dir:'',num_repeats:1});dataset();});
      button(card,'Remove dataset',()=>{if(data.datasets.length>1){data.datasets.splice(i,1);dataset();}});
    });
    button(el,'Add dataset',()=>{data.datasets.push(Moss.datasetDefaults().datasets[0]);dataset();});
  }
  function button(parent,label,fn){const b=document.createElement('button');b.type='button';b.className='btn btn-secondary';b.textContent=label;b.onclick=fn;parent.appendChild(b);}
  function populate(config,ds) {
    document.body.classList.toggle('moss-mode',config.architecture==='moss_image');
    if(config.architecture!=='moss_image')return;
    state=structuredClone(config);data=structuredClone(ds||Moss.datasetDefaults());training();network();dataset();
    const el=panel('tab-multigpu','MOSS GPU allocation');field(el,state,'gpu_ids','Single GPU ID','text');
    $('global-w').value=512;$('global-h').value=512;$('global-s').value=30;$('global-l').value=3;$('global-negative-prompt').value='';
    let flow=$('moss-generation');if(!flow){flow=document.createElement('div');flow.id='moss-generation';flow.className='form-group';$('tab-prompts').prepend(flow);flow.innerHTML='<label>MOSS generation flow shift</label><input id="moss-gen-flow" type="number" value="5" step="0.1" min="0.01"><small>Uses card steps, CFG, dimensions and fixed seed (including 0). Model is released after generation.</small>';}
    for(const id of ['global-sampler','global-scheduler','global-strength','gen-flash-attn','gen-sage-attn','chk-keep-loaded','btn-unload-model','gen-multi-gpu-options','gen-gpu-selection']) {
      const element=$(id);if(element)(element.closest('.form-group, .checkbox-group')||element).setAttribute('data-moss-hide','');
    }
  }
  function config() {
    for(const input of document.querySelectorAll('.moss-panel input, .moss-panel textarea'))if(!input.checkValidity())throw Error(input.validationMessage);
    const c=structuredClone(state),t=c.training_arguments;
    delete t.sample_every_n_epochs;delete t.sample_every_n_steps;
    if($('cfg-enable-sampling').checked){const steps=!!t.max_train_steps;t[steps?'sample_every_n_steps':'sample_every_n_epochs']=Number($(steps?'cfg-sample-every-steps':'cfg-sample-every').value);}
    return c;
  }
  function generation(payload){return {...payload,moss_flow_shift:Number($('moss-gen-flow').value),gen_gpu_ids:state.gpu_ids||'0'};}
  return {populate,setDataset:ds=>{data=structuredClone(ds);dataset();},config,datasetValue:()=>structuredClone(data),networkArgs:()=>state?.network_arguments.network_args||[],generation};
})();
