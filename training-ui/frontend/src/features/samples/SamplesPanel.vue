<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useEditorStore } from '@/stores/editor'
import { api, jobUrl } from '@/services/api'
import { groupSamples, moveSamples, rangePaths, type Group, type Sample, type Order } from './gallery'
const store = useEditorStore()
const groups = ref<Group[]>([]), selected = ref(new Set<string>()), anchor = ref<string|null>(null)
const filter = ref(''), loading = ref(false), error = ref(''), metadata = ref('')
const lightbox = ref<Sample|null>(null), root = ref<HTMLElement|null>(null)
const dragPaths = ref<string[]>([]), dragOver = ref('')
const box = reactive({ active: false, x: 0, y: 0, left: 0, top: 0, width: 0, height: 0 })
let boxInitial = new Set<string>(), generation = 0, request = 0
let controller: AbortController | undefined, metadataController: AbortController | undefined
let refreshTimer: ReturnType<typeof setTimeout> | undefined
const visibleGroups = computed(() => groups.value.map(group => ({ ...group, images: group.images.filter(image => image.name.toLowerCase().includes(filter.value.toLowerCase())) })).filter(group => group.images.length))
const images = computed(() => visibleGroups.value.flatMap(group => group.images))
const allImages = computed(() => groups.value.flatMap(group => group.images))
function readOrder(name: string): Order[] {
  try { const value = JSON.parse(localStorage.getItem(`sample_order_${name}`) || '[]'); return Array.isArray(value) ? value.filter(v => typeof v.path === 'string' && typeof v.group === 'string') : [] } catch { return [] }
}
function saveOrder() {
  if (store.name) localStorage.setItem(`sample_order_${store.name}`, JSON.stringify(groups.value.flatMap(group => group.images.map(image => ({ path: image.path, group: group.key })))))
}
async function refresh() {
  if (!store.name) return
  controller?.abort()
  const current = new AbortController(); controller = current
  const name = store.name, version = generation, id = ++request
  loading.value = true; error.value = ''
  try {
    const result = await api<Sample[]>(jobUrl(name, '/samples'), { signal: current.signal })
    if (current.signal.aborted || version !== generation || id !== request) return
    groups.value = groupSamples(result || [], readOrder(name))
    const existing = new Set(allImages.value.map(image => image.path))
    selected.value = new Set([...selected.value].filter(path => existing.has(path)))
    if (lightbox.value && !existing.has(lightbox.value.path)) lightbox.value = null
  } catch (err) { if (!current.signal.aborted && version === generation) error.value = String(err) }
  finally { if (version === generation && id === request) loading.value = false }
}
watch(() => store.name, () => {
  generation++; controller?.abort(); metadataController?.abort(); clearTimeout(refreshTimer)
  groups.value = []; selected.value.clear(); lightbox.value = null; anchor.value = null; filter.value = ''; loading.value = false
  void refresh()
}, { immediate: true })
watch(() => store.runtimeTick, () => { if (!refreshTimer) refreshTimer = setTimeout(() => { refreshTimer = undefined; void refresh() }, 5000) })
watch(() => lightbox.value?.path, async path => {
  metadataController?.abort(); metadata.value = ''
  if (!path) return
  const current = new AbortController(); metadataController = current
  try {
    const name = store.name
    if (!name) return
    const prefixes = [jobUrl(name, '/samples/'), `/api/jobs/${name}/samples/`]
    const prefix = prefixes.find(prefix => path.startsWith(prefix))
    if (!prefix) return
    const result = await api(jobUrl(name, '/metadata/') + path.slice(prefix.length), { signal: current.signal })
    if (!current.signal.aborted && lightbox.value?.path === path) metadata.value = result.parameters || ''
  } catch { /* Images without metadata remain viewable. */ }
})
function clickImage(event: MouseEvent, image: Sample) {
  if (event.shiftKey) selected.value = new Set(rangePaths(images.value, anchor.value, image.path))
  else if (event.ctrlKey || event.metaKey) {
    const next = new Set(selected.value); if (next.has(image.path)) next.delete(image.path); else next.add(image.path); selected.value = next
  } else { selected.value = new Set([image.path]); lightbox.value = image }
  anchor.value = image.path
}
async function remove(paths: string[]) {
  const name = store.name
  if (!name || !paths.length || !window.confirm(`永久删除 ${paths.length} 张样例图片？`)) return
  const version = generation
  const failures: string[] = []
  for (const path of paths) {
    if (version !== generation) break
    const prefix = jobUrl(name, '/samples/')
    if (!path.startsWith(prefix) && !path.startsWith(`/api/jobs/${name}/samples/`)) { failures.push(path); continue }
    try { await api(path, { method: 'DELETE' }) } catch { failures.push(path) }
  }
  if (version !== generation) return
  await refresh()
  if (failures.length) error.value = `${failures.length} 张图片未删除，请刷新后重试。`
}
function dragStart(event: DragEvent, image: Sample) {
  if (!selected.value.has(image.path)) selected.value = new Set([image.path])
  dragPaths.value = images.value.filter(image => selected.value.has(image.path)).map(image => image.path)
  if (event.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', JSON.stringify(dragPaths.value)) }
}
function drop(event: DragEvent, group: string, image?: Sample) {
  event.preventDefault(); event.stopPropagation()
  const element = event.currentTarget as HTMLElement
  const after = !!image && event.clientX > element.getBoundingClientRect().left + element.clientWidth / 2
  groups.value = moveSamples(groups.value, dragPaths.value, group, image?.path, after)
  saveOrder(); dragOver.value = ''; dragPaths.value = []
}
function cards(): HTMLElement[] { return Array.from(root.value?.querySelectorAll<HTMLElement>('[data-sample-path]') || []) }
function nextImage(direction: string, path: string | null): Sample | undefined {
  const list = images.value, index = list.findIndex(image => image.path === path)
  if (index < 0) return list[0]
  if (direction === 'ArrowRight') return list[Math.min(index+1,list.length-1)]
  if (direction === 'ArrowLeft') return list[Math.max(index-1,0)]
  const elements = cards(), current = elements[index]?.getBoundingClientRect()
  if (!current) return list[index]
  let best = index, distance = Infinity
  elements.forEach((element,i) => {
    const rect = element.getBoundingClientRect(), y = rect.top + rect.height/2
    if ((direction === 'ArrowUp' && y < current.top) || (direction === 'ArrowDown' && y > current.bottom)) {
      const score = Math.abs(y-current.top-current.height/2)*2 + Math.abs(rect.left+rect.width/2-current.left-current.width/2)
      if (score < distance) { distance = score; best = i }
    }
  })
  return list[best]
}
function keydown(event: KeyboardEvent) {
  if (!lightbox.value && !root.value?.getClientRects().length) return
  const target = event.target as HTMLElement
  if (target.closest('input,textarea,select,[contenteditable=true]')) return
  if (event.key === 'Escape') { lightbox.value = null; return }
  if (event.key.startsWith('Arrow')) {
    const next = nextImage(event.key, lightbox.value?.path || anchor.value)
    if (!next) return
    event.preventDefault()
    if (event.shiftKey && !lightbox.value) selected.value = new Set(rangePaths(images.value, anchor.value, next.path))
    else { selected.value = new Set([next.path]); anchor.value = next.path }
    if (lightbox.value) lightbox.value = next
    void nextTick(() => cards().find(card => card.dataset.samplePath === next.path)?.scrollIntoView({ block: 'nearest' }))
  } else if (event.key === 'Enter' && selected.value.size === 1) lightbox.value = images.value.find(image => selected.value.has(image.path)) || null
  else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a' && root.value?.contains(target)) { event.preventDefault(); selected.value = new Set(images.value.map(image => image.path)) }
}
function boxStart(event: MouseEvent) {
  if (event.button || (event.target as HTMLElement).closest('[data-sample-path],button,input')) return
  box.active = true; box.x = event.clientX; box.y = event.clientY; box.left = box.x; box.top = box.y; box.width = 0; box.height = 0
  boxInitial = event.ctrlKey || event.metaKey || event.shiftKey ? new Set(selected.value) : new Set()
  selected.value = new Set(boxInitial)
  event.preventDefault()
}
function boxMove(event: MouseEvent) {
  if (!box.active) return
  box.left = Math.min(box.x,event.clientX); box.top = Math.min(box.y,event.clientY); box.width = Math.abs(event.clientX-box.x); box.height = Math.abs(event.clientY-box.y)
  const next = new Set(boxInitial)
  for (const card of cards()) { const rect = card.getBoundingClientRect(); if (rect.right >= box.left && rect.left <= box.left+box.width && rect.bottom >= box.top && rect.top <= box.top+box.height) next.add(card.dataset.samplePath!) }
  selected.value = next
}
function boxEnd() { box.active = false }
onMounted(() => { document.addEventListener('keydown',keydown); document.addEventListener('mousemove',boxMove); document.addEventListener('mouseup',boxEnd) })
onUnmounted(() => { generation++; controller?.abort(); metadataController?.abort(); clearTimeout(refreshTimer); document.removeEventListener('keydown',keydown); document.removeEventListener('mousemove',boxMove); document.removeEventListener('mouseup',boxEnd) })
</script>

<template>
  <section class="panel" ref="root" tabindex="0">
    <header class="toolbar"><h2>样例画廊</h2><input v-model="filter" placeholder="筛选文件名" aria-label="筛选样例" /><button class="button" :disabled="loading" @click="refresh">{{ loading ? '加载中…' : '刷新' }}</button><button v-if="selected.size" class="button" @click="remove([...selected])">删除选中 ({{ selected.size }})</button><button class="button" @click="selected = new Set(images.map(image => image.path))">全选可见图片</button><button class="button" @click="selected.clear()">清除选择</button></header>
    <p class="muted">点击查看；Ctrl/⌘ 多选，Shift 范围选择；空白处拖动框选。拖动图片调整顺序，方向键导航，Enter 查看，Esc 关闭。</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="!images.length && !loading" class="muted">{{ filter ? '没有匹配的样例。' : '暂无样例图片。' }}</p>
    <div class="gallery" @mousedown="boxStart">
      <section v-for="group in visibleGroups" :key="group.key" class="sample-group">
        <h3>{{ group.key === 'default' ? '未分组' : `Prompt ${Number(group.key)+1}` }}</h3>
        <div class="sample-grid" @dragover.prevent @drop="drop($event,group.key)">
          <article v-for="image in group.images" :key="image.path" class="sample-card" :class="{ selected:selected.has(image.path), over:dragOver === image.path }" :data-sample-path="image.path" draggable="true" @click="clickImage($event,image)" @dragstart="dragStart($event,image)" @dragover.stop.prevent="dragOver = image.path" @drop="drop($event,group.key,image)" @dragend="dragOver = ''; dragPaths = []">
            <img :src="image.path" :alt="image.name" loading="lazy" draggable="false" /><span>{{ image.name }}</span><button class="delete-card" aria-label="删除图片" @click.stop="remove([image.path])">×</button>
          </article>
        </div>
      </section>
    </div>
    <Teleport to="body"><div v-if="lightbox" class="sample-lightbox" role="dialog" aria-modal="true" :aria-label="lightbox.name" @click.self="lightbox = null"><button class="lightbox-close button" @click="lightbox = null">关闭 (Esc)</button><h3>{{ lightbox.name }}</h3><img :src="lightbox.path" :alt="lightbox.name" /><div class="lightbox-controls"><button class="button" @click="lightbox = nextImage('ArrowLeft',lightbox.path) || lightbox">上一张</button><a class="button" :href="lightbox.path" :download="lightbox.name">下载</a><button class="button" @click="lightbox = nextImage('ArrowRight',lightbox.path) || lightbox">下一张</button></div><pre v-if="metadata">{{ metadata }}</pre></div><div v-if="box.active" class="sample-selection-box" :style="{left:box.left+'px',top:box.top+'px',width:box.width+'px',height:box.height+'px'}" /></Teleport>
  </section>
</template>

<style scoped>
.toolbar{display:flex;gap:.75rem;align-items:center;flex-wrap:wrap}.gallery{min-height:12rem;padding-bottom:4rem}.sample-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:.75rem;min-height:3rem}.sample-card{position:relative;border:2px solid transparent;border-radius:8px;overflow:hidden;background:var(--muted,#25252b);cursor:pointer}.sample-card.selected{border-color:#60a5fa}.sample-card.over{outline:3px solid #fbbf24}.sample-card img{width:100%;height:180px;object-fit:contain}.sample-card span{display:block;font-size:.75rem;padding:.4rem;overflow-wrap:anywhere}.delete-card{position:absolute;right:4px;top:4px;background:#111b;color:white;border-radius:50%;width:24px;height:24px}.sample-lightbox{position:fixed;inset:0;z-index:1000;background:#09090bf2;color:white;display:flex;align-items:center;flex-direction:column;gap:.5rem;padding:1.5rem;overflow:auto}.sample-lightbox>img{max-height:68vh;max-width:95vw;object-fit:contain}.sample-lightbox pre{white-space:pre-wrap;overflow-wrap:anywhere;max-width:85rem;font-size:.8rem}.lightbox-close{align-self:flex-end}.lightbox-controls{display:flex;gap:1rem}.sample-selection-box{position:fixed;pointer-events:none;z-index:1100;border:1px solid #60a5fa;background:#60a5fa33}
</style>
