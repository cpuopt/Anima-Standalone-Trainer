<script setup lang="ts">
import { computed, nextTick, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue'
import { useEditorStore } from '@/stores/editor'
import { memoryRows, unattributedBytes } from './memory-view'
import { filterLogLines, keyLogEvents, logLines, type LogLine } from './log-view'

const store = useEditorStore()
const root = ref<HTMLElement|null>(null), output = ref<HTMLElement|null>(null), hardwarePane = ref<HTMLElement|null>(null)
const follow = ref(true), wrap = ref(true), query = ref(''), level = ref('ALL'), mobileResources = ref(false)
const collapsed = ref(localStorage.getItem('hw_monitor_collapsed') === 'true')
const panelHeight = ref(640), windowEnd = ref<number|null>(null), highlighted = ref<number|null>(null)
const allLines = computed(() => logLines(store.logs))
const matched = computed(() => filterLogLines(allLines.value,query.value,level.value))
const rendered = computed(() => {
  const end = windowEnd.value === null ? matched.value.length : Math.min(windowEnd.value,matched.value.length)
  return matched.value.slice(Math.max(0,end-1500),end)
})
const events = computed(() => keyLogEvents(allLines.value))
const hasEarlier = computed(() => (windowEnd.value ?? matched.value.length) > 1500)
const memoryTraceEnabled = computed(() => store.config?.training_arguments?.memory_trace === true)
const memoryTraceSupported = computed(() => ['anima','lumina'].includes(store.architecture))
const memoryTraceLocked = computed(() => !store.name || store.running || store.loading || store.saving || !memoryTraceSupported.value)
let observer: ResizeObserver|undefined, previousFocus: HTMLElement|null = null, previousOverflow = ''
let followingUpdate = false, mounted = true, savedScrollTop = 0

function setMemoryTrace(event: Event) {
  if (memoryTraceLocked.value) return
  store.config.training_arguments ??= {}
  store.config.training_arguments.memory_trace = (event.target as HTMLInputElement).checked
}
function bytes(n: unknown) { return typeof n === 'number' && Number.isFinite(n) ? `${(n/1073741824).toFixed(1)} GB` : '—' }
function number(n: unknown) { return typeof n === 'number' && Number.isFinite(n) ? String(n) : '—' }
function gpuMemory(n: unknown) { return typeof n === 'number' && Number.isFinite(n) ? (n/1024).toFixed(1) : '—' }
function eventLabel(line: LogLine) { return line.text.trim().replace(/^(?:\d{4}-\d{2}-\d{2}\s+)?\d{2}:\d{2}:\d{2}\s+(?:INFO|WARNING|WARN|ERROR|DEBUG)\s*/,'') }
function sizePanel() {
  if (!root.value) return
  // Absolute page position keeps the console stable while the page is scrolled.
  const top = root.value.getBoundingClientRect().top+window.scrollY
  panelHeight.value = Math.max(360,window.innerHeight-top-16)
  if (window.innerWidth > 680 && mobileResources.value) mobileResources.value = false
}
async function bottom() {
  follow.value = true; windowEnd.value = null; highlighted.value = null; followingUpdate = true
  await nextTick()
  if (mounted && output.value) output.value.scrollTop = output.value.scrollHeight
  followingUpdate = false
}
function scroll() {
  if (!output.value || followingUpdate) return
  const nearEnd = output.value.scrollHeight-output.value.scrollTop-output.value.clientHeight < 40
  if (!nearEnd && follow.value) { follow.value = false; windowEnd.value = matched.value.length }
  else if (nearEnd && windowEnd.value === null) follow.value = true
}
function followChanged() { if (follow.value) void bottom(); else windowEnd.value = matched.value.length }
async function older() {
  follow.value = false; highlighted.value = null
  windowEnd.value = Math.max(1500,(windowEnd.value ?? matched.value.length)-1000)
  await nextTick()
  if (output.value) output.value.scrollTop = 0
}
async function jump(line: LogLine) {
  follow.value = false; query.value = ''; level.value = 'ALL'
  await nextTick()
  const index = matched.value.findIndex(item => item.id === line.id)
  windowEnd.value = Math.min(matched.value.length,index+500); highlighted.value = line.id
  await nextTick()
  const element = output.value?.querySelector<HTMLElement>(`[data-log-line="${line.id}"]`)
  if (element && output.value) { output.value.scrollTop = element.offsetTop-output.value.offsetTop; element.focus({preventScroll:true}) }
}
function clear() { store.logs = ''; windowEnd.value = null; highlighted.value = null }
async function copy() {
  try { await navigator.clipboard.writeText(matched.value.map(line => line.text).join('\n')) }
  catch (error: any) { store.error = error?.message || '复制失败，请使用导出日志。' }
}
function download() {
  const blob = new Blob([matched.value.map(line => line.text).join('\n')],{type:'text/plain;charset=utf-8'})
  const url = URL.createObjectURL(blob), link = document.createElement('a')
  link.href = url; link.download = `${store.name || 'training'}-console.log`; link.click()
  setTimeout(() => URL.revokeObjectURL(url),1000)
}
function drawerKeydown(event: KeyboardEvent) {
  if (!mobileResources.value) return
  if (event.key === 'Escape') { event.preventDefault(); mobileResources.value = false }
  if (event.key === 'Tab') {
    const elements = [...(hardwarePane.value?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),summary') || [])].filter(el => el.getClientRects().length)
    if (event.shiftKey && document.activeElement === elements[0]) { event.preventDefault(); elements.at(-1)?.focus() }
    else if (!event.shiftKey && document.activeElement === elements.at(-1)) { event.preventDefault(); elements[0]?.focus() }
  }
}
watch(collapsed,value => localStorage.setItem('hw_monitor_collapsed',String(value)))
watch(() => store.logs,() => { if (follow.value) void bottom() })
watch([query,level],() => { windowEnd.value = null; highlighted.value = null })
watch(() => store.name,() => { query.value = ''; level.value = 'ALL'; follow.value = true; windowEnd.value = null; highlighted.value = null; mobileResources.value = false })
watch(mobileResources,async value => {
  if (value) {
    previousFocus = document.activeElement as HTMLElement; previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    await nextTick(); hardwarePane.value?.querySelector<HTMLElement>('.console-drawer-close')?.focus()
  } else { document.body.style.overflow = previousOverflow; previousFocus?.focus({preventScroll:true}) }
})
onMounted(() => {
  sizePanel(); void bottom()
  if (typeof ResizeObserver !== 'undefined' && root.value?.parentElement) { observer = new ResizeObserver(sizePanel); observer.observe(root.value.parentElement) }
  window.addEventListener('resize',sizePanel); document.addEventListener('keydown',drawerKeydown)
})
onActivated(() => {
  void nextTick().then(() => {
    if (!mounted) return
    sizePanel()
    if (follow.value) void bottom()
    else if (output.value) output.value.scrollTop = savedScrollTop
  })
})
onDeactivated(() => {
  if (output.value) savedScrollTop = output.value.scrollTop
})
onUnmounted(() => {
  mounted = false; observer?.disconnect(); window.removeEventListener('resize',sizePanel); document.removeEventListener('keydown',drawerKeydown)
  if (mobileResources.value) document.body.style.overflow = previousOverflow
})
</script>

<template>
  <section ref="root" class="console-layout console-workbench" :class="{'hardware-collapsed':collapsed}" :style="{'--console-height':panelHeight+'px'}">
    <div class="console-mobile-summary"><span>CPU {{number(store.hardware?.cpu)}}% <template v-if="store.hardware?.ram"> / RAM {{bytes(store.hardware.ram.used)}}</template></span><button class="btn" @click="mobileResources = true">资源与显存明细</button></div>
    <aside v-show="!collapsed || mobileResources" ref="hardwarePane" class="console-hardware" :class="{'mobile-open':mobileResources}" :role="mobileResources ? 'dialog' : undefined" :aria-modal="mobileResources ? true : undefined" aria-label="资源与显存监控">
      <header class="console-hardware-heading"><h2>资源监控</h2><button class="console-drawer-close btn" @click="mobileResources = false">关闭</button><button class="console-collapse" @click="collapsed = true">收起硬件监控</button></header>
      <p class="console-connection" :class="{stale:!store.connected}">{{store.connected ? '实时连接' : '连接断开，正在重试；显示最后快照'}}</p>
      <div v-if="store.hardware" class="console-system console-card"><div><span>CPU</span><b>{{number(store.hardware.cpu)}}% <small v-if="store.hardware.cpuTemp != null"> / {{number(store.hardware.cpuTemp)}} °C</small></b></div><div><span>RAM</span><b v-if="store.hardware.ram">{{bytes(store.hardware.ram.used)}} / {{bytes(store.hardware.ram.total)}}</b><b v-else>—</b></div></div>
      <p v-else class="console-empty">等待硬件数据…</p>
      <div class="console-gpu-grid"><section v-for="g in store.hardware?.gpus || []" :key="g.index" class="console-card console-gpu"><header><strong>GPU {{g.index}}</strong><span :title="g.name">{{g.name}}</span><small>{{g.activity || '空闲'}}</small></header><div class="console-gpu-values"><div><span>显存</span><b>{{gpuMemory(g.memUsed)}} <small>/ {{gpuMemory(g.memTotal)}} GB</small></b></div><div><span>利用率</span><b>{{number(g.util)}}%</b></div><div><span>温度</span><b>{{number(g.temp)}} °C</b></div></div><progress :aria-label="`GPU ${g.index} 显存使用量`" :value="g.memUsed" :max="g.memTotal || 1"/><footer>功耗 {{number(g.powerDraw)}} W <template v-if="g.powerLimit">/ {{number(g.powerLimit)}} W</template></footer></section></div>
      <details class="console-trace console-card"><summary><label @click.stop><input type="checkbox" aria-label="显存分配详细记录" :checked="memoryTraceEnabled" :disabled="memoryTraceLocked" @change="setMemoryTrace"/>显存分配详细记录</label><span>说明</span></summary><p>默认关闭，仅任务未运行时可修改；保存后在下次启动训练时生效。记录写入任务 logs 目录，不输出到控制台。</p><p v-if="store.running">训练 / 采样运行期间已锁定。</p><p v-else-if="!memoryTraceSupported">当前后端尚不支持显存分配详细记录。</p></details>
      <section class="console-card console-memory" :class="{'empty-memory':!store.hardware?.memoryProcesses?.length}"><header><h2>显存内容与设备位置</h2></header><div class="console-memory-body">
        <article v-for="p in store.hardware?.memoryProcesses || []" :key="`${p.jobName}-${p.pid}-${p.device}`" class="console-process"><h3>{{p.jobName}} <span>PID {{p.pid}} / {{p.device}}</span></h3><p class="console-snapshot">最近节点：{{p.stage}} · {{Math.floor(p.ageMs / 1000)}} 秒前 <span v-if="p.ageMs > 15000">（节点快照，等待更新）</span></p><p v-if="p.cuda_visible_devices" class="console-snapshot">可见物理 GPU：{{p.cuda_visible_devices}}（表内 cuda 编号为进程内编号）</p>
          <table><thead><tr><th>模型 / 内容</th><th>设备</th><th>存储估算</th></tr></thead><tbody><tr v-for="row in memoryRows(p)" :key="`${row.name}-${row.device}`"><td>{{row.name}}</td><td><code>{{row.device}}</code></td><td>{{bytes(row.bytes)}}</td></tr><tr v-if="unattributedBytes(p) != null"><td>未归属活跃分配（含激活 / 工作区等）</td><td><code>{{p.device}}</code></td><td>{{bytes(unattributedBytes(p))}}</td></tr></tbody></table>
          <details class="console-memory-details"><summary>分配统计与说明</summary><div class="console-memory-stats"><span v-if="p.allocated_bytes != null">活跃张量 {{bytes(p.allocated_bytes)}}</span><span v-if="p.reserved_bytes != null">PyTorch 预留 {{bytes(p.reserved_bytes)}}</span><span v-if="p.cached_unused_bytes != null" title="预留减去活跃分配；包含可能无法立即释放的分裂块或图池空间">未使用预留 {{bytes(p.cached_unused_bytes)}}</span><span v-if="p.inactive_split_bytes != null">分裂块内未用空间 {{bytes(p.inactive_split_bytes)}}</span><span v-if="p.peak_allocated_bytes != null">{{p.trace_enabled ? '区间峰值' : '进程峰值'}} {{bytes(p.peak_allocated_bytes)}}</span><template v-if="p.windows"><span v-if="p.windows.dedicated_bytes != null">进程专用显存 {{bytes(p.windows.dedicated_bytes)}}</span><span v-if="p.windows.shared_bytes != null" :class="{stale:p.windows.shared_bytes > 268435456}">进程共享 GPU 内存 {{bytes(p.windows.shared_bytes)}}</span><span>Windows 进程统计涵盖所有适配器</span></template></div><p>CPU 项表示模型已卸载到内存。参数、缓冲、梯度和优化器按存储去重估算；CUDA 图池、驱动及其他进程分配不能全部归属到模型。CUDA 分配不等于物理显存驻留，驱动不提供按模型划分的共享内存换页明细。</p></details>
        </article>
        <p v-if="!store.hardware?.memoryProcesses?.length" class="console-empty">显存内容明细等待训练进程上报；已在运行的旧进程需下次启动后才能提供。</p>
      </div></section>
      <section class="console-card console-events"><header><h2>最近关键节点</h2><small>来自当前日志</small></header><div class="console-event-list"><button v-for="line in events" :key="line.id" :class="line.level.toLowerCase()" :title="line.text" @click="jump(line); mobileResources = false"><time>{{line.time || '日志'}}</time><span>{{eventLabel(line)}}</span></button><p v-if="!events.length" class="console-empty">等待关键节点…</p></div></section>
    </aside>
    <section class="console-log-panel" :class="{wrap}">
      <header class="console-log-toolbar"><h2>训练控制台</h2><button v-if="collapsed" class="btn console-expand" @click="collapsed = false">展开硬件监控</button><input v-model="query" type="search" aria-label="搜索日志" placeholder="搜索日志…"/><button class="btn" @click="clear">清空显示</button><button class="btn" @click="copy">复制日志</button><button class="btn" @click="download">导出</button></header>
      <div class="console-log-options"><div class="console-levels" aria-label="日志级别"><button v-for="item in [{value:'ALL',label:'全部'},{value:'WARN',label:'警告'},{value:'ERROR',label:'错误'}]" :key="item.value" :class="{active:level === item.value}" :aria-pressed="level === item.value" @click="level = item.value">{{item.label}}</button></div><label><input v-model="follow" type="checkbox" @change="followChanged"/>自动跟随</label><label><input v-model="wrap" type="checkbox"/>换行</label><span class="console-log-count">{{rendered.length}} / {{matched.length}} 行</span></div>
      <div ref="output" class="console-log-output" aria-label="日志输出" tabindex="0" @scroll="scroll"><div v-for="line in rendered" :key="line.id" class="console-log-line" :class="[line.level.toLowerCase(),{highlighted:highlighted === line.id}]" :data-log-line="line.id" tabindex="-1">{{line.text || '\u00a0'}}</div><p v-if="!rendered.length" class="console-empty">{{store.logs ? '没有匹配的日志。' : '等待训练或采样输出…'}}</p></div>
      <footer class="console-log-footer"><span :class="{stale:!store.connected}">{{store.connected ? (store.running ? '任务运行中' : '等待任务输出') : '连接断开，正在重试'}}</span><span v-if="matched.length > rendered.length">窗口显示 {{rendered.length}} 行，复制 / 导出包含全部匹配日志</span><button v-if="hasEarlier" class="btn console-older" @click="older">查看更早</button><button class="btn" @click="bottom">回到最新</button></footer>
    </section>
  </section>
</template>

<style scoped>
.console-memory.empty-memory{flex:0 0 auto;min-height:0}
.console-layout.console-workbench{display:grid;grid-template-columns:320px minmax(0,1fr);grid-template-rows:minmax(0,1fr);gap:12px;align-items:stretch;min-width:0;height:var(--console-height);min-height:360px}.console-workbench> *{min-width:0;min-height:0}.console-hardware{display:flex;flex-direction:column;gap:9px;overflow:auto;overscroll-behavior:contain;max-height:none;padding-right:2px;scrollbar-width:thin}.console-hardware-heading{display:flex;align-items:center;gap:8px;flex-shrink:0}.console-hardware-heading h2{font-size:14px;margin:0 auto 0 0}.console-collapse{font-size:12px;color:var(--muted-foreground);padding:2px;background:none;border:0}.console-connection{font-size:12px;color:var(--muted-foreground);margin:-4px 0 0}.stale{color:var(--destructive,#bc364a)}.console-card{border:1px solid var(--border);border-radius:7px;background:var(--card);min-width:0;flex-shrink:0}.console-system{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:10px 12px}.console-system span,.console-gpu-values span{display:block;font-size:12px;color:var(--muted-foreground)}.console-system b{font-size:14px;font-weight:550;display:block}.console-system small{display:inline;font-size:12px;font-weight:400}.console-gpu-grid{display:flex;flex-direction:column;gap:8px}.console-gpu{padding:10px 12px}.console-gpu header{display:flex;gap:7px;align-items:baseline;font-size:12px;margin-bottom:8px}.console-gpu header strong{white-space:nowrap;font-size:13px}.console-gpu header>span{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:var(--muted-foreground)}.console-gpu header>small{margin-left:auto;white-space:nowrap;color:var(--primary);font-size:12px}.console-gpu-values{display:grid;grid-template-columns:1.35fr 1fr 1fr;gap:6px}.console-gpu-values b{font-size:14px;font-weight:550}.console-gpu-values small{display:inline;font-size:12px;font-weight:400}.console-gpu progress{display:block;width:100%;height:5px;margin-top:8px;accent-color:var(--primary);border:0;border-radius:3px;overflow:hidden}.console-gpu progress::-webkit-progress-bar{background:var(--muted)}.console-gpu progress::-webkit-progress-value{background:var(--primary)}.console-gpu footer{display:block;text-align:right;font-size:12px;color:var(--muted-foreground);margin-top:5px}.console-trace{padding:6px 10px}.console-trace summary{display:flex;gap:4px;align-items:center;justify-content:space-between;padding:0;font-size:12px;cursor:pointer}.console-trace label{display:flex;gap:6px;align-items:center;cursor:pointer;color:var(--foreground)}.console-trace p{font-size:12px;line-height:1.6;color:var(--muted-foreground);margin:8px 0 0}.console-memory{display:flex;flex-direction:column;flex:1 0 270px;min-height:240px;overflow:hidden}.console-memory>header,.console-events>header{padding:9px 11px;border-bottom:1px solid var(--border);flex-shrink:0}.console-memory h2,.console-events h2{font-size:13px;margin:0;font-weight:600}.console-memory-body{overflow:auto;overscroll-behavior:contain;padding:9px 10px;min-height:0}.console-process+.console-process{border-top:1px solid var(--border);margin-top:14px;padding-top:10px}.console-process h3{font-size:12px;margin:0 0 5px;overflow-wrap:anywhere}.console-process h3 span{font-weight:400;color:var(--muted-foreground)}.console-snapshot{font-size:12px;line-height:1.6;color:var(--muted-foreground);margin:0 0 8px;overflow-wrap:anywhere}.console-memory table{table-layout:fixed;font-size:12px}.console-memory th,.console-memory td{font-size:12px;padding:6px 3px;overflow-wrap:anywhere;vertical-align:top}.console-memory th:first-child{width:49%}.console-memory th:nth-child(2){width:23%}.console-memory th:last-child,.console-memory td:last-child{text-align:right;white-space:nowrap}.console-memory code{color:var(--primary);font:12px Consolas,monospace}.console-memory-details{font-size:12px;color:var(--muted-foreground)}.console-memory-details summary{font-size:12px;padding:8px 0}.console-memory-details p{font-size:12px;margin:8px 0 0;line-height:1.7}.console-memory-stats{display:grid;gap:5px}.console-events{flex:0 0 auto;max-height:190px;overflow:auto;overscroll-behavior:contain}.console-events>header small{font-size:12px;color:var(--muted-foreground)}.console-event-list{padding:5px 10px}.console-event-list button{display:grid;grid-template-columns:60px minmax(0,1fr);gap:7px;width:100%;padding:5px 0;border:0;background:none;text-align:left;font-size:12px;line-height:1.6}.console-event-list button:hover{color:var(--primary)}.console-event-list button span{overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow-wrap:anywhere}.console-event-list time{color:var(--muted-foreground);font-variant-numeric:tabular-nums}.console-event-list .warn{color:var(--muted-foreground)}.console-event-list .error{color:var(--destructive)}.console-empty{font-size:14px;color:var(--muted-foreground);padding:8px 3px;margin:0;line-height:1.8}.console-log-panel{display:flex;flex-direction:column;min-width:0;min-height:0;border:1px solid #2b374c;border-radius:7px;overflow:hidden;background:#0c121c;color:#e0e7f2}.console-log-toolbar{display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:9px 11px;background:#182233;border-bottom:1px solid #304158;min-height:0}.console-log-toolbar h2{font-size:14px;margin:0 auto 0 0;color:#e0e7f2}.console-log-toolbar input[type=search]{width:190px;min-height:32px;font-size:12px;background:#101a28;border-color:#394b66;color:#e0e7f2}.console-log-panel .btn{font-size:12px;min-height:30px;padding:4px 9px;background:#202d42;color:#d5e0f1;border-color:#394b66}.console-log-options{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:6px 10px;background:#182233;border-bottom:1px solid #304158;font-size:12px;color:#c2cee0}.console-log-options label{display:flex;gap:4px;align-items:center;font-size:12px;white-space:nowrap}.console-levels{display:flex;gap:3px}.console-levels button{font-size:12px;border:1px solid transparent;border-radius:4px;padding:2px 6px;color:#c2cee0;background:none;min-height:28px}.console-levels button.active{color:#a8c8ff;border-color:#86aafa;background:#263950}.console-log-count{margin-left:auto;font-size:12px;font-variant-numeric:tabular-nums}.console-log-panel .console-log-output{position:relative;flex:1;min-height:0;height:auto;overflow:auto;overscroll-behavior:contain;padding:10px 0 24px;margin:0;scrollbar-color:#3e4d63 transparent;font:14px/1.85 Consolas,"Microsoft YaHei",monospace;white-space:pre;overflow-wrap:normal}.console-log-line{padding:0 12px;min-width:max-content;border-left:2px solid transparent;color:#cfdae9}.console-log-panel.wrap .console-log-line{min-width:0;white-space:pre-wrap;overflow-wrap:anywhere}.console-log-line.warn{color:#e8bd77;border-left-color:#e8bd77;background:#e8bd7708}.console-log-line.error{color:#f18b9b;border-left-color:#f18b9b}.console-log-line.debug{color:#95a6bc}.console-log-line.highlighted{background:#253650;border-left-color:#86aafa}.console-log-output .console-empty{color:#a6b4c8;padding:18px}.console-log-footer{display:flex;flex-direction:row;align-items:center;gap:8px;flex-wrap:wrap;padding:5px 10px;border-top:1px solid #304158;background:#182233;color:#a6b4c8;font-size:12px}.console-log-footer>button{margin-left:auto}.console-log-footer .stale{color:#e8bd77}.console-mobile-summary,.console-drawer-close{display:none}.console-workbench.hardware-collapsed{grid-template-columns:minmax(0,1fr)}
@media(max-width:1100px){.console-layout.console-workbench{grid-template-columns:280px minmax(0,1fr);gap:9px}.console-workbench.hardware-collapsed{grid-template-columns:minmax(0,1fr)}.console-log-toolbar input[type=search]{order:5;width:100%}.console-log-toolbar h2{margin-right:auto}.console-gpu-values{gap:4px}.console-gpu{padding:8px 10px}.console-gpu-values b{font-size:13px}}
@media(max-width:680px){.console-layout.console-workbench{display:flex;flex-direction:column;gap:8px;min-height:420px}.console-log-panel{flex:1}.console-mobile-summary{display:flex;align-items:center;gap:8px;font-size:12px;flex-shrink:0;color:var(--muted-foreground)}.console-mobile-summary .btn{font-size:12px;margin-left:auto;min-height:34px}.console-hardware{display:none}.console-hardware.mobile-open{display:flex!important;position:fixed;inset:12px;z-index:200;max-height:none;border:1px solid var(--border);border-radius:8px;padding:12px;background:var(--background);box-shadow:0 0 0 100vmax #0008}.console-drawer-close{display:inline-flex;font-size:12px}.console-collapse{display:none}.console-memory{flex-basis:280px}.console-log-toolbar{padding:8px}.console-log-options{gap:6px;padding:5px 8px}.console-log-count{font-size:12px}.console-log-footer>span:nth-child(2){display:none}.console-log-line{padding:0 8px}.console-expand{display:none}}
@media(orientation:landscape) and (max-height:550px) and (min-width:681px){.console-layout.console-workbench{grid-template-columns:230px minmax(0,1fr)}.console-workbench.hardware-collapsed{grid-template-columns:minmax(0,1fr)}.console-system{padding:7px 9px}.console-system b{font-size:12px}.console-gpu-values{grid-template-columns:1.5fr 1fr}.console-gpu-values>div:last-child{display:none}.console-gpu header{margin-bottom:5px}.console-gpu footer{display:none}.console-memory{flex-basis:180px;min-height:160px}.console-events{max-height:130px}.console-log-options{gap:6px}.console-log-toolbar{padding:6px 8px}}
</style>
