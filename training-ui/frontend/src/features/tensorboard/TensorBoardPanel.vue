<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useEditorStore } from '@/stores/editor'
import { api, jobUrl } from '@/services/api'
const store=useEditorStore(), running=ref(false), url=ref(''), busy=ref(false), error=ref('')
let generation=0, controller:AbortController|null=null
async function request(action:'status'|'launch'|'stop'='status') {
  if(!store.name)return; const name=store.name,version=generation; controller?.abort();controller=new AbortController();busy.value=true;error.value=''
  try {const suffix=action==='status'?'/tensorboard/status':action==='stop'?'/tensorboard/stop':'/tensorboard'; const result=await api(jobUrl(name,suffix),{method:action==='status'?'GET':'POST',signal:controller.signal});if(version!==generation||store.name!==name)return;if(result.error)throw Error(result.error);running.value=action==='stop'?false:!!(result.url&&(action==='launch'||result.running));url.value=running.value?new URL(result.url,location.href).href:''}
  catch(e:any){if(version===generation&&e.name!=='AbortError')error.value=e.message}finally{if(version===generation)busy.value=false}
}
watch(()=>store.name,()=>{generation++;controller?.abort();url.value='';running.value=false;void request()},{immediate:true})
onBeforeUnmount(()=>{generation++;controller?.abort()})
</script>
<template><section class="space-y-4"><div class="flex items-center gap-2 flex-wrap"><h2 class="font-semibold mr-auto">TensorBoard</h2><span>{{running?'运行中':'未运行'}}</span><button class="btn" :disabled="busy" @click="request()">刷新</button><button v-if="!running" class="btn" :disabled="busy" @click="request('launch')">{{busy?'正在启动…':'启动'}}</button><button v-else class="btn" :disabled="busy" @click="request('stop')">停止</button><a v-if="running" :href="url" target="_blank" rel="noopener noreferrer" class="btn">新窗口打开</a></div><p v-if="error" role="alert" class="text-destructive">{{error}}</p><iframe v-if="running && url" :src="url" title="TensorBoard 训练指标" class="w-full h-[75vh] rounded border bg-white"/><div v-else class="rounded border p-10 text-center text-muted-foreground">启动 TensorBoard 查看训练指标。Anima 日志位于任务 logs/，Krea 2 位于 output/tensorboard/；通过当前 WebUI 地址访问。</div></section></template>
