<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import type { Sample } from './gallery'

const props = defineProps<{ image: Sample; metadata: string; index: number; count: number }>()
const emit = defineEmits<{ close: []; navigate: [direction: string] }>()
const dialog = ref<HTMLElement|null>(null), stage = ref<HTMLElement|null>(null), photo = ref<HTMLImageElement|null>(null)
const showInfo = ref(true), imageError = ref(false), copied = ref(false)
const size = reactive({width:0,height:0}), view = reactive({scale:1,fit:1,x:0,y:0})
const pointers = new Map<number,{x:number;y:number}>()
const dragging = ref(false)
let drag: {x:number;y:number;panX:number;panY:number}|null = null, pinchDistance = 0
let observer: ResizeObserver|undefined, previousFocus: HTMLElement|null = null, previousOverflow = '', copyTimer: ReturnType<typeof setTimeout>|undefined
let disposed = false
const transform = computed(() => ({width:size.width+'px',height:size.height+'px',transform:`translate(${view.x-size.width*view.scale/2}px,${view.y-size.height*view.scale/2}px) scale(${view.scale})`}))
function fit() {
  if (!stage.value || !size.width || !size.height) return
  view.fit = Math.max(.001,Math.min(Math.max(1,stage.value.clientWidth-24)/size.width,Math.max(1,stage.value.clientHeight-24)/size.height))
  view.scale = view.fit; view.x = 0; view.y = 0
}
function imageLoaded() {
  if (!photo.value) return
  size.width = photo.value.naturalWidth; size.height = photo.value.naturalHeight
  imageError.value = false; fit()
}
function zoom(factor: number, x?: number, y?: number) {
  if (!stage.value || !size.width) return
  const previous = view.scale
  view.scale = Math.max(view.fit*.25,Math.min(Math.max(8,view.fit),view.scale*factor))
  const cx = (x ?? stage.value.clientWidth/2)-stage.value.clientWidth/2
  const cy = (y ?? stage.value.clientHeight/2)-stage.value.clientHeight/2
  view.x = cx-(cx-view.x)*view.scale/previous; view.y = cy-(cy-view.y)*view.scale/previous
}
function wheel(event: WheelEvent) {
  const bounds = stage.value!.getBoundingClientRect()
  zoom(Math.exp(-Math.max(-120,Math.min(120,event.deltaY))*.002),event.clientX-bounds.left,event.clientY-bounds.top)
}
function pointerDown(event: PointerEvent) {
  if (event.button !== 0) return
  pointers.set(event.pointerId,{x:event.clientX,y:event.clientY})
  stage.value?.setPointerCapture(event.pointerId); dragging.value = true
  if (pointers.size === 1) drag = {x:event.clientX,y:event.clientY,panX:view.x,panY:view.y}
  if (pointers.size === 2) { const [a,b] = [...pointers.values()]; pinchDistance = Math.hypot(a!.x-b!.x,a!.y-b!.y) }
}
function pointerMove(event: PointerEvent) {
  if (!pointers.has(event.pointerId)) return
  pointers.set(event.pointerId,{x:event.clientX,y:event.clientY})
  if (pointers.size === 2) {
    const [a,b] = [...pointers.values()], bounds = stage.value!.getBoundingClientRect()
    const distance = Math.hypot(a!.x-b!.x,a!.y-b!.y)
    if (pinchDistance > 0) zoom(distance/pinchDistance,(a!.x+b!.x)/2-bounds.left,(a!.y+b!.y)/2-bounds.top)
    pinchDistance = distance
  } else if (drag) { view.x = drag.panX+event.clientX-drag.x; view.y = drag.panY+event.clientY-drag.y }
}
function pointerEnd(event: PointerEvent) {
  pointers.delete(event.pointerId); pinchDistance = 0; drag = null
  dragging.value = pointers.size > 0
  const remaining = [...pointers.values()][0]
  if (remaining) drag = {x:remaining.x,y:remaining.y,panX:view.x,panY:view.y}
}
function actualSize() { view.scale = 1; view.x = 0; view.y = 0 }
function navigate(direction: string) { emit('navigate',direction) }
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); emit('close'); return }
  if (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable=true]')) return
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); navigate(event.key) }
  if (event.key === '0') { event.preventDefault(); fit() }
  if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(1.25) }
  if (event.key === '-') { event.preventDefault(); zoom(.8) }
  if (event.key === 'Tab') {
    const controls = [...(dialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href]') || [])].filter(el => el.getClientRects().length)
    const first = controls[0], last = controls.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }
}
async function copyMetadata() {
  try { await navigator.clipboard.writeText(props.metadata); if (!disposed) { copied.value = true; clearTimeout(copyTimer); copyTimer = setTimeout(() => copied.value = false,2000) } }
  catch { /* Metadata remains selectable when clipboard access is unavailable. */ }
}
watch(() => props.image.path, async () => {
  imageError.value = false; copied.value = false; size.width = 0; size.height = 0
  pointers.clear(); drag = null; pinchDistance = 0; dragging.value = false
  await nextTick()
  if (photo.value?.complete && photo.value.naturalWidth) imageLoaded()
})
watch(showInfo, async () => { await nextTick(); fit() })
onMounted(() => {
  previousFocus = document.activeElement as HTMLElement
  previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'
  dialog.value?.querySelector<HTMLElement>('button')?.focus()
  if (typeof ResizeObserver !== 'undefined' && stage.value) { observer = new ResizeObserver(fit); observer.observe(stage.value) }
  window.addEventListener('resize',fit); document.addEventListener('keydown',keydown)
  if (photo.value?.complete && photo.value.naturalWidth) imageLoaded()
})
onUnmounted(() => {
  disposed = true; observer?.disconnect(); clearTimeout(copyTimer)
  window.removeEventListener('resize',fit); document.removeEventListener('keydown',keydown)
  document.body.style.overflow = previousOverflow
  if (previousFocus?.isConnected) previousFocus.focus({preventScroll:true})
})
</script>

