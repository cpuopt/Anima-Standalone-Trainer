<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useEditorStore } from '@/stores/editor'
import { terminalText } from './terminal'
const store=useEditorStore(), output=ref<HTMLElement|null>(null), follow=ref(true)
const displayed=computed(()=>terminalText(store.logs))
const collapsed=ref(localStorage.getItem('hw_monitor_collapsed')==='true')
watch(collapsed,v=>localStorage.setItem('hw_monitor_collapsed',String(v)))
watch(()=>store.logs,async()=>{if(follow.value){await nextTick();output.value?.scrollTo({top:output.value.scrollHeight})}})
function scroll(){if(output.value)follow.value=output.value.scrollHeight-output.value.scrollTop-output.value.clientHeight<100}
function bytes(n:number){return Number.isFinite(n)?`${(n/1073741824).toFixed(1)} GB`:'?'}
async function copy(){try{await navigator.clipboard.writeText(displayed.value)}catch(e:any){store.error=e.message}}
</script>
<template>
  <section class="space-y-4">
    <div class="rounded border p-4 space-y-3"><button class="font-semibold" @click="collapsed=!collapsed">{{collapsed?'展开':'收起'}}硬件监控</button><span class="ml-3 text-sm">{{store.connected?'实时连接':'连接断开，正在重试'}}</span>
      <template v-if="store.hardware"><div class="flex flex-wrap gap-5"><span>CPU {{store.hardware.cpu??0}}% <template v-if="store.hardware.cpuTemp!=null">· {{store.hardware.cpuTemp}}°C</template></span><span v-if="store.hardware.ram">RAM {{bytes(store.hardware.ram.used)}} / {{bytes(store.hardware.ram.total)}}</span></div>
      <div v-if="!collapsed" class="grid gap-3 md:grid-cols-2"><div v-for="g in store.hardware.gpus||[]" :key="g.index" class="rounded border p-3 text-sm space-y-1"><strong>GPU {{g.index}} {{g.name}} · {{g.activity||'空闲'}}</strong><div>利用率 {{g.util}}% · {{g.temp}}°C</div><div>显存 {{(g.memUsed/1024).toFixed(1)}} / {{(g.memTotal/1024).toFixed(1)}} GB</div><div>功耗 {{g.powerDraw}} W <template v-if="g.powerLimit">/ {{g.powerLimit}} W</template></div><progress class="w-full" :value="g.memUsed" :max="g.memTotal||1"/></div></div></template><p v-else class="text-sm text-muted-foreground">等待硬件数据…</p>
    </div>
    <div class="flex items-center gap-3"><h2 class="font-semibold mr-auto">训练控制台</h2><label class="text-sm"><input v-model="follow" type="checkbox"/> 自动滚动</label><button class="btn" @click="store.logs=''">清空显示</button><button class="btn" @click="copy">复制日志</button></div>
    <pre ref="output" class="h-[65vh] overflow-auto rounded border bg-black p-4 text-xs leading-relaxed text-green-200 whitespace-pre-wrap" @scroll="scroll">{{displayed||'等待训练或采样输出…'}}</pre>
  </section>
</template>
