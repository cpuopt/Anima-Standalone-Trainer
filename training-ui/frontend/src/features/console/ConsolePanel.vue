<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useEditorStore } from '@/stores/editor'
import { terminalText } from './terminal'
import { memoryRows, unattributedBytes } from './memory-view'
const store=useEditorStore(), output=ref<HTMLElement|null>(null), follow=ref(true)
const displayed=computed(()=>terminalText(store.logs))
const memoryTraceEnabled=computed(()=>store.config?.training_arguments?.memory_trace === true)
const memoryTraceSupported=computed(()=>['anima','lumina'].includes(store.architecture))
const memoryTraceLocked=computed(()=>!store.name || store.running || store.loading || store.saving || !memoryTraceSupported.value)
function setMemoryTrace(event:Event){
  if(memoryTraceLocked.value)return
  store.config.training_arguments ??= {}
  store.config.training_arguments.memory_trace=(event.target as HTMLInputElement).checked
}
const collapsed=ref(localStorage.getItem('hw_monitor_collapsed')==='true')
watch(collapsed,v=>localStorage.setItem('hw_monitor_collapsed',String(v)))
watch(()=>store.logs,async()=>{if(follow.value){await nextTick();output.value?.scrollTo({top:output.value.scrollHeight})}})
function scroll(){if(output.value)follow.value=output.value.scrollHeight-output.value.scrollTop-output.value.clientHeight<100}
function bytes(n:number){return Number.isFinite(n)?`${(n/1073741824).toFixed(1)} GB`:'?'}
async function copy(){try{await navigator.clipboard.writeText(displayed.value)}catch(e:any){store.error=e.message}}
</script>
<template>
  <section class="console-layout">
    <div class="console-hardware rounded border p-4 space-y-3"><button class="font-semibold" @click="collapsed=!collapsed">{{collapsed?'展开':'收起'}}硬件监控</button><span class="ml-3 text-sm">{{store.connected?'实时连接':'连接断开，正在重试'}}</span>
      <div class="space-y-1 border-t pt-3">
        <label class="flex items-center gap-2 text-sm"><input type="checkbox" aria-label="显存分配详细记录" :checked="memoryTraceEnabled" :disabled="memoryTraceLocked" @change="setMemoryTrace"/>显存分配详细记录</label>
        <p class="text-xs text-muted-foreground">默认关闭，仅任务未运行时可修改；保存后在下次启动训练时生效。记录写入任务 logs 目录，不输出到控制台。</p>
        <p v-if="store.running" class="text-xs text-muted-foreground">训练 / 采样运行期间已锁定。</p>
        <p v-else-if="!memoryTraceSupported" class="text-xs text-muted-foreground">当前后端尚不支持显存分配详细记录。</p>
      </div>
      <template v-if="store.hardware"><div class="flex flex-wrap gap-5"><span>CPU {{store.hardware.cpu??0}}% <template v-if="store.hardware.cpuTemp!=null">· {{store.hardware.cpuTemp}}°C</template></span><span v-if="store.hardware.ram">RAM {{bytes(store.hardware.ram.used)}} / {{bytes(store.hardware.ram.total)}}</span></div>
      <div v-if="!collapsed" class="console-gpu-grid"><div v-for="g in store.hardware.gpus||[]" :key="g.index" class="rounded border p-3 text-sm space-y-1"><strong>GPU {{g.index}} {{g.name}} · {{g.activity||'空闲'}}</strong><div>利用率 {{g.util}}% · {{g.temp}}°C</div><div>显存 {{(g.memUsed/1024).toFixed(1)}} / {{(g.memTotal/1024).toFixed(1)}} GB</div><div>功耗 {{g.powerDraw}} W <template v-if="g.powerLimit">/ {{g.powerLimit}} W</template></div><progress class="w-full" :value="g.memUsed" :max="g.memTotal||1"/></div></div></template><p v-else class="text-sm text-muted-foreground">等待硬件数据…</p>
      <template v-if="!collapsed && store.hardware">
        <div v-for="p in store.hardware.memoryProcesses || []" :key="`${p.jobName}-${p.pid}`" class="rounded border p-3 text-sm space-y-2">
          <strong>显存分配 · {{p.jobName}} · PID {{p.pid}} · {{p.device}}</strong>
          <div class="text-muted-foreground">最近节点：{{p.stage}} · {{Math.floor(p.ageMs / 1000)}} 秒前 <span v-if="p.ageMs > 15000">（节点快照，等待更新）</span></div>
          <div v-if="p.cuda_visible_devices" class="text-muted-foreground">可见物理 GPU：{{p.cuda_visible_devices}}（表内 cuda 编号为进程内编号）</div>
          <div class="flex flex-wrap gap-x-5 gap-y-1">
            <span v-if="p.allocated_bytes != null">活跃张量 {{bytes(p.allocated_bytes)}}</span>
            <span v-if="p.reserved_bytes != null">PyTorch 预留 {{bytes(p.reserved_bytes)}}</span>
            <span v-if="p.cached_unused_bytes != null" title="预留减去活跃分配；包含可能无法立即释放的分裂块或图池空间">未使用预留 {{bytes(p.cached_unused_bytes)}}</span>
            <span v-if="p.inactive_split_bytes != null">分裂块内未用空间 {{bytes(p.inactive_split_bytes)}}</span>
            <span v-if="p.peak_allocated_bytes != null">{{p.trace_enabled ? '区间峰值' : '进程峰值'}} {{bytes(p.peak_allocated_bytes)}}</span>
          </div>
          <div v-if="p.windows" class="flex flex-wrap gap-x-5 gap-y-1">
            <span v-if="p.windows.dedicated_bytes != null">进程专用显存 {{bytes(p.windows.dedicated_bytes)}}</span>
            <span v-if="p.windows.shared_bytes != null" :class="p.windows.shared_bytes > 268435456 ? 'text-amber-400' : ''">进程共享 GPU 内存 {{bytes(p.windows.shared_bytes)}}</span>
            <span class="text-muted-foreground">Windows 进程统计涵盖所有适配器</span>
          </div>
          <div class="overflow-x-auto"><table class="w-full text-left"><thead><tr><th>模型 / 内容</th><th>所在设备</th><th>存储占用估算</th></tr></thead><tbody>
            <tr v-for="row in memoryRows(p)" :key="`${row.name}-${row.device}`"><td>{{row.name}}</td><td>{{row.device}}</td><td>{{bytes(row.bytes)}}</td></tr>
            <tr v-if="unattributedBytes(p) != null"><td>未归属活跃分配（含激活 / 工作区等）</td><td>{{p.device}}</td><td>{{bytes(unattributedBytes(p)!)}}</td></tr>
          </tbody></table></div>
          <p class="text-xs text-muted-foreground">CPU 项表示模型已卸载到内存。参数、缓冲、梯度和优化器按存储去重估算；CUDA 图池、驱动及其他进程分配不能全部归属到模型。CUDA 分配不等于物理显存驻留，驱动不提供按模型划分的共享内存换页明细。</p>
        </div>
        <p v-if="!store.hardware.memoryProcesses?.length" class="text-sm text-muted-foreground">显存内容明细等待训练进程上报；已在运行的旧进程需下次启动后才能提供。</p>
      </template>
    </div>
    <div class="console-log-panel space-y-3">
      <div class="console-log-toolbar flex items-center gap-3"><h2 class="font-semibold mr-auto">训练控制台</h2><label class="text-sm"><input v-model="follow" type="checkbox"/> 自动滚动</label><button class="btn" @click="store.logs=''">清空显示</button><button class="btn" @click="copy">复制日志</button></div>
      <pre ref="output" class="console-log-output overflow-auto rounded border bg-black p-4 text-xs leading-relaxed text-green-200 whitespace-pre-wrap" @scroll="scroll">{{displayed||'等待训练或采样输出…'}}</pre>
    </div>
  </section>
</template>
