<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useEditorStore } from '@/stores/editor'
import { api, jobUrl } from '@/services/api'
import Field from '@/components/forms/ConfigField.vue'
import EnvironmentPanel from './EnvironmentPanel.vue'
import { LBAI } from '@/domain/legacy'
const store=useEditorStore(), message=ref(''), busy=ref(false), environment=ref(''), preview=ref<HTMLElement|null>(null)
const mossEnvironment=ref('')
const arches=computed(()=>Object.entries(store.registry?.architectures||{}) as [string,any][])
// Missing sections stay absent until the user actually edits them.
const emptyUi=reactive<Record<string,any>>({}), emptyPaths=reactive<Record<string,any>>({})
const defaultTargets=ref<any[]>(LBAI.defaultTargets())
const ui=computed(()=>store.globalConfig.ui||emptyUi)
const paths=computed(()=>store.globalConfig.model_paths||emptyPaths)
const targets=computed(()=>ui.value.lbai_targets||defaultTargets.value)
watch(emptyUi,value=>{if(!store.globalConfig.ui)store.globalConfig.ui={...value}},{deep:true})
watch(emptyPaths,value=>{if(!store.globalConfig.model_paths)store.globalConfig.model_paths={...value}},{deep:true})
watch(defaultTargets,value=>{if(!ui.value.lbai_targets)ui.value.lbai_targets=JSON.parse(JSON.stringify(value))},{deep:true})
let dragging=false, controller:AbortController|null=null
async function commitGlobal(){if(!store.globalConfig.ui&&Object.keys(emptyUi).length)store.globalConfig.ui={...emptyUi};if(!store.globalConfig.model_paths&&Object.keys(emptyPaths).length)store.globalConfig.model_paths={...emptyPaths};await store.saveGlobal()}
async function run(action:()=>Promise<void>){busy.value=true;message.value='';try{await action()}catch(e:any){message.value=e.message}finally{busy.value=false}}
async function maintain(action:'open-folder'|'clear-logs'|'reset-config'){
  const name=store.name;if(!name)return
  if(action==='clear-logs'&&!window.confirm(`删除任务“${name}”的所有 TensorBoard 日志？此操作不可恢复。`))return
  if(action==='reset-config'&&!window.confirm(`将任务“${name}”的配置恢复为模板默认值？${store.dirty?'当前未保存的配置、数据集和提示词编辑将被丢弃。':''}此操作会覆盖已保存的配置。`))return
  await run(async()=>{await api(jobUrl(name,`/${action}`),{method:'POST'});if(store.name!==name)return;if(action==='reset-config'){await store.selectJob(name);message.value='配置已重置并重新读取'}else message.value=action==='clear-logs'?'TensorBoard 日志已清理':'已请求打开任务目录'})
}
async function save(){await run(async()=>{
  for(const [i,t] of targets.value.entries()) {
    if(!t.name?.trim())throw Error(`目标 ${i+1} 需要名称`)
    const vals=t.type==='point'?[t.value]:[t.min,t.max]
    if(vals.some((v:any)=>v===''||v==null||!Number.isFinite(Number(v))||Number(v)<0))throw Error(`${t.name}: 请填写非负数值`)
    if(t.type!=='point'&&Number(t.min)>Number(t.max))throw Error(`${t.name}: 下限不能大于上限`)
  }
  ui.value.lbai_targets=LBAI.normalizeTargets(targets.value,false);await commitGlobal();message.value='全局设置已保存'
})}
async function syncEnvironmentPaths(){const cfg=await api('/api/global-config');for(const key of ['main_venv_path','anima_lumina_venv_path','krea2_venv_path','moss_venv_path'])if(cfg[key]!==undefined)store.globalConfig[key]=cfg[key]}
function sync(arch:any){const source=paths.value[arch.all_in_one_source_key]; if(source)for(const key of Object.keys(arch.global_paths))paths.value[key]=source}
async function upload(event:Event){const file=(event.target as HTMLInputElement).files?.[0];if(!file)return;await run(async()=>{const image=await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=()=>reject(Error('读取图片失败'));r.readAsDataURL(file)});const result=await api('/api/global/background',{method:'POST',body:{image}});if(!result.success)throw Error(result.error||'上传失败');ui.value.background=result.url;await commitGlobal();message.value='背景已上传并保存'})}
async function removeBackground(){await run(async()=>{await api('/api/global/background',{method:'DELETE'});delete ui.value.background;await store.saveGlobal();message.value='背景已移除'})}
function position(e:PointerEvent){if(!dragging||!preview.value)return;const rect=preview.value.getBoundingClientRect();ui.value.background_position=`${Math.max(0,Math.min(100,(e.clientX-rect.left)/rect.width*100)).toFixed(1)}% ${Math.max(0,Math.min(100,(e.clientY-rect.top)/rect.height*100)).toFixed(1)}%`}
function down(e:PointerEvent){dragging=true;preview.value?.setPointerCapture(e.pointerId);position(e)}
function background(){const v=ui.value; localStorage.setItem('ui_theme',v.theme||'github-dark');localStorage.setItem('ui_background',JSON.stringify({url:v.background||'',position:v.background_position||'50% 50%',dim:v.dim_level??70,brightness:v.brightness_level??100,blur:v.blur_level??10,textShadow:v.text_shadow_size??0}));document.documentElement.setAttribute('data-theme',v.theme||'github-dark');document.documentElement.classList.toggle('dark',v.theme!=='github-light')}
watch(ui,background,{deep:true})
onMounted(async()=>{controller=new AbortController();try{const r=await api('/api/backends/krea2/status',{signal:controller.signal});environment.value=r.installed?'Python 环境已找到；训练前会继续检查依赖与 CUDA。':'请运行 setup_krea2.bat 或 setup_krea2.sh 安装隔离环境。'}catch(e:any){if(e.name!=='AbortError')environment.value=e.message}})
onMounted(async()=>{try{const r=await api('/api/backends/moss_image/status');mossEnvironment.value=r.dependencies?`依赖已验证；CUDA: ${r.cuda}`:r.error||'请运行 setup_moss.bat / setup_moss.sh 安装隔离环境。'}catch(e:any){mossEnvironment.value=e.message}})
onBeforeUnmount(()=>controller?.abort())
</script>
<template>
  <section class="space-y-6">
    <div class="flex gap-3 items-center"><h2 class="font-semibold mr-auto">全局设置</h2><span v-if="message" role="status" class="text-sm">{{message}}</span><button class="btn bg-primary text-primary-foreground" :disabled="busy" @click="save">{{busy?'保存中…':'保存全局设置'}}</button></div>
    <EnvironmentPanel @changed="syncEnvironmentPaths"/><section v-if="store.name" class="rounded-lg border p-4 space-y-3"><h3 class="font-semibold">任务维护 · {{store.name}}</h3><div class="flex gap-2 flex-wrap"><button class="btn" :disabled="busy" @click="maintain('open-folder')">打开任务目录</button><button class="btn" :disabled="busy || store.running" @click="maintain('clear-logs')">清理 TensorBoard 日志</button><button class="btn text-destructive" :disabled="busy || store.running" @click="maintain('reset-config')">恢复模板默认配置</button></div><p class="text-sm text-muted-foreground">运行时暂停日志清理和重置。恢复默认配置会重新读取任务，并丢弃尚未保存的任务编辑。</p></section>
    <section v-for="[id,arch] in arches" :key="id" class="rounded-lg border p-4 space-y-4"><h3 class="font-semibold">{{arch.display_name}} 模型路径</h3><Field v-for="(def,key) in arch.global_paths" :key="key" :object="paths" :field="String(key)" :label="(def as any).label" type="text" :help="(def as any).placeholder"/><button v-if="arch.all_in_one && arch.all_in_one_source_key" class="btn" @click="sync(arch)">将首个路径用作 All-in-One 权重</button><template v-if="id==='krea2'"><Field :object="store.globalConfig" field="krea2_venv_path" label="Krea 2 Python 环境" help="安装后自动更新路径；旧默认：项目目录 / venv-krea2"/><p class="text-sm text-muted-foreground">{{environment}}</p></template><template v-if="id==='moss_image'"><Field :object="store.globalConfig" field="moss_venv_path" label="MOSS Python 环境" help="安装后自动更新路径；旧默认：项目目录 / venv-moss"/><p class="text-sm text-muted-foreground">{{mossEnvironment}}</p></template></section>
    <section class="rounded-lg border p-4 space-y-4"><h3 class="font-semibold">Anima / Lumina 共享训练环境</h3><Field :object="store.globalConfig" field="anima_lumina_venv_path" label="Anima / Lumina Python 环境" help="默认：项目目录 / venv-anima-lumina；安装：setup_anima_lumina.bat 或 .sh。旧版显式 venv_path 仍可回退使用。"/></section><section class="rounded-lg border p-4 space-y-4"><h3 class="font-semibold">应用</h3><Field :object="store.globalConfig" field="main_venv_path" label="主环境（轻量控制）路径" help="安装管理自动维护；不得指向模型环境"/><Field :object="ui" field="log_language" label="训练日志语言" type="select" :fallback="'zh_CN'" :options="[{value:'zh_CN',label:'中文'},{value:'en',label:'English'},{value:'ja',label:'日本語'}]"/><Field :object="ui" field="theme" label="主题" type="select" fallback="github-dark" :options="['github-dark','github-light','midnight-blue','cherry-pink']"/>
      <div class="space-y-3"><label class="block">背景图片 <input type="file" accept="image/*" :disabled="busy" @change="upload"/></label><button v-if="ui.background" class="btn" @click="removeBackground">移除背景</button><template v-if="ui.background"><div ref="preview" class="h-48 rounded border relative touch-none cursor-crosshair overflow-hidden" :style="{backgroundImage:`url(${JSON.stringify(ui.background)})`,backgroundSize:'cover',backgroundPosition:ui.background_position||'50% 50%'}" @pointerdown="down" @pointermove="position" @pointerup="dragging=false" @pointercancel="dragging=false"><span class="absolute text-white" :style="{left:(ui.background_position||'50% 50%').split(' ')[0],top:(ui.background_position||'50% 50%').split(' ')[1]}">⊕</span></div><p class="text-sm text-muted-foreground">拖动调整背景焦点位置。</p><Field :object="ui" field="background_position" label="焦点位置" fallback="50% 50%"/><Field v-for="[key,label,fallback] in [['dim_level','遮罩强度 (%)',70],['brightness_level','亮度 (%)',100],['blur_level','模糊 (px)',10],['text_shadow_size','文字阴影 (px)',0]]" :key="String(key)" :object="ui" :field="String(key)" :label="String(label)" type="number" :fallback="fallback" :min="0"/></template></div>
    </section>
    <section class="rounded-lg border p-4 space-y-4"><div class="flex items-center gap-2"><h3 class="font-semibold mr-auto">训练估算目标 (LBAI)</h3><button class="btn" @click="targets.push({name:'新目标',type:'range',min:0,max:1,color:'#60a5fa'})">添加目标</button><button class="btn" @click="ui.lbai_targets=LBAI.defaultTargets()">恢复默认</button></div><p class="text-sm text-muted-foreground">目标仅影响训练程度刻度，支持范围或单点；在全局保存后生效。</p><div v-for="(target,i) in targets" :key="i" class="rounded border p-3 grid gap-3 md:grid-cols-3"><Field :object="target" field="name" label="名称"/><Field :object="target" field="type" label="类型" type="select" :options="['range','point']"/><label class="space-y-2">颜色<input v-model="target.color" type="color" class="block"/></label><Field v-if="target.type==='point'" :object="target" field="value" label="点值" type="number" :min="0"/><template v-else><Field :object="target" field="min" label="下限" type="number" :min="0"/><Field :object="target" field="max" label="上限" type="number" :min="0"/></template><button class="btn" @click="targets.splice(i,1)">删除目标</button></div></section>
  </section>
</template>
