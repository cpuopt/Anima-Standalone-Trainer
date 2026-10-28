<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { DialogRoot, DialogPortal, DialogOverlay, DialogContent, DialogTitle, DialogDescription, DialogClose } from 'reka-ui'
import { useEditorStore } from '@/stores/editor'
import { api, jobUrl } from '@/services/api'
const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true })
const store = useEditorStore()
interface Artifact { name: string; path: string; kind: 'models'|'samples'; size: number; mtime: number; version: string; ready: boolean; source: string; label: string }
interface Listing { items: Artifact[]; total: number; pageSize: number; models: number; samples: number; running: boolean; truncated: boolean }
const listing = ref<Listing|null>(null), kind = ref('models'), query = ref(''), source = ref('all'), page = ref(0)
const loading = ref(false), error = ref(''), autoRefresh = ref(true), updated = ref('')
const selected = ref<Artifact|null>(null), details = ref<any>(null), detailError = ref(''), detailLoading = ref(false), imageError = ref(false)
const broken = ref(new Set<string>())
let version = 0, requestId = 0, detailId = 0, controller: AbortController | undefined, detailController: AbortController | undefined
let debounce: ReturnType<typeof setTimeout> | undefined
function size(bytes: number) { return bytes >= 1024 ** 3 ? `${(bytes/1024**3).toFixed(2)} GiB` : bytes >= 1024**2 ? `${(bytes/1024**2).toFixed(1)} MiB` : `${(bytes/1024).toFixed(1)} KiB` }
function time(value: number) { return new Date(value).toLocaleString() }
function url(item: Artifact, download = false, thumbnail = false) {
  return jobUrl(store.name || '', '/artifacts/file') + '?' + new URLSearchParams({ path:item.path, version:item.version, ...(download ? {download:'true'} : {}), ...(thumbnail ? {thumbnail:'true'} : {}) })
}
function close() { selected.value = null; details.value = null; detailError.value = ''; detailController?.abort(); ++detailId }
async function refresh() {
  if (!store.name) return
  controller?.abort(); controller = new AbortController()
  const signal = controller.signal, name = store.name, generation = version, id = ++requestId
  loading.value = true; error.value = ''
  try {
    const params = new URLSearchParams({kind:kind.value, query:query.value, source:kind.value==='models'?'all':source.value, page:String(page.value)})
    const result = await api<Listing>(jobUrl(name, '/artifacts') + '?' + params, {signal})
    if (signal.aborted || generation !== version || name !== store.name || id !== requestId) return
    listing.value = result; updated.value = new Date().toLocaleTimeString(); broken.value = new Set()
    if (page.value && !result.items.length && result.total) { page.value = Math.max(0, Math.ceil(result.total/result.pageSize)-1); void refresh(); return }
    if (selected.value && !result.items.some(item => item.path === selected.value!.path && item.version === selected.value!.version)) close()
  } catch (e: any) { if (!signal.aborted && generation === version && id === requestId) error.value = e.message }
  finally { if (generation === version && id === requestId) loading.value = false }
}
async function preview(item: Artifact) {
  if (!item.ready || !store.name) return
  close(); selected.value = item; imageError.value = false
  if (item.kind === 'samples') return
  detailController = new AbortController(); const signal = detailController.signal, id = ++detailId
  detailLoading.value = true
  try {
    const result = await api(jobUrl(store.name, '/artifacts/preview') + '?' + new URLSearchParams({path:item.path, version:item.version}), {signal})
    if (!signal.aborted && id === detailId) details.value = result
  } catch (e: any) { if (!signal.aborted && id === detailId) detailError.value = e.message }
  finally { if (id === detailId) detailLoading.value = false }
}
watch(() => store.name, () => {
  ++version; controller?.abort(); clearTimeout(debounce); close(); listing.value = null; error.value = ''; query.value = ''; page.value = 0
  if (props.active) void refresh()
}, {immediate:true})
watch([kind, source, query], () => { controller?.abort(); close(); page.value = 0; clearTimeout(debounce); debounce = setTimeout(() => { if (props.active) void refresh() }, 250) })
watch(() => props.active, active => { if (active) void refresh(); else {controller?.abort(); detailController?.abort(); close(); loading.value = false} })
watch(() => store.running, () => { if (props.active) void refresh() })
const timer = setInterval(() => { if (props.active && autoRefresh.value && !loading.value && document.visibilityState === 'visible') void refresh() }, 10000)
onBeforeUnmount(() => { ++version; controller?.abort(); close(); clearInterval(timer); clearTimeout(debounce) })
</script>
<template>
  <section class="artifacts-panel space-y-4" aria-label="训练产出">
    <header class="flex items-center gap-3 flex-wrap"><h2 class="font-semibold mr-auto">训练产出</h2><span v-if="updated" class="muted">更新于 {{updated}}</span><label class="inline-control"><input v-model="autoRefresh" type="checkbox" /> 每 10 秒刷新</label><button class="button" :disabled="loading" @click="refresh">{{loading?'刷新中…':'刷新产出'}}</button></header>
    <p class="muted">查看已实际保存的各轮 / 各步模型及训练 Sample。不会更改保存频率或补回已清理的轮次；权重仅预览文件信息及 Safetensors 元数据，不加载到 GPU。</p>
    <p class="muted">需要每轮都有模型时，请将训练页的 Save Every N Epochs 设为 1，并确认没有启用会清理旧轮次的保留策略。</p>
    <div class="artifact-controls"><button class="button" :aria-pressed="kind==='models'" @click="kind='models'">模型文件（{{listing?.models ?? '—'}}）</button><button class="button" :aria-pressed="kind==='samples'" @click="kind='samples'">Sample 图片（{{listing?.samples ?? '—'}}）</button><input v-model="query" class="artifact-search" placeholder="搜索文件名或相对路径" aria-label="搜索训练产出" /><select v-if="kind==='samples'" v-model="source" aria-label="图片来源"><option value="all">全部图片</option><option value="training">训练 Sample（output/）</option><option value="generation">独立生成（samples/）</option></select></div>
    <p v-if="error" class="text-destructive" role="alert">{{error}}</p>
    <p v-if="listing?.truncated" class="text-destructive" role="status">产出目录较大，扫描已达到条目 / 深度限制，列表可能不完整。</p>
    <p v-if="listing?.running" class="muted" role="status">训练正在运行：近期变化的文件暂不可下载。大模型可能持续写入，请以训练日志中的保存完成提示为准。</p>
    <div v-if="kind==='models' && listing?.items.length" class="artifact-table-scroll"><table class="artifact-table"><thead><tr><th>模型文件</th><th>轮次 / 步数</th><th>大小</th><th>修改时间</th><th>操作</th></tr></thead><tbody><tr v-for="item in listing.items" :key="item.path"><td><strong>{{item.name}}</strong><small>{{item.path}}</small></td><td>{{item.label}}<small v-if="!item.ready">保存中 / 等待文件稳定</small></td><td>{{size(item.size)}}</td><td>{{time(item.mtime)}}</td><td><div class="artifact-actions"><button class="button" :disabled="!item.ready" @click="preview(item)">预览信息</button><a v-if="item.ready" class="button" :href="url(item,true)" :download="item.name">下载模型</a><span v-else class="muted">暂不可下载</span></div></td></tr></tbody></table></div>
    <div v-else-if="kind==='samples' && listing?.items.length" class="artifact-grid"><article v-for="item in listing.items" :key="item.path" class="artifact-image"><button class="artifact-image-button" :aria-label="`预览 ${item.name}`" :disabled="!item.ready" @click="preview(item)"><img v-if="item.ready && !broken.has(item.path)" :src="url(item,false,true)" :alt="item.name" loading="lazy" @error="broken.add(item.path)" /><span v-else>{{item.ready?'缩略图不可用，点击查看原图':'正在写入…'}}</span></button><strong>{{item.name}}</strong><small>{{item.source==='training'?'训练 Sample':'独立生成'}} · {{size(item.size)}}</small><small>{{time(item.mtime)}}</small><a v-if="item.ready" class="button" :href="url(item,true)" :download="item.name">下载图片</a></article></div>
    <p v-else-if="!loading" class="artifact-empty muted">{{query?'没有匹配的产出。':kind==='models'?'尚未发现已保存的模型文件。训练达到配置的保存间隔后会出现在这里。':'暂无 Sample 图片。请在提示词与生成页面配置训练采样，并启用采样间隔。'}}</p>
    <footer v-if="listing" class="artifact-pagination"><button class="button" :disabled="page===0 || loading" @click="page--;refresh()">上一页</button><span>第 {{page+1}} / {{Math.max(1,Math.ceil(listing.total/listing.pageSize))}} 页 · {{listing.total}} 项</span><button class="button" :disabled="(page+1)*listing.pageSize>=listing.total || loading" @click="page++;refresh()">下一页</button></footer>
    <DialogRoot :open="!!selected" @update:open="value=>{if(!value)close()}"><DialogPortal><DialogOverlay class="artifact-overlay"/><DialogContent class="artifact-dialog"><header class="flex items-center gap-3"><DialogTitle class="font-semibold mr-auto break-all">{{selected?.name}}</DialogTitle><DialogClose class="button">关闭预览</DialogClose></header><DialogDescription class="muted">{{selected?.path}} · {{selected ? size(selected.size) : ''}}</DialogDescription><div class="artifact-detail">
      <template v-if="selected?.kind==='samples'"><img v-if="!imageError" :src="url(selected)" :alt="selected.name" class="artifact-full-image" @error="imageError=true"/><p v-else role="alert">浏览器无法显示该图片格式，请下载查看。</p></template>
      <template v-else><p v-if="detailLoading" role="status">正在读取模型头…</p><p v-if="detailError" class="text-destructive" role="alert">{{detailError}}</p><template v-if="details"><p v-if="details.note" class="muted">{{details.note}}</p><p v-if="details.tensorCount!==null">Tensor 数量：{{details.tensorCount}}</p><h3>模型元数据</h3><pre class="artifact-metadata">{{JSON.stringify(details.metadata,null,2)}}</pre><details v-if="details.tensors?.length"><summary>Tensor 结构{{details.tensorsTruncated?'（前 100 项）':''}}</summary><pre class="artifact-metadata">{{JSON.stringify(details.tensors,null,2)}}</pre></details></template></template>
    </div><a v-if="selected?.ready" class="button" :href="url(selected,true)" :download="selected.name">下载 {{selected.name}}</a></DialogContent></DialogPortal></DialogRoot>
  </section>
