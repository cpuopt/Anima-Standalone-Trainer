<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useEditorStore } from '@/stores/editor'
import { api, jobUrl } from '@/services/api'
type Action = 'status' | 'launch' | 'stop'
const store = useEditorStore()
const running = ref(false), starting = ref(false), url = ref(''), error = ref('')
const pending = ref<Action | null>(null), collapsed = ref(false), frameVersion = ref(0)
const viewer = ref<HTMLElement | null>(null), copyMessage = ref('')
const busy = computed(() => pending.value !== null)
const architectureNames: Record<string, string> = { anima: 'Anima', krea2: 'Krea 2', moss_image: 'MOSS-Image' }
const architecture = computed(() => architectureNames[store.architecture] || store.architecture)
const logDirectory = computed(() => ['krea2', 'moss_image'].includes(store.architecture) ? 'output/tensorboard/' : 'logs/')
const relativeLogPath = computed(() => `${store.name}/${logDirectory.value}`)
const serviceLabel = computed(() => pending.value === 'launch' || starting.value ? '正在启动' : pending.value === 'stop' ? '正在停止' : running.value ? '运行中' : pending.value === 'status' ? '检查中' : '未运行')
const powerLabel = computed(() => pending.value === 'launch' ? '正在启动…' : pending.value === 'stop' ? '正在停止…' : running.value ? '停止服务' : '启动服务')
const fullscreenAvailable = typeof document !== 'undefined' && !!document.fullscreenEnabled
let generation=0, controller:AbortController|null=null
async function request(action: Action = 'status') {
  if (!store.name || busy.value) return
  const name = store.name, version = ++generation
  controller = new AbortController()
  pending.value = action
  error.value = ''
  try {
    const suffix = action === 'status' ? '/tensorboard/status' : action === 'stop' ? '/tensorboard/stop' : '/tensorboard'
    const result = await api(jobUrl(name, suffix), { method: action === 'status' ? 'GET' : 'POST', signal: controller.signal })
    if (version !== generation || store.name !== name) return
    if (result.error) throw Error(result.error)
    running.value = action !== 'stop' && !!(result.url && (action === 'launch' || result.running))
    starting.value = action === 'status' && !!result.starting && !running.value
    url.value = running.value ? new URL(result.url, location.href).href : ''
  } catch (e: any) {
    if (version === generation && e.name !== 'AbortError') error.value = e.message
  } finally {
    if (version === generation) pending.value = null
  }
}
async function copyPath() {
  const name = store.name, path = relativeLogPath.value
  try {
    await navigator.clipboard.writeText(path)
    if (name === store.name) copyMessage.value = '已复制任务相对路径'
  } catch {
    if (name === store.name) copyMessage.value = '无法自动复制，请选中上方路径手动复制。'
  }
}
async function focusViewer() {
  try { await viewer.value?.requestFullscreen() }
  catch { error.value = '浏览器未能进入全屏，请使用新窗口打开。' }
}
watch(() => store.name, () => {
  generation++; controller?.abort(); pending.value = null
  url.value = ''; running.value = false; starting.value = false
  error.value = ''; copyMessage.value = ''; frameVersion.value = 0
  if (store.name) void request()
}, { immediate: true })
onBeforeUnmount(()=>{generation++;controller?.abort()})
</script>
<template>
  <section class="tb-page">
    <header class="tb-heading">
      <h2>TensorBoard</h2>
      <button class="btn" :aria-expanded="!collapsed" aria-controls="tb-assistance" @click="collapsed = !collapsed">
        <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="3.5" width="15" height="13" rx="2"/><path d="M8 4v12"/></svg>
        {{ collapsed ? '展开辅助栏' : '收起辅助栏' }}
      </button>
    </header>
    <p v-if="error" class="tb-error" role="alert">{{ error }}</p>
    <div class="tb-layout" :class="{ 'tb-collapsed': collapsed }">
      <aside id="tb-assistance" v-show="!collapsed" class="tb-assistance" aria-label="TensorBoard 辅助信息">
        <section class="tb-section">
          <div class="tb-section-heading"><h3>服务</h3><span class="tb-status" :class="{ 'tb-online': running }" role="status"><i/>{{ serviceLabel }}</span></div>
          <div class="tb-controls">
            <button class="btn tb-primary" :disabled="busy || !store.name" @click="request(running ? 'stop' : 'launch')">{{ powerLabel }}</button>
            <button class="btn" :disabled="busy || !store.name" @click="request()">{{ pending === 'status' ? '检查中…' : '刷新状态' }}</button>
            <a v-if="running && url" :href="url" target="_blank" rel="noopener noreferrer" class="btn tb-wide">新窗口打开 <span aria-hidden="true">↗</span></a>
          </div>
        </section>
        <section class="tb-section">
          <h3>当前任务</h3>
          <dl class="tb-meta">
            <div><dt>任务</dt><dd>{{ store.name }}</dd></div>
            <div><dt>架构</dt><dd>{{ architecture }}</dd></div>
            <div><dt>训练</dt><dd :class="{ 'tb-training': store.running }">{{ store.running ? store.phase || '运行中' : '未运行' }}</dd></div>
          </dl>
          <p class="tb-caption">切换任务时同步切换指标页面。</p>
        </section>
        <section class="tb-section">
          <h3>日志位置</h3><p class="tb-caption">任务相对路径</p>
          <code class="tb-path">{{ relativeLogPath }}</code>
          <p v-if="store.architecture === 'krea2'" class="tb-caption tb-path-note">旧版 Krea 2 任务可能读取 logs/；以任务实际日志目录为准。</p>
          <button class="btn tb-copy" :disabled="!store.name" @click="copyPath">复制相对路径</button>
          <p v-if="copyMessage" class="tb-caption tb-copy-message" role="status">{{ copyMessage }}</p>
        </section>
        <section class="tb-section tb-help">
          <h3>看不到曲线？</h3>
          <details open><summary>服务已启动，但没有数据</summary><p>确认训练已写入事件日志。首次写入后，在 TensorBoard 内刷新数据。</p></details>
          <details><summary>页面加载失败</summary><p>先刷新服务状态；仍无法加载时，停止服务后重新启动，也可以在新窗口打开。</p></details>
          <details><summary>停止服务会影响训练吗？</summary><p>这里只停止 TensorBoard 指标服务，训练继续运行。</p></details>
          <p class="tb-caption tb-help-note">服务状态与训练状态分别显示。</p>
        </section>
      </aside>
      <section ref="viewer" class="tb-viewer" aria-label="训练指标">
        <header class="tb-viewer-heading">
          <div class="tb-viewer-title"><h3>训练指标</h3><span v-if="collapsed" class="tb-status" :class="{ 'tb-online': running }" role="status"><i/>{{ serviceLabel }}</span></div>
          <div class="tb-viewer-actions">
            <template v-if="collapsed">
              <button class="btn" :disabled="busy || !store.name" @click="request(running ? 'stop' : 'launch')">{{ powerLabel }}</button>
              <button class="btn" :disabled="busy || !store.name" @click="request()">刷新状态</button>
              <a v-if="running && url" :href="url" target="_blank" rel="noopener noreferrer" class="btn">新窗口打开 <span aria-hidden="true">↗</span></a>
            </template>
            <button v-if="running && url" class="btn" :disabled="busy" @click="frameVersion++">重新加载页面</button>
            <button v-if="running && url && fullscreenAvailable" class="btn" @click="focusViewer">专注查看</button>
          </div>
        </header>
        <iframe v-if="running && url" :key="frameVersion" :src="url" title="TensorBoard 训练指标" class="tb-frame"/>
        <div v-else class="tb-empty" :aria-busy="busy || starting">
          <svg viewBox="0 0 100 70" aria-hidden="true"><path d="M8 5V60H95M14 48L30 36L44 42L62 20L78 27L93 10"/></svg>
          <h3>{{ pending === 'launch' || starting ? 'TensorBoard 正在启动' : pending === 'status' ? '正在检查服务状态' : '准备查看训练指标' }}</h3>
          <p>{{ starting ? '服务仍在准备中，稍后刷新状态查看。' : '启动当前任务的 TensorBoard 后，训练曲线将在这里显示。' }}</p>
          <button class="btn tb-primary" :disabled="busy || !store.name" @click="request(starting ? 'status' : 'launch')">{{ pending === 'launch' ? '正在启动…' : pending === 'status' ? '检查中…' : starting ? '刷新状态' : '启动 TensorBoard' }}</button>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.tb-page { display:flex; flex:1; flex-direction:column; min-width:0; min-height:0; }
