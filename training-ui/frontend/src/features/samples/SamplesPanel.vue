<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useEditorStore } from '@/stores/editor'
import { api, jobUrl } from '@/services/api'
import { groupSamples, moveSamples, rangePaths, type Group, type Sample, type Order } from './gallery'
import SampleViewer from './SampleViewer.vue'
const store = useEditorStore()
const groups = ref<Group[]>([]), selected = ref(new Set<string>()), anchor = ref<string|null>(null)
const filter = ref(''), loading = ref(false), error = ref(''), metadata = ref('')
const activePrompt = ref<string|null>(null), thumbnailSize = ref(108), selecting = ref(false)
const sort = ref('custom')
const lightbox = ref<Sample|null>(null), root = ref<HTMLElement|null>(null)
const dragPaths = ref<string[]>([]), dragOver = ref('')
const box = reactive({ active: false, x: 0, y: 0, left: 0, top: 0, width: 0, height: 0 })
let boxInitial = new Set<string>(), generation = 0, request = 0
let controller: AbortController | undefined, metadataController: AbortController | undefined
let refreshTimer: ReturnType<typeof setTimeout> | undefined
const matchingGroups = computed(() => {
  const query = filter.value.trim().toLowerCase()
  return groups.value.map(group => ({ ...group, images: group.images.filter(image => image.name.toLowerCase().includes(query) || imageLabel(image).toLowerCase().includes(query)) })).filter(group => group.images.length)
})
const visibleGroups = computed(() => matchingGroups.value.filter(group => activePrompt.value === null || group.key === activePrompt.value).map(group => ({ ...group, images: sort.value === 'custom' ? group.images : [...group.images].sort((a,b) => sort.value === 'oldest' ? a.mtime-b.mtime : b.mtime-a.mtime) })))
const images = computed(() => visibleGroups.value.flatMap(group => group.images))
const allImages = computed(() => groups.value.flatMap(group => group.images))
const lightboxIndex = computed(() => images.value.findIndex(image => image.path === lightbox.value?.path))
function groupLabel(key: string) { return key === 'default' ? '未分组' : `Prompt ${Number(key)+1}` }
function imageLabel(image: Sample) {
  const epoch = image.name.match(/_e(\d+)_/)
  return epoch ? `E${Number(epoch[1]).toString().padStart(2,'0')}` : image.name
}
watch(groups, value => { if (activePrompt.value !== null && !value.some(group => group.key === activePrompt.value)) activePrompt.value = null })
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
  groups.value = []; selected.value.clear(); lightbox.value = null; anchor.value = null; filter.value = ''; activePrompt.value = null; selecting.value = false; sort.value = 'custom'; loading.value = false
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
function clickImage(event: MouseEvent | KeyboardEvent, image: Sample) {
  if (event.shiftKey) selected.value = new Set(rangePaths(images.value, anchor.value, image.path))
  else if (selecting.value || event.ctrlKey || event.metaKey) {
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
  sort.value = 'custom'
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
  if (lightbox.value) return // The modal owns its keyboard navigation and focus trap.
  if (!root.value?.getClientRects().length) return
  const target = event.target as HTMLElement
  if (target.closest('input,textarea,select,[contenteditable=true]')) return
  if (event.key === 'Escape') { lightbox.value = null; return }
  if (event.key.startsWith('Arrow')) {
    const next = nextImage(event.key, anchor.value)
    if (!next) return
    event.preventDefault()
    if (event.shiftKey) selected.value = new Set(rangePaths(images.value, anchor.value, next.path))
    else { selected.value = new Set([next.path]); anchor.value = next.path }
    void nextTick(() => cards().find(card => card.dataset.samplePath === next.path)?.scrollIntoView({ block: 'nearest' }))
  } else if (event.key === 'Enter' && selected.value.size === 1) lightbox.value = images.value.find(image => selected.value.has(image.path)) || null
  else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a' && root.value?.contains(target)) { event.preventDefault(); selected.value = new Set(images.value.map(image => image.path)) }
}
function boxStart(event: MouseEvent) {
  if (event.button || (event.target as HTMLElement).closest('[data-sample-path],button,input,select,label')) return
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
  <section class="panel samples-panel" ref="root" tabindex="0" :style="{'--sample-size': thumbnailSize+'px'}">
    <header class="samples-toolbar"><h2>样例</h2><span class="sample-count">{{ images.length }} 张</span><input v-model="filter" type="search" placeholder="搜索文件名或轮次…" aria-label="筛选样例" /><select v-model="sort" aria-label="样例排列顺序"><option value="custom">默认 / 手动顺序</option><option value="newest">最新优先</option><option value="oldest">最早优先</option></select><label class="sample-density">缩略图<input v-model.number="thumbnailSize" type="range" min="90" max="210" aria-label="缩略图尺寸" /></label><button class="button" :class="{active:selecting}" :aria-pressed="selecting" @click="selecting = !selecting">多选</button><button class="button" :disabled="loading" @click="refresh">{{ loading ? '加载中…' : '刷新' }}</button></header>
    <nav class="sample-filters" aria-label="Prompt 分组"><button class="button" :class="{active:activePrompt === null}" :aria-pressed="activePrompt === null" @click="activePrompt = null">全部 {{ allImages.length }}</button><button v-for="group in groups.filter(g => g.images.length)" :key="group.key" class="button" :class="{active:activePrompt === group.key}" :aria-pressed="activePrompt === group.key" @click="activePrompt = group.key">{{ groupLabel(group.key) }} <span>{{ group.images.length }}</span></button><details class="sample-help"><summary>操作说明</summary><p>点击查看；Ctrl/⌘ 多选，Shift 范围选择；空白处拖动框选。拖动图片调整顺序，方向键导航，Enter 查看，Esc 关闭。</p></details></nav>
    <div v-if="selected.size || selecting" class="sample-selection-actions"><span>已选 {{ selected.size }} 张</span><button class="button" @click="selected = new Set(images.map(image => image.path))">全选可见图片</button><button class="button" @click="selected.clear()">清除选择</button><button v-if="selected.size" class="button" @click="remove([...selected])">删除选中 ({{ selected.size }})</button></div>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="!images.length && !loading" class="muted">{{ filter ? '没有匹配的样例。' : '暂无样例图片。' }}</p>
    <div class="gallery sample-gallery-columns" :class="{'single-prompt':visibleGroups.length === 1, selecting}" @mousedown="boxStart">
      <section v-for="group in visibleGroups" :key="group.key" class="sample-group">
        <h3>{{ groupLabel(group.key) }} <span>{{ group.images.length }} 张</span></h3>
        <div class="sample-grid" @dragover.prevent @drop="drop($event,group.key)">
          <article v-for="image in group.images" :key="image.path" class="sample-card" :class="{ selected:selected.has(image.path), over:dragOver === image.path }" :data-sample-path="image.path" :title="image.name" tabindex="0" role="button" :aria-label="`查看 ${image.name}`" :aria-pressed="selected.has(image.path)" draggable="true" @click="clickImage($event,image)" @keydown.enter.stop.prevent="clickImage($event,image)" @keydown.space.stop.prevent="clickImage($event,image)" @dragstart="dragStart($event,image)" @dragover.stop.prevent="dragOver = image.path" @drop="drop($event,group.key,image)" @dragend="dragOver = ''; dragPaths = []">
            <img :src="image.path" :alt="image.name" loading="lazy" draggable="false" /><span class="sample-caption">{{ imageLabel(image) }}</span><span v-if="selecting" class="selection-tick" aria-hidden="true">{{ selected.has(image.path) ? '✓' : '' }}</span><button class="delete-card" aria-label="删除图片" @click.stop="remove([image.path])" @keydown.stop>×</button>
          </article>
        </div>
      </section>
    </div>
    <SampleViewer v-if="lightbox" :image="lightbox" :metadata="metadata" :index="lightboxIndex" :count="images.length" @close="lightbox = null" @navigate="direction => lightbox = nextImage(direction,lightbox!.path) || lightbox" />
    <Teleport to="body"><div v-if="box.active" class="sample-selection-box" :style="{left:box.left+'px',top:box.top+'px',width:box.width+'px',height:box.height+'px'}" /></Teleport>
  </section>
</template>

<style scoped>
.samples-panel{padding:12px;overflow:visible}.samples-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:9px}.samples-toolbar h2{margin:0;font-size:18px}.sample-count{font-size:12px;color:var(--muted-foreground);margin-right:auto}.samples-toolbar input[type=search]{width:220px}.samples-toolbar select{width:auto;font-size:12px}.sample-density{display:flex;align-items:center;gap:6px;color:var(--muted-foreground);font-size:12px}.sample-density input[type=range]{width:80px;min-height:30px;padding:0;border:0;accent-color:var(--primary)}.samples-toolbar .button,.sample-filters .button,.sample-selection-actions .button{min-height:34px;padding:5px 10px;font-size:12px}.samples-panel .button.active{background:var(--accent);border-color:var(--primary);color:var(--primary)}.sample-filters{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--border)}.sample-filters .button{border-radius:18px;min-height:30px}.sample-filters .button span{margin-left:4px;opacity:.8}.sample-help{margin-left:auto;position:relative;font-size:12px;color:var(--muted-foreground)}.sample-help p{position:absolute;right:0;top:100%;z-index:5;width:280px;padding:12px;background:var(--card);border:1px solid var(--border);border-radius:6px;font-size:12px}.sample-selection-actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:10px;font-size:12px}.gallery{min-height:12rem;padding-bottom:20px}.sample-gallery-columns{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(280px,100%),1fr));gap:12px;align-items:start}.sample-group{min-width:0}.sample-group h3{display:flex;align-items:center;justify-content:space-between;font-size:12px;margin:0 0 6px;font-weight:600}.sample-group h3 span{font-weight:400;color:var(--muted-foreground)}.sample-grid{columns:var(--sample-size);column-gap:5px;min-height:3rem}.single-prompt{grid-template-columns:minmax(0,1fr)}.single-prompt .sample-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,var(--sample-size)),1fr));align-items:start;gap:5px;columns:auto}.sample-card{position:relative;break-inside:avoid;border-radius:3px;overflow:hidden;background:var(--muted);cursor:pointer;margin-bottom:5px;line-height:0}.single-prompt .sample-card{margin-bottom:0}.sample-card.selected{outline:3px solid var(--primary);outline-offset:-3px}.sample-card.over{outline:3px solid #fbbf24;outline-offset:-3px}.sample-card img{display:block;width:100%;height:auto}.sample-caption{display:block;position:absolute;bottom:0;left:0;right:0;padding:16px 5px 4px;background:linear-gradient(transparent,#080c13e8);color:#fff;font-size:12px;line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;pointer-events:none}.selection-tick{position:absolute;top:5px;left:5px;width:20px;height:20px;border:1px solid #fff9;border-radius:3px;background:#10151fcc;color:#fff;line-height:18px;text-align:center;font-size:12px}.selected .selection-tick{background:#326cd4}.delete-card{position:absolute;right:4px;top:4px;background:#111c;color:white;border-radius:4px;width:28px;height:28px;font-size:18px;line-height:1;opacity:0}.sample-card:hover .delete-card,.sample-card:focus-within .delete-card{opacity:1}.sample-selection-box{position:fixed;pointer-events:none;z-index:1100;border:1px solid #60a5fa;background:#60a5fa33}
@media(max-width:1000px){.samples-toolbar input[type=search]{width:170px}.sample-density{display:none}}
@media(max-width:600px){.samples-panel{padding:8px}.samples-toolbar{gap:6px}.samples-toolbar input[type=search]{order:5;width:100%}.samples-toolbar select{max-width:130px}.sample-filters{gap:4px}.sample-help{margin-left:0}.sample-gallery-columns{display:block}.sample-group{margin-bottom:12px}.sample-grid{columns:3;column-gap:4px}.single-prompt .sample-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:4px}.sample-card{margin-bottom:4px}.delete-card{opacity:1}}
</style>
