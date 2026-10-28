<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, nextTick } from 'vue'
import { api } from '@/services/api'
const emit=defineEmits<{changed:[]}>()
const data=ref<any>({environments:[],history:[]}), task=ref<any>(null), logs=ref(''), error=ref(''), follow=ref(true), output=ref<HTMLElement|null>(null), pending=ref(false)
const cuda=ref('cu128')
let timer:ReturnType<typeof setTimeout>|undefined, stopped=false, cursor=0, decoder=new TextDecoder(), taskId='', notified='', profileLoaded=false
const labels:Record<string,string>={missing:'未安装',invalid:'依赖异常',ready:'验证通过','no-cuda':'依赖可用，CUDA 不可用',running:'运行中',stopping:'停止中',completed:'已完成',failed:'失败',stopped:'已停止',interrupted:'已中断'}
const tritonLabels:Record<string,string>={missing:'未安装（可选依赖）',broken:'导入失败',importable:'可导入（未验证 GPU 编译）'}
async function refresh(){data.value=await api('/api/environments');if(!profileLoaded&&data.value.environments){cuda.value=data.value.environments.find((e:any)=>e.id==='krea2')?.cuda_profile||'cu128';profileLoaded=true}if(data.value.task&&data.value.task.id!==taskId){taskId=data.value.task.id;cursor=0;logs.value='';decoder=new TextDecoder()}task.value=data.value.task;return data.value}
async function poll(){
  try{
    await refresh()
    if(taskId){
      let r:any
      do{
        r=await api(`/api/environment-tasks/${taskId}?after=${cursor}`)
        const bytes=Uint8Array.from(atob(r.output||''),c=>c.charCodeAt(0))
        logs.value+=decoder.decode(bytes,{stream:true});cursor=r.cursor
        // Bound browser rendering without changing the persisted download.
        if(logs.value.length>1000000)logs.value='[仅显示最近日志；完整内容可下载]\n'+logs.value.slice(-800000)
      }while(r.hasMore&&!stopped)
      task.value=r
      if(notified!==r.id&&!['running','stopping'].includes(r.status)){notified=r.id;await refresh();emit('changed')}
      if(follow.value){await nextTick();output.value?.scrollTo({top:output.value.scrollHeight})}
    }
    error.value=''
  }catch(e:any){error.value=e.message}
  finally{if(!stopped)timer=setTimeout(poll,1500)}
}
async function start(id:string,action:string){
  if(action==='install'&&!window.confirm('将在新目录安装并验证，成功后切换路径；旧环境保留占用空间。请先保存其他全局设置。继续？'))return
  pending.value=true;error.value=''
  try{const r=await api(`/api/environments/${id}/${action}`,{method:'POST',body:id==='krea2'?{cuda:cuda.value}:{}});taskId=r.id;cursor=0;logs.value='';decoder=new TextDecoder();task.value=r;await refresh()}
  catch(e:any){error.value=e.message}finally{pending.value=false}
}
async function stop(){try{task.value=await api(`/api/environment-tasks/${taskId}/stop`,{method:'POST'})}catch(e:any){error.value=e.message}}
async function copy(){try{await navigator.clipboard.writeText(logs.value)}catch(e:any){error.value=e.message}}
async function cleanup(item:any){
  if(!window.confirm(`永久删除旧环境：\n${item.path}\n只删除已登记且未使用的环境；删除后无法直接回退。确认？`))return
  pending.value=true
  try{await api('/api/environments/cleanup',{method:'POST',body:{path:item.path,confirm:true}});await refresh()}
  catch(e:any){error.value=e.message}finally{pending.value=false}
}
onMounted(()=>poll());onBeforeUnmount(()=>{stopped=true;clearTimeout(timer)})
</script>
<template>
  <section class="rounded-lg border p-4 space-y-4" aria-label="环境管理">
    <h3 class="font-semibold">环境管理 · Python 3.12 / uv</h3>
    <p class="text-sm text-muted-foreground">主环境只负责控制与安装。模型环境相互隔离，通过共享 uv 缓存和硬链接复用相同构建；跨文件系统会退回复制。安装日志只读，不接受命令输入。</p>
    <p v-if="error" role="alert" class="text-destructive whitespace-pre-wrap">{{error}}</p>
    <p v-if="data.trainingBusy" class="text-sm">请先停止训练、采样及 TensorBoard，并卸载驻留模型，再安装环境。</p>
    <p v-if="data.busy&&(!task||!['running','stopping'].includes(task.status))" class="text-sm">检测到命令行环境操作，暂时禁止启动新任务；该操作日志请在启动它的终端查看。</p>
    <div class="grid gap-3 md:grid-cols-2">
      <article v-for="env in data.environments" :key="env.id" class="rounded border p-3 space-y-2">
        <h4 class="font-semibold">{{env.label}} · {{labels[env.status]||(env.installed?'待检测':'未安装')}}</h4>
        <p class="text-xs break-all">{{env.path}}</p>
        <p v-if="env.checked_at" class="text-xs text-muted-foreground">上次检测：{{new Date(env.checked_at*1000).toLocaleString()}}；可点击检测刷新结果</p>
        <p v-if="env.python" class="text-sm">Python {{env.python}} · CUDA {{env.cuda===null?'不适用':env.cuda?'可用':'不可用'}} <span v-if="env.link_mode">· {{env.link_mode}}</span></p>
        <dl class="text-xs grid grid-cols-2 gap-x-3"><template v-for="(version,name) in env.versions" :key="String(name)"><dt>{{name}}</dt><dd>{{version}}</dd></template></dl>
        <div v-if="env.id!=='main'" class="text-xs space-y-1" aria-label="Triton 检测">
          <p>Triton：{{env.triton ? (tritonLabels[env.triton.status]||'未知状态') : '待检测（请点击检测刷新）'}}<span v-if="env.triton?.version"> · {{env.triton.version}}</span></p>
          <p v-for="(version,name) in env.triton?.distributions" :key="String(name)">{{name}} {{version}}</p>
          <p class="text-muted-foreground">Torch Compile 默认 inductor 的 GPU 加速依赖 Triton；可导入不代表完整训练可编译。缺失不影响关闭 Compile 的普通训练。</p>
          <pre v-if="env.triton?.error" class="whitespace-pre-wrap break-all">{{env.triton.error}}</pre>
        </div>
        <pre v-if="env.errors?.length" class="text-xs text-destructive whitespace-pre-wrap">{{env.errors.join('\n')}}</pre>
        <label v-if="env.id==='krea2'" class="text-sm">CUDA 构建 <select v-model="cuda" :disabled="data.busy"><option v-for="v in ['cu124','cu128','cu130','cu132']" :key="v">{{v}}</option></select></label>
        <div class="flex gap-2"><button class="btn" :disabled="pending||data.busy" @click="start(env.id,'check')">检测</button><button class="btn" :disabled="pending||data.busy||data.trainingBusy" @click="start(env.id,'install')">{{env.installed?'重建环境':'安装环境'}}</button></div>
      </article>
    </div>
    <p class="text-xs break-all">共享缓存：{{data.cache}}</p>
    <div class="flex items-center gap-3 flex-wrap"><strong>安装控制台 <span v-if="task">· {{labels[task.status]||task.status}}</span></strong><label class="text-sm"><input v-model="follow" type="checkbox"/> 自动滚动</label><button class="btn" @click="copy">复制</button><a v-if="taskId" class="btn" :href="`/api/environment-tasks/${taskId}/log`" download>下载完整日志</a><button v-if="task&&['running','stopping'].includes(task.status)" class="btn" :disabled="task.status==='stopping'" @click="stop">停止安装</button></div>
    <pre ref="output" class="h-72 overflow-auto rounded border bg-black p-3 text-xs text-green-200 whitespace-pre-wrap" aria-label="安装日志">{{logs||'等待环境检测或安装输出…'}}</pre>
    <p v-if="task?.error" role="alert" class="text-destructive whitespace-pre-wrap">{{task.error}}</p>
    <details v-if="data.history?.length"><summary>旧环境与回退备份（保留期间仍占空间）</summary><div v-for="item in data.history" :key="item.path" class="flex gap-3 items-center border-t py-2"><span class="text-xs break-all mr-auto">{{item.path}}</span><button class="btn text-destructive" :disabled="pending||data.busy||data.trainingBusy" @click="cleanup(item)">清理旧环境</button></div></details>
  </section>
</template>