.tb-heading { display:flex; flex:none; align-items:center; justify-content:space-between; gap:12px; padding:6px 12px; border-bottom:1px solid var(--border); }
.tb-heading h2 { margin:0; font-size:19px; }
.tb-page .btn { min-height:36px; font-size:12px; gap:7px; }
.tb-heading>.btn { flex-shrink:0; }
.tb-heading svg { width:17px; height:17px; fill:none; stroke:currentColor; stroke-width:1.5; }
.tb-layout { display:grid; flex:1; min-height:0; grid-template-columns:240px minmax(0,1fr); grid-template-rows:minmax(0,1fr); background:var(--card); }
.tb-layout.tb-collapsed { grid-template-columns:minmax(0,1fr); }
.tb-assistance { display:flex; flex-direction:column; min-width:0; min-height:0; overflow:auto; border-right:1px solid var(--border); }
.tb-section { flex-shrink:0; padding:14px 16px; border-bottom:1px solid var(--border); }
.tb-section:last-child { border-bottom:0; }
.tb-page h3 { margin:0 0 10px; font-size:14px; font-weight:600; }
.tb-section-heading { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:14px; }
.tb-section-heading h3,.tb-viewer-title h3 { margin:0; }
.tb-status { display:inline-flex; align-items:center; gap:6px; flex-shrink:0; padding:3px 8px; border:1px solid var(--border); border-radius:20px; color:var(--muted-foreground); font-size:12px; line-height:1.5; }
.tb-status i { width:6px; height:6px; border-radius:50%; background:currentColor; }
.tb-status.tb-online { color:var(--primary); border-color:color-mix(in srgb,var(--primary) 35%,var(--border)); background:color-mix(in srgb,var(--primary) 8%,transparent); }
.tb-controls { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.tb-page .tb-primary { color:var(--primary-foreground); background:var(--primary); border-color:var(--primary); font-weight:600; }
.tb-page .tb-primary:hover { filter:brightness(.95); }
.tb-wide { grid-column:1/-1; }
.tb-meta { display:grid; gap:8px; margin:0 0 10px; font-size:13px; }
.tb-meta>div { display:grid; grid-template-columns:38px minmax(0,1fr); gap:12px; }
.tb-meta dt { color:var(--muted-foreground); }
.tb-meta dd { margin:0; text-align:right; overflow-wrap:anywhere; }
.tb-training { color:var(--primary); }
.tb-caption { margin:0; font-size:12px; line-height:1.7; color:var(--muted-foreground); }
.tb-path { display:block; padding:11px 10px; margin:8px 0 10px; border:1px solid var(--border); border-radius:5px; background:var(--background); color:var(--foreground); font:12px/1.7 Consolas,monospace; overflow-wrap:anywhere; user-select:text; }
.tb-path-note { margin-bottom:10px; }
.tb-copy { width:100%; }
.tb-copy-message { margin-top:8px; }
.tb-help { flex:1; background:color-mix(in srgb,var(--background) 35%,var(--card)); }
.tb-help details { padding:6px 0; border-top:1px solid var(--border); }
.tb-help summary { min-height:26px; padding:3px 0; font-size:13px; color:var(--foreground); line-height:1.6; }
.tb-help details p { margin:6px 0 0; font-size:13px; line-height:1.65; color:var(--muted-foreground); }
.tb-help-note { margin-top:10px; }
.tb-viewer { min-width:0; min-height:0; display:flex; flex-direction:column; background:var(--background); }
.tb-viewer-heading { flex:none; padding:5px 12px; display:flex; align-items:center; justify-content:space-between; gap:12px; border-bottom:1px solid var(--border); background:var(--card); }
.tb-viewer-title { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.tb-viewer-actions { display:flex; justify-content:flex-end; align-items:center; gap:8px; flex-wrap:wrap; }
.tb-frame { display:block; flex:1; width:100%; min-height:0; border:0; background:white; }
.tb-empty { display:flex; flex:1; min-height:0; overflow:auto; flex-direction:column; align-items:center; justify-content:safe center; text-align:center; padding:20px; }
.tb-empty>svg { width:96px; height:70px; margin-bottom:24px; fill:none; stroke:var(--muted-foreground); stroke-width:1.5; opacity:.65; }
.tb-empty h3 { margin-bottom:10px; font-size:18px; }
.tb-empty p { max-width:340px; margin:0 0 22px; font-size:14px; line-height:1.8; color:var(--muted-foreground); }
.tb-empty .btn { min-height:40px; padding-inline:18px; }
.tb-error { flex:none; padding:8px 12px; margin:0; border-bottom:1px solid var(--destructive); color:var(--destructive); background:color-mix(in srgb,var(--destructive) 6%,var(--background)); overflow-wrap:anywhere; }
.tb-viewer:fullscreen { overflow:auto; }
@media(max-width:1000px) { .tb-layout { grid-template-columns:210px minmax(0,1fr); } .tb-section { padding:14px; } .tb-viewer-heading { flex-wrap:wrap; } .tb-viewer-actions { justify-content:flex-start; } }
@media(max-width:760px) {
  .tb-heading { gap:10px; }
  .tb-heading h2 { font-size:18px; }
  .tb-heading>.btn { padding-inline:9px; }
  .tb-layout { grid-template-columns:minmax(0,1fr); }
  .tb-layout:not(.tb-collapsed) { grid-template-rows:minmax(0, 1fr) minmax(0, 3fr); }
  .tb-assistance { border-right:0; border-bottom:1px solid var(--border); }
  .tb-controls { display:flex; flex-wrap:wrap; }
  .tb-controls>.btn { flex:1; }
  .tb-meta>div { grid-template-columns:48px minmax(0,1fr); }
  .tb-help { flex:none; }
}
</style>