<template>
  <Teleport to="body">
    <section ref="dialog" class="sample-lightbox" :class="{'no-info':!showInfo}" role="dialog" aria-modal="true" :aria-label="image.name">
      <header class="viewer-header">
        <button class="viewer-button viewer-close" aria-label="关闭详情" title="关闭 (Esc)" @click="emit('close')">×</button>
        <span class="viewer-name" :title="image.name">{{ image.name }}</span><span class="viewer-spacer" />
        <button class="viewer-button" aria-label="上一张" :disabled="index <= 0" @click="navigate('ArrowLeft')">‹</button><span class="viewer-counter">{{ index+1 }} / {{ count }}</span><button class="viewer-button" aria-label="下一张" :disabled="index >= count-1" @click="navigate('ArrowRight')">›</button>
        <a class="viewer-button" :href="image.path" :download="image.name">下载</a><button class="viewer-button" :aria-expanded="showInfo" aria-controls="sample-inspector" @click="showInfo = !showInfo">参数</button>
      </header>
      <div class="viewer-body">
        <div class="viewer-stage-wrap">
          <div ref="stage" class="viewer-stage" :class="{dragging}" :data-scale="view.scale" :data-pan="`${Math.round(view.x)},${Math.round(view.y)}`" aria-label="图片画布，可滚轮缩放和拖动" @wheel.stop.prevent="wheel" @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerEnd" @pointercancel="pointerEnd" @lostpointercapture="pointerEnd" @dblclick="fit">
            <img :key="image.path" ref="photo" :src="image.path" :alt="image.name" :style="transform" draggable="false" @load="imageLoaded" @error="imageError = true" />
            <p v-if="imageError" class="viewer-image-message" role="alert">图片加载失败，请关闭后刷新重试。</p><p v-else-if="!size.width" class="viewer-image-message" role="status">正在加载图片…</p>
          </div>
          <span class="viewer-hint">滚轮缩放 · 拖动平移 · 双击适应</span>
          <div class="viewer-zoom"><button class="viewer-button" aria-label="缩小" @click="zoom(.8)">−</button><output>{{ Math.round(view.scale*100) }}%</output><button class="viewer-button" aria-label="放大" @click="zoom(1.25)">＋</button><button class="viewer-button" @click="fit">适应窗口</button><button class="viewer-button" @click="actualSize">1:1</button></div>
        </div>
        <aside v-show="showInfo" id="sample-inspector" class="viewer-inspector" aria-label="图片参数">
          <h2>图片参数</h2><h3>尺寸</h3><p>{{ size.width && size.height ? `${size.width} × ${size.height}` : '—' }}</p><h3>文件名</h3><p class="viewer-file">{{ image.name }}</p><h3>生成参数</h3><pre v-if="metadata">{{ metadata }}</pre><p v-else class="viewer-muted">此图片暂无生成参数。</p><button v-if="metadata" class="viewer-button viewer-copy" @click="copyMetadata">{{ copied ? '已复制' : '复制生成参数' }}</button>
        </aside>
      </div>
    </section>
  </Teleport>
