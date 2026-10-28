<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { DialogRoot, DialogPortal, DialogOverlay, DialogContent, DialogTitle, DialogDescription, DialogClose } from 'reka-ui'
import { api } from '@/services/api'
import { droppedFiles, isArchive, selectDatasetFiles, uploadDatasetFile, type DatasetFile } from './dataset-files'

const props = defineProps<{ directory: string; mode: 'import' | 'browse'; captionExtension?: string; disabled?: boolean }>()
const emit = defineEmits<{ close: []; imported: [directories: string[]] }>()
const tab = ref(props.mode), bindingPath = ref(props.directory), error = ref(''), info = ref('')
const files = ref<DatasetFile[]>([]), skipped = ref(0), dragging = ref(false), scanning = ref(false)
const phase = ref('input'), progress = ref(0), currentFile = ref(''), summary = ref<any>(null)
const importId = ref(''), bindingId = ref(''), browsePath = ref(''), page = ref(0), query = ref(''), missing = ref(false)
const listing = ref<any>(null), loading = ref(false), selected = ref<any>(null), caption = ref(''), captionError = ref(''), imageError = ref(false)
const kind = ref('images'), captionLoading = ref(false)
const brokenThumbnails = ref(new Set<string>())
let disposed = false, generation = 0, previewGeneration = 0
let controller = new AbortController(), listController: AbortController | undefined, previewController: AbortController | undefined
let searchTimer: ReturnType<typeof setTimeout> | undefined
const busy = computed(() => ['uploading', 'preparing', 'committing'].includes(phase.value))
const picked = computed(() => files.value.length ? selectDatasetFiles(files.value) : null)
const archive = computed(() => files.value.length === 1 && isArchive(files.value[0]!.path))
function bytes(n: number) { return n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GiB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MiB` : `${(n / 1024).toFixed(1)} KiB` }
async function discard(id: string) { if (id) await api(`/api/datasets/imports/${id}`, { method: 'DELETE' }).catch(() => {}) }
function fileUrl(path: string, thumbnail = false) {
  return `/api/datasets/roots/${encodeURIComponent(bindingId.value)}/file?${new URLSearchParams({ path, ...(thumbnail ? { thumbnail: 'true' } : {}) })}`
}
async function choose(items: DatasetFile[]) {
  if (busy.value || scanning.value) return
  try {
    const result = selectDatasetFiles(items)
    const old = importId.value; importId.value = ''; void discard(old)
    files.value = result.files; skipped.value = result.skipped; summary.value = null; phase.value = 'input'; error.value = ''; info.value = ''
  } catch (e: any) { error.value = e.message }
}
function inputFiles(event: Event) {
  const input = event.target as HTMLInputElement
  void choose(Array.from(input.files || []).map(file => ({ file, path: file.webkitRelativePath || file.name })))
  input.value = ''
}
async function drop(event: DragEvent) {
  dragging.value = false
  if (!event.dataTransfer || busy.value || props.disabled || scanning.value) return
  scanning.value = true
  try { const items = await droppedFiles(event.dataTransfer); scanning.value = false; if (!disposed) await choose(items) }
  catch (e: any) { error.value = e.message }
  finally { scanning.value = false }
}
function sleep(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException('已取消', 'AbortError')) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, 700)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
}
async function prepare() {
  if (!picked.value || busy.value || props.disabled) return
  const version = ++generation
  controller.abort(); controller = new AbortController(); const signal = controller.signal
  error.value = ''; info.value = ''; phase.value = 'uploading'; progress.value = 0
  const selection = picked.value
  let id = ''
  try {
    const old = importId.value; importId.value = ''; await discard(old)
    const session = await api('/api/datasets/imports', { method: 'POST', signal })
    id = session.id
    if (disposed || version !== generation || signal.aborted) { void discard(id); return }
    importId.value = id
    let uploaded = 0
    for (const item of selection.files) {
      currentFile.value = item.path
      await uploadDatasetFile(id, item, signal, loaded => { progress.value = Math.round((uploaded + loaded) / Math.max(1, selection.bytes) * 100) })
      uploaded += item.file.size
    }
    phase.value = 'preparing'; currentFile.value = archive.value ? '正在检查并安全解压压缩包…' : '正在检查图片与 Caption…'
    let result = await api(`/api/datasets/imports/${id}/prepare`, { method: 'POST', signal })
    while (result.phase === 'preparing') {
      await sleep(signal)
      result = await api(`/api/datasets/imports/${id}`, { signal })
      currentFile.value = `正在检查 / 解压，已处理 ${result.processed} 个文件…`
    }
    if (disposed || version !== generation) return
    if (result.phase !== 'ready') throw Error(result.error || '检查失败')
    summary.value = result.summary; phase.value = 'ready'
  } catch (e: any) {
    if (version === generation && !disposed) { phase.value = 'input'; if (e.name !== 'AbortError') error.value = e.message }
    void discard(id)
    if (importId.value === id) importId.value = ''
  }
}
async function commit() {
  if (phase.value !== 'ready' || props.disabled) return
  phase.value = 'committing'; error.value = ''
  try {
    // Do not abort a publish on modal close: it is atomic and its result must reach the parent.
    const result = await api(`/api/datasets/imports/${importId.value}/commit`, { method: 'POST' })
    importId.value = ''; phase.value = 'done'
    if (!disposed) emit('imported', result.directories.map((d: any) => d.path))
  } catch (e: any) { phase.value = 'ready'; error.value = e.message }
}
async function bind(use = false) {
  if (loading.value || (use && props.disabled)) return
  error.value = ''; info.value = ''; loading.value = true
  try {
    const binding = await api('/api/datasets/bind', { method: 'POST', body: { path: bindingPath.value }, signal: controller.signal })
    if (disposed) return
    bindingId.value = binding.id; bindingPath.value = binding.path
    if (use) { emit('imported', [binding.path]); return }
    browsePath.value = ''; page.value = 0; tab.value = 'browse'; await load()
  } catch (e: any) { if (!disposed && e.name !== 'AbortError') error.value = e.message }
  finally { loading.value = false }
}
async function load() {
  if (!bindingId.value) return
  listController?.abort(); listController = new AbortController(); const signal = listController.signal
  loading.value = true; selected.value = null; error.value = ''; brokenThumbnails.value = new Set()
  try {
    const params = new URLSearchParams({ directory: browsePath.value, page: String(page.value), query: query.value, missing: String(missing.value && kind.value === 'images'), captionExtension: props.captionExtension || '.txt', kind: kind.value })
    const result = await api(`/api/datasets/roots/${bindingId.value}?${params}`, { signal })
    if (!signal.aborted && !disposed) listing.value = result
  } catch (e: any) { if (!signal.aborted && !disposed) { error.value = e.message; listing.value = null } }
  finally { if (!signal.aborted) loading.value = false }
}
function navigate(directory: string) { browsePath.value = directory; page.value = 0; void load() }
async function select(item: any) {
  selected.value = item; caption.value = ''; captionError.value = ''; imageError.value = false; captionLoading.value = false
  const version = ++previewGeneration
  previewController?.abort(); previewController = new AbortController()
  if (!item.caption) return
  captionLoading.value = true
  try {
    const response = await fetch(fileUrl(item.caption), { signal: previewController.signal })
    if (!response.ok) {
      const data = await response.json().catch(() => ({})); throw Error(data.error || 'TXT 读取失败')
    }
    const text = await response.text()
    if (version === previewGeneration && !disposed) caption.value = text
  } catch (e: any) { if (e.name !== 'AbortError' && version === previewGeneration && !disposed) captionError.value = e.message }
  finally { if (version === previewGeneration && !disposed) captionLoading.value = false }
}
function close() { if (phase.value !== 'committing') emit('close') }
watch([query, missing, kind], () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { page.value = 0; void load() }, 250) })
watch(() => props.disabled, disabled => { if (disabled && busy.value && phase.value !== 'committing') { ++generation; controller.abort(); phase.value = 'input'; error.value = '训练或任务状态发生变化，已取消导入'; void discard(importId.value); importId.value = '' } })
onBeforeUnmount(() => {
  disposed = true; ++generation; controller.abort(); listController?.abort(); previewController?.abort(); clearTimeout(searchTimer)
  if (phase.value !== 'committing') void discard(importId.value)
})
if (props.mode === 'browse' && props.directory) void bind()
</script>

<template>
  <DialogRoot :open="true" @update:open="value => { if (!value) close() }">
    <DialogPortal>
      <DialogOverlay class="dataset-overlay" />
      <DialogContent class="dataset-dialog" @escape-key-down="event => { if (phase === 'committing') event.preventDefault() }" @pointer-down-outside="event => event.preventDefault()">
        <header class="manager-header"><div><DialogTitle class="manager-title">数据集文件</DialogTitle><DialogDescription class="muted">导入图片与 TXT，或只读预览服务器上的数据集目录。</DialogDescription></div><DialogClose class="button" :disabled="phase === 'committing'" aria-label="关闭数据集文件窗口">关闭</DialogClose></header>
        <nav class="manager-tabs" aria-label="数据集文件功能"><button class="button" :aria-pressed="tab === 'import'" @click="tab = 'import'">导入数据集</button><button class="button" :aria-pressed="tab === 'browse'" @click="tab = 'browse'">浏览 / 预览</button></nav>
        <p v-if="error" role="alert" class="manager-error">{{ error }}</p><p v-if="info" role="status">{{ info }}</p>
        <div v-if="tab === 'import'" class="import-body">
          <section class="bind-row"><label for="dataset-bind-path">服务器已有目录（不复制文件）</label><div class="manager-actions"><input id="dataset-bind-path" v-model="bindingPath" class="input path-input" placeholder="例如 D:/datasets/character 或 /data/character" :disabled="busy || disabled" /><button class="button" :disabled="!bindingPath.trim() || busy || loading || disabled" @click="bind(true)">使用此目录</button></div></section>
          <section class="drop-area" :class="{ dragging }" @dragover.prevent="dragging = true" @dragleave.prevent="dragging = false" @drop.prevent="drop">
            <strong>{{ scanning ? '正在扫描文件夹…' : '拖入图片、TXT、文件夹，或单个 ZIP / 7z' }}</strong>
            <p class="muted">压缩包自动解压；保留目录结构。只导入图片与 TXT，不覆盖原有数据。</p>
            <div class="manager-actions"><label class="button picker-label" :class="{ inactive: busy || disabled || scanning }">选择文件<input aria-label="选择图片 TXT 或压缩包" type="file" multiple accept=".png,.jpg,.jpeg,.webp,.bmp,.avif,.jxl,.txt,.zip,.7z" :disabled="busy || disabled || scanning" @change="inputFiles" /></label><label class="button picker-label" :class="{ inactive: busy || disabled || scanning }">选择文件夹<input aria-label="选择数据集文件夹" type="file" webkitdirectory multiple :disabled="busy || disabled || scanning" @change="inputFiles" /></label></div>
          </section>
          <section v-if="picked" class="import-summary">
            <p><strong>{{ archive ? files[0]?.file.name : `已选择 ${picked.files.length} 个文件` }}</strong> · {{ bytes(picked.bytes) }}<span v-if="skipped"> · 已忽略 {{ skipped }} 个非数据文件</span></p>
            <p v-if="!archive">图片 {{ picked.images }} · TXT {{ picked.captions }} · 缺 Caption {{ picked.missing }} · 孤立 TXT {{ picked.orphan }}</p>
            <p v-else class="muted">上传后检查压缩包内容；不支持加密、分卷、嵌套压缩包或链接文件。</p>
            <p class="muted">每文件最多 1 GiB，上传合计 8 GiB，解压最多 16 GiB / 10000 个条目。</p>
            <progress v-if="busy" :value="phase === 'uploading' ? progress : undefined" max="100" aria-label="上传及检查进度" />
            <p v-if="busy" role="status">{{ phase === 'uploading' ? `上传 ${progress}%：${currentFile}` : phase === 'committing' ? '正在导入…' : currentFile }}</p>
            <button v-if="phase === 'input'" class="button primary" :disabled="disabled || scanning" @click="prepare">上传并检查</button>
            <button v-if="['uploading','preparing'].includes(phase)" class="button" @click="close">取消导入</button>
          </section>
          <section v-if="summary" class="import-summary">
            <h3>导入检查</h3><p>图片 {{ summary.images }} · TXT {{ summary.captions }} · 缺 Caption {{ summary.missing }} · 孤立 TXT {{ summary.orphan }} · {{ bytes(summary.bytes) }}</p>
            <p v-if="summary.skipped" class="muted">忽略了 {{ summary.skipped }} 个非图片 / TXT 文件。</p>
            <ul><li v-for="group in summary.groups" :key="group.directory">{{ group.directory === '.' ? '根目录' : group.directory }}：{{ group.images }} 张</li></ul>
            <p class="muted">每个含图片的目录会绑定为独立子集，继承当前子集参数。仅写入新的管理目录；导入后需保存任务配置。</p>
            <button class="button primary" :disabled="phase !== 'ready' || disabled" @click="commit">确认导入并绑定 {{ summary.groups.length }} 个目录</button>
          </section>
        </div>
        <div v-else class="browse-body">
          <div class="manager-actions"><input v-model="bindingPath" class="input path-input" aria-label="预览服务器目录" placeholder="服务器绝对目录路径" /><button class="button" :disabled="!bindingPath.trim() || loading" @click="bind()">打开预览</button></div>
          <template v-if="bindingId && listing">
            <div class="manager-actions"><button class="button" :disabled="!browsePath || loading" @click="navigate(browsePath.split('/').slice(0,-1).join('/'))">上一级</button><code class="current-path">{{ browsePath || '/' }}</code><button class="button" :disabled="loading" @click="load">刷新</button></div>
            <div class="manager-actions"><select v-model="kind" class="input" aria-label="预览文件类型"><option value="images">图片</option><option value="captions">TXT 文件</option></select><input v-model="query" class="input" aria-label="搜索文件名" placeholder="搜索当前目录文件…" /><label v-if="kind === 'images'"><input v-model="missing" type="checkbox" /> 仅缺 Caption</label><span class="muted">图片 {{ listing.images }} · 缺 Caption {{ listing.missing }} · 孤立 TXT {{ listing.orphan }}</span></div>
            <div class="asset-layout" :aria-busy="loading">
              <div class="asset-catalog">
                <div class="folder-list"><button v-for="folder in listing.folders" :key="folder.path" class="button" @click="navigate(folder.path)">📁 {{ folder.name }}</button></div>
                <div class="image-grid"><button v-for="item in listing.items" :key="item.path" class="image-card" :class="{ selected: selected?.path === item.path }" :aria-label="`预览 ${item.name}`" @click="select(item)"><span v-if="item.kind === 'text'" class="thumbnail-fallback">TXT</span><img v-else-if="!brokenThumbnails.has(item.path)" :src="fileUrl(item.path, true)" alt="" loading="lazy" @error="brokenThumbnails.add(item.path)" /><span v-else class="thumbnail-fallback">无法生成缩略图</span><span class="asset-name">{{ item.name }}</span><small v-if="item.kind !== 'text'" :class="{ 'manager-error': !item.caption }">{{ item.caption ? 'TXT ✓' : '缺少 Caption' }}</small></button></div>
                <p v-if="!listing.items.length" class="muted">{{ loading ? '加载中…' : '当前目录没有匹配的文件' }}</p>
                <div class="manager-actions pagination"><button class="button" :disabled="page === 0 || loading" @click="page--; load()">上一页</button><span>{{ page + 1 }} / {{ Math.max(1, Math.ceil(listing.total / listing.pageSize)) }}</span><button class="button" :disabled="(page + 1) * listing.pageSize >= listing.total || loading" @click="page++; load()">下一页</button></div>
              </div>
              <aside class="asset-preview" aria-label="图片与 Caption 预览">
                <template v-if="selected"><strong class="asset-name">{{ selected.name }}</strong><template v-if="selected.kind !== 'text'"><img v-if="!imageError" :key="selected.path" :src="fileUrl(selected.path)" :alt="selected.name" class="large-preview" @error="imageError = true" @load="(event: Event) => { const img = event.target as HTMLImageElement; if (selected) selected.dimensions = `${img.naturalWidth} × ${img.naturalHeight}` }" /><p v-else class="muted">浏览器无法显示此格式的原图。</p><small v-if="selected.dimensions">{{ selected.dimensions }}</small></template><h4>{{ selected.kind === 'text' ? 'TXT 内容（只读）' : '同名 TXT（只读）' }}</h4><p v-if="captionError" role="alert" class="manager-error">{{ captionError }}</p><pre v-else-if="selected.caption" class="caption-text">{{ captionLoading ? '正在加载…' : caption || '（空 Caption）' }}</pre><p v-else class="muted">未找到同名 {{ captionExtension || '.txt' }} 文件。</p></template>
                <p v-else class="muted">选择图片，同时查看原图与同名 TXT。</p>
              </aside>
            </div>
          </template>
          <p v-else-if="loading" role="status">正在加载目录…</p>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style scoped>
.dataset-overlay{position:fixed;inset:0;background:#0009;z-index:100}
.dataset-dialog{position:fixed;inset:5vh 4vw;z-index:101;background:var(--background,#17191f);color:var(--foreground,#eceef2);border:1px solid var(--border,#444);border-radius:12px;box-shadow:0 20px 80px #0008;display:flex;flex-direction:column;padding:1.25rem;gap:1rem;overflow:hidden}
.manager-header{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem}.manager-title{font-size:1.25rem;font-weight:650}.manager-header p{margin:.4rem 0 0}.manager-tabs,.manager-actions{display:flex;align-items:center;gap:.65rem;flex-wrap:wrap}.manager-tabs button[aria-pressed=true]{background:var(--accent,#343c55)}
.import-body,.browse-body{overflow:auto;min-height:0;display:flex;flex-direction:column;gap:1rem}.path-input{flex:1;min-width:12rem}.input{padding:.55rem .75rem;border:1px solid var(--border,#444);border-radius:6px;background:transparent;color:inherit}.bind-row label{display:block;margin-bottom:.5rem}.drop-area{border:2px dashed var(--border,#555);border-radius:10px;padding:2rem;text-align:center}.drop-area .manager-actions{justify-content:center}.drop-area.dragging{border-color:var(--primary,#91a8ff);background:#7899ff12}.picker-label{position:relative;cursor:pointer}.picker-label input{position:absolute;width:1px;height:1px;opacity:0}.picker-label:focus-within{outline:2px solid var(--primary,#91a8ff)}.inactive{opacity:.45;cursor:not-allowed}.import-summary{border:1px solid var(--border,#444);padding:1rem;border-radius:8px}.import-summary ul{max-height:9rem;overflow:auto;padding-left:1.5rem}.manager-error{color:var(--destructive,#f08080);overflow-wrap:anywhere}.import-summary progress{width:100%}.current-path{overflow-wrap:anywhere;flex:1}
.asset-layout{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(250px,1fr);gap:1rem;min-height:0}.asset-catalog{min-width:0}.folder-list{display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:.75rem}.image-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:.65rem}.image-card{background:transparent;color:inherit;border:1px solid var(--border,#444);border-radius:8px;padding:.5rem;display:flex;flex-direction:column;gap:.35rem;text-align:left;cursor:pointer;min-width:0}.image-card.selected{border-color:var(--primary,#91a8ff);background:#7899ff12}.image-card img,.thumbnail-fallback{width:100%;height:105px;object-fit:contain;border-radius:4px;background:#8881}.thumbnail-fallback{display:grid;place-items:center;font-size:.75rem}.asset-name{display:block;overflow-wrap:anywhere;font-size:.85rem}.pagination{justify-content:center;margin-top:1rem}.asset-preview{border:1px solid var(--border,#444);border-radius:8px;padding:1rem;min-width:0;align-self:start;position:sticky;top:0}.large-preview{display:block;width:100%;max-height:40vh;object-fit:contain;margin:.75rem 0}.caption-text{white-space:pre-wrap;overflow-wrap:anywhere;max-height:25vh;overflow:auto;font-family:inherit;font-size:.85rem}.asset-preview h4{margin:1rem 0 .5rem}
.manager-actions>.input{width:auto;min-width:0}.manager-actions>.input:not(select){flex:1}.manager-actions input[type=checkbox]{width:auto}.large-preview{max-height:22vh}
@media(max-width:760px){.dataset-dialog{inset:2vh 2vw;padding:.8rem}.asset-layout{grid-template-columns:1fr}.asset-preview{position:static}.drop-area{padding:1rem}}
</style>