</template>
<style scoped>
.artifact-controls,.artifact-actions,.artifact-pagination{display:flex;align-items:center;gap:.65rem;flex-wrap:wrap}.artifact-controls button[aria-pressed=true]{background:var(--accent)}.artifact-search{flex:1;min-width:12rem}.artifact-controls input,.artifact-controls select{width:auto;padding:.5rem;border:1px solid var(--border);border-radius:6px;background:var(--background);color:inherit}.inline-control{display:flex;align-items:center;gap:.4rem}.inline-control input{width:auto}.artifact-table-scroll{overflow:auto}.artifact-table{width:100%;border-collapse:collapse;text-align:left;font-size:.85rem}.artifact-table th,.artifact-table td{border-bottom:1px solid var(--border);padding:.8rem .5rem}.artifact-table small{display:block;color:var(--muted-foreground);overflow-wrap:anywhere;max-width:28rem}.artifact-table td:first-child{min-width:14rem;overflow-wrap:anywhere}.artifact-pagination{justify-content:center}.artifact-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:1rem}.artifact-image{border:1px solid var(--border);border-radius:9px;padding:.65rem;display:flex;flex-direction:column;gap:.4rem;min-width:0}.artifact-image strong{font-size:.8rem;overflow-wrap:anywhere}.artifact-image small{color:var(--muted-foreground)}.artifact-image-button{display:grid;place-items:center;width:100%;height:160px;background:var(--muted);border-radius:6px;cursor:pointer}.artifact-image-button img{width:100%;height:160px;object-fit:contain}.artifact-empty{border:1px dashed var(--border);border-radius:8px;padding:3rem 1rem;text-align:center}.artifact-overlay{position:fixed;inset:0;background:#0009;z-index:110}.artifact-dialog{position:fixed;inset:5vh 5vw;background:var(--background);color:var(--foreground);z-index:111;border:1px solid var(--border);border-radius:12px;padding:1.25rem;display:flex;flex-direction:column;gap:.75rem}.artifact-detail{min-height:0;overflow:auto;flex:1}.artifact-full-image{width:100%;height:100%;object-fit:contain}.artifact-metadata{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--muted);padding:1rem;border-radius:6px;font-size:.8rem}.artifact-dialog>a{align-self:flex-start;max-width:100%;overflow-wrap:anywhere}
</style>