</template>

<style scoped>
.sample-lightbox{position:fixed;inset:0;z-index:1000;background:#0b1019;color:#e0e7f2;display:grid;grid-template-rows:50px minmax(0,1fr);font-size:14px;--viewer-line:#2b374c;--viewer-panel:#141c29}.viewer-header{display:flex;gap:7px;align-items:center;padding:0 12px;background:var(--viewer-panel);border-bottom:1px solid var(--viewer-line);min-width:0}.viewer-button{display:inline-flex;justify-content:center;align-items:center;background:#1b2534;border:1px solid #354154;border-radius:5px;color:#e0e7f2;min-height:36px;min-width:36px;padding:0 10px;font:inherit;font-size:12px;white-space:nowrap;cursor:pointer}.viewer-button:hover{background:#2a3951}.viewer-button:focus-visible{outline:2px solid #86aafa;outline-offset:2px}.viewer-close{font-size:22px}.viewer-name{font-size:13px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;min-width:0}.viewer-spacer{flex:1}.viewer-counter{font-size:12px;color:#a6b4c8;white-space:nowrap}.viewer-body{display:grid;grid-template-columns:minmax(0,1fr) 300px;min-height:0}.no-info .viewer-body{grid-template-columns:minmax(0,1fr)}.viewer-stage-wrap{display:grid;grid-template-rows:minmax(0,1fr) 48px;min-width:0;min-height:0;position:relative}.viewer-stage{position:relative;min-width:0;min-height:0;overflow:hidden;touch-action:none;overscroll-behavior:contain;cursor:grab;background:radial-gradient(ellipse at center,#172132,#0b1019 80%)}.viewer-stage.dragging{cursor:grabbing}.viewer-stage img{position:absolute;left:50%;top:50%;max-width:none;max-height:none;transform-origin:0 0;user-select:none;pointer-events:none;will-change:transform}.viewer-hint{position:absolute;bottom:60px;left:12px;font-size:12px;pointer-events:none;padding:4px 8px;border:1px solid #354154;border-radius:4px;background:#0b1019d9;color:#c0cbdb}.viewer-image-message{position:absolute;left:0;right:0;top:45%;text-align:center;pointer-events:none}.viewer-zoom{display:flex;align-items:center;justify-content:center;gap:5px;background:var(--viewer-panel);border-top:1px solid var(--viewer-line)}.viewer-zoom output{min-width:50px;text-align:center;font-size:12px;font-variant-numeric:tabular-nums}.viewer-inspector{min-height:0;overflow:auto;overscroll-behavior:contain;border-left:1px solid var(--viewer-line);background:var(--viewer-panel);padding:18px;line-height:1.7}.viewer-inspector h2{font-size:16px;margin:0 0 18px}.viewer-inspector h3{font-size:12px;font-weight:500;color:#a6b4c8;margin:18px 0 5px}.viewer-inspector p{margin:0;overflow-wrap:anywhere}.viewer-inspector pre{font-family:inherit;font-size:14px;line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere;margin:0}.viewer-file{font:12px/1.7 Consolas,monospace}.viewer-muted{color:#a6b4c8}.viewer-copy{width:100%;margin-top:14px}
@media(max-width:900px){.viewer-body{grid-template-columns:minmax(0,1fr) 250px}.viewer-inspector{padding:14px}}
@media(max-width:600px) and (orientation:portrait){.sample-lightbox{grid-template-rows:48px minmax(0,1fr)}.viewer-header{padding:0 7px;gap:4px}.viewer-name{display:none}.viewer-button{min-height:36px;padding:0 8px}.viewer-body{display:flex;flex-direction:column}.viewer-stage-wrap{flex:1;min-height:0}.viewer-inspector{flex:0 0 30%;border-left:0;border-top:1px solid var(--viewer-line);padding:12px 16px}.no-info .viewer-stage-wrap{flex:1}.viewer-inspector h2{margin-bottom:10px}.viewer-hint{left:8px;bottom:56px}}
@media(orientation:landscape) and (max-height:550px){.sample-lightbox{grid-template-rows:42px minmax(0,1fr)}.viewer-body{grid-template-columns:minmax(0,1fr) 240px}.no-info .viewer-body{grid-template-columns:minmax(0,1fr)}.viewer-hint{display:none}.viewer-stage-wrap{grid-template-rows:minmax(0,1fr) 44px}.viewer-inspector{padding:10px 14px}.viewer-inspector h3{margin-top:12px}}
</style>
