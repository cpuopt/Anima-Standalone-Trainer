<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useEditorStore } from '@/stores/editor'
import { api, jobUrl } from '@/services/api'
import Field from '@/components/forms/ConfigField.vue'
import { samplers, schedulers } from './model'
import { parallelMode, section } from '@/features/training/rules'
const store = useEditorStore()
const krea = computed(() => store.architecture === 'krea2')
const moss = computed(() => store.architecture === 'moss_image')
const isolated = computed(() => krea.value || moss.value)
const mossFlow = ref(5)
const training=computed(()=>section(store.config,'training_arguments'))
const samplingSteps=computed(()=>training.value.max_train_steps>0)
const samplingEnabled=computed(()=>!!(training.value.sample_every_n_epochs||training.value.sample_every_n_steps))
const samplingUnsupported=computed(()=>!isolated.value&&parallelMode(training.value)==='tp_sp'&&(String(store.config.gpu_ids||'').trim()?String(store.config.gpu_ids).split(',').filter(Boolean).length:store.gpus.length)>1)
const samplingLocked=computed(()=>store.locked||(isolated.value&&store.running)||samplingUnsupported.value)
function toggleSampling(event:Event){if(samplingLocked.value)return;const on=(event.target as HTMLInputElement).checked;const t=training.value;if(!on){delete t.sample_every_n_epochs;delete t.sample_every_n_steps}else if(samplingSteps.value){t.sample_every_n_steps??=100;delete t.sample_every_n_epochs}else{t.sample_every_n_epochs??=1;delete t.sample_every_n_steps}}
const checkpoints = ref<any[]>([]), busy = ref(false), message = ref('')
const defaults = () => ({lora_mul:1,keep_loaded:false,flash_attn:false,sage_attn:false,global_w:moss.value?512:krea.value?1024:832,global_h:moss.value?512:krea.value?1024:1216,global_s:moss.value?30:krea.value?52:28,global_l:3.5,global_d:0,global_sampler:'euler',global_strength:1,global_scheduler:'linear',selected_lora:'',gen_gpu_ids:store.gpus.length?[Number(store.gpus[0].index)]:[] as number[],gen_multi_gpu_mode:'parallel_cfg'})
const transient = reactive(defaults())
const generation = reactive({base:'turbo',steps:8,cfg:1})
let restored = false, controller: AbortController | null = null
function persist() { if (!restored || !store.name) return; localStorage.setItem(`prompt_transient_${store.name}`, JSON.stringify({...transient,gen_gpu_ids:transient.gen_gpu_ids.join(','),negative_prompt:store.negativePrompt})); localStorage.setItem(`krea2_generation_${store.name}`, JSON.stringify(generation)) }
async function refresh() {
  if (!store.name) return; const name = store.name
  controller?.abort(); controller = new AbortController()
  try { const files = await api<any[]>(jobUrl(name,'/checkpoints'), {signal:controller.signal}); if (store.name === name) { checkpoints.value = files; if (transient.selected_lora && !files.some(f=>f.path===transient.selected_lora)) transient.selected_lora='' } }
  catch(e:any) { if(e.name!=='AbortError') message.value=e.message }
}
watch(() => store.name, () => {
  restored = false; controller?.abort(); checkpoints.value=[]; message.value=''
  Object.assign(transient,defaults()); Object.assign(generation,{base:'turbo',steps:8,cfg:1})
  if (store.name) { try { const saved=JSON.parse(localStorage.getItem(`prompt_transient_${store.name}`)||'null'); if(saved) Object.assign(transient,saved); const g=JSON.parse(localStorage.getItem(`krea2_generation_${store.name}`)||'null'); if(g)Object.assign(generation,g) }catch{} }
  if(!Array.isArray(transient.gen_gpu_ids)) transient.gen_gpu_ids=String(transient.gen_gpu_ids).split(',').filter(Boolean).map(Number)
  if(isolated.value) transient.gen_gpu_ids=transient.gen_gpu_ids.slice(0,1)
  restored=true; void refresh()
}, {immediate:true})
watch([transient,generation,()=>store.negativePrompt],persist,{deep:true})
onBeforeUnmount(()=>{persist();controller?.abort()})
function gpu(id:number) { const selected=transient.gen_gpu_ids.includes(id); transient.gen_gpu_ids=isolated.value?(selected?[]:[id]):selected?transient.gen_gpu_ids.filter(x=>x!==id):[...transient.gen_gpu_ids,id] }
function newPrompt() {return {text:'',w:Number(transient.global_w),h:Number(transient.global_h),s:Number(transient.global_s),l:Number(transient.global_l),d:moss.value?Number(transient.global_d):Number(transient.global_d)||Math.floor(Math.random()*99999)+1,sampler:transient.global_sampler,strength:Number(transient.global_strength),scheduler:transient.global_scheduler,skip:false}}
function applyAll(){ for(const p of store.prompts) Object.assign(p,{...newPrompt(),text:p.text,skip:p.skip}); message.value='已应用到所有提示词' }
function move(i:number,delta:number){ const target=i+delta; if(target<0||target>=store.prompts.length)return; const [item]=store.prompts.splice(i,1);store.prompts.splice(target,0,item) }
async function generate(){
  if(!store.name)return; const name=store.name; busy.value=true;message.value=''
  try {
    if(!store.prompts.some(p=>p.text?.trim()))throw Error('请先添加非空提示词')
    persist(); await store.save(); if(store.name!==name)return
    const payload:any={gen_gpu_ids:transient.gen_gpu_ids.join(',')}
    if(transient.selected_lora){payload.network_weights=transient.selected_lora;payload.network_mul=Number(transient.lora_mul)}
    if(krea.value)Object.assign(payload,{krea2_base:generation.base,krea2_steps:Number(generation.steps),krea2_cfg:Number(generation.cfg)})
    else if(moss.value) Object.assign(payload,{moss_flow_shift:mossFlow.value})
    else Object.assign(payload,{flow_shift:Number(store.config.anima_arguments?.discrete_flow_shift??3),flash_attn:transient.flash_attn,sage_attn:transient.sage_attn,keep_loaded:transient.keep_loaded,gen_multi_gpu_mode:transient.gen_multi_gpu_mode})
    const result=await api(jobUrl(name,'/generate'),{method:'POST',body:payload});if(result.error)throw Error(result.error);if(store.name===name){store.running=true;message.value='已启动独立采样';try{await store.refreshStatus()}catch(e:any){throw Error(`采样已启动，但状态刷新失败：${e.message}`)}store.runtimeTick++}
  }catch(e:any){if(store.name===name)message.value=e.message}finally{busy.value=false}
}
async function unload(){if(!store.name)return;try{const r=await api(jobUrl(store.name,'/unload'),{method:'POST'});message.value=r.error||r.message||'模型已卸载'}catch(e:any){message.value=e.message}}
</script>
<template>
  <section class="space-y-6">
    <div class="rounded-lg border p-4 space-y-3"><h2 class="font-semibold">训练中采样</h2><label class="flex items-center gap-2"><input type="checkbox" :checked="samplingEnabled && !samplingUnsupported" :disabled="samplingLocked" @change="toggleSampling"/>启用训练中采样</label><p v-if="samplingUnsupported" class="text-sm text-muted-foreground">TP/SP 多 GPU 训练不支持训练中采样。</p><Field v-if="samplingEnabled && !samplingUnsupported" :object="training" :field="samplingSteps?'sample_every_n_steps':'sample_every_n_epochs'" :label="samplingSteps?'每 N steps 采样':'每 N epochs 采样'" type="number" :min="1" :step="1" :fallback="samplingSteps?100:1" :disabled="samplingLocked"/></div>
    <div class="rounded-lg border p-4 space-y-4">
      <h2 class="font-semibold">独立采样</h2>
      <div class="flex gap-2"><select v-model="transient.selected_lora" class="flex-1 rounded border bg-background p-2"><option value="">Base Model（无适配器）</option><option v-for="file in checkpoints" :key="file.path" :value="file.path">{{file.name}} · {{new Date(file.mtime).toLocaleString()}}</option></select><button class="btn" @click="refresh">刷新权重</button></div>
      <div class="grid gap-4 md:grid-cols-3">
        <Field :object="transient" field="lora_mul" label="适配器强度" type="number" :step="0.1" />
        <template v-if="krea"><Field :object="generation" field="base" label="采样底模" type="select" :options="['turbo','raw']"/><Field :object="generation" field="steps" label="独立采样步数" type="number" :min="1" :max="1000"/><Field :object="generation" field="cfg" label="独立采样 CFG" type="number" :min="1" :step="0.5"/></template>
        <template v-else-if="!moss"><Field :object="transient" field="flash_attn" label="Flash Attention" type="boolean" @change="value=>{if(value)transient.sage_attn=false}"/><Field :object="transient" field="sage_attn" label="Sage Attention" type="boolean" @change="value=>{if(value)transient.flash_attn=false}"/><Field :object="transient" field="keep_loaded" label="保持模型加载" type="boolean"/></template>
      </div>
      <Field v-if="moss" :object="{value:mossFlow}" field="value" label="MOSS Generation Flow Shift" type="number" :min="0.01" :step="0.1" @change="mossFlow=Number($event)"/>
      <p v-if="moss" class="muted">独立出图使用当前任务 Base/SFT、卡片的宽高、步数、CFG、种子。种子 0 为固定种子；不保持模型常驻。</p>
      <p v-if="krea" class="text-sm text-muted-foreground">RAW / Turbo 参数仅用于独立采样；提示词卡片中的步数和 CFG 用于 RAW 训练预览。</p>
      <div class="flex flex-wrap gap-2"><button v-for="g in store.gpus" :key="g.index" class="rounded border px-3 py-2" :class="transient.gen_gpu_ids.includes(g.index)?'bg-primary text-primary-foreground':''" @click="gpu(g.index)">GPU {{g.index}} · {{g.name}}</button></div>
      <Field v-if="!isolated && transient.gen_gpu_ids.length>1" :object="transient" field="gen_multi_gpu_mode" label="多 GPU 模式" type="select" :options="['parallel_cfg','sharding']"/>
      <div class="flex gap-2"><button class="btn bg-primary text-primary-foreground" :disabled="busy || store.running" @click="generate">{{busy?'启动中…':'保存并生成'}}</button><button v-if="!isolated" class="btn" :disabled="busy" @click="unload">卸载采样模型</button></div>
      <p v-if="message" role="status" class="text-sm">{{message}}</p>
    </div>
    <div class="flex items-center justify-between"><h2 class="font-semibold">训练采样提示词</h2><button class="btn" @click="store.prompts.push(newPrompt())">添加提示词</button></div>
    <label class="block space-y-2"><span>负面提示词</span><textarea v-model="store.negativePrompt" rows="3" class="w-full rounded border bg-background p-2"/></label>
    <div class="rounded border p-4 grid gap-3 md:grid-cols-4">
      <Field v-for="[key,label] in [['global_w','宽度'],['global_h','高度'],['global_s','步数'],['global_l','CFG'],['global_d','种子（0随机）']]" :key="key" :object="transient" :field="key!" :label="key==='global_d' && moss ? '种子（0固定）' : label!" type="number"/>
      <template v-if="!isolated"><Field :object="transient" field="global_sampler" label="Sampler" type="select" :options="samplers"/><Field :object="transient" field="global_strength" label="强度" type="number" :min="0" :max="2" :step="0.05"/><Field :object="transient" field="global_scheduler" label="Scheduler" type="select" :options="schedulers"/></template>
      <button class="btn" @click="applyAll">应用到所有卡片</button>
    </div>
    <p v-if="!store.prompts.length" class="text-muted-foreground">暂无提示词。</p>
    <article v-for="(p,i) in store.prompts" :key="i" class="rounded-lg border p-4 space-y-3" :class="p.skip?'opacity-60':''">
      <div class="flex gap-2 items-center"><span class="mr-auto">#{{i+1}}</span><label v-if="!isolated"><input v-model="p.skip" type="checkbox"/> 跳过</label><button class="btn" :disabled="i===0" @click="move(i,-1)">上移</button><button class="btn" :disabled="i===store.prompts.length-1" @click="move(i,1)">下移</button><button class="btn" @click="store.prompts.splice(i,1)">删除</button></div>
      <textarea v-model="p.text" rows="3" placeholder="提示词" class="w-full rounded border bg-background p-2"/>
      <div class="grid gap-3 md:grid-cols-5"><Field v-for="[key,label] in [['w','宽度'],['h','高度'],['s','步数'],['l','CFG'],['d','种子']]" :key="key" :object="p" :field="key!" :label="key==='global_d' && moss ? '种子（0固定）' : label!" type="number"/><template v-if="!isolated"><Field :object="p" field="sampler" label="Sampler" type="select" :options="samplers"/><Field :object="p" field="strength" label="强度" type="number" :min="0" :max="2" :step="0.05"/><Field :object="p" field="scheduler" label="Scheduler" type="select" :options="schedulers"/></template></div>
    </article>
  </section>
</template>
