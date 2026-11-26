<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { evaluateScheduler, formatLr, isScheduleFreeOptimizer, resolveWarmup, type TimelineParams } from './timeline'

const props = defineProps<{ params: TimelineParams }>()
const emit = defineEmits<{ 'focus-field': [field: string] }>()

const stageEl = ref<HTMLElement | null>(null)
const stageWidth = ref(1120)
let observer: ResizeObserver | null = null

onMounted(() => {
  const el = stageEl.value
  if (!el) return
  if (el.clientWidth > 0) stageWidth.value = el.clientWidth
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect?.width
      if (w && w > 0) stageWidth.value = w
    })
    observer.observe(el)
  }
})

onBeforeUnmount(() => { observer?.disconnect(); observer = null })

const H = 204
const padL = 58
const padR = 160
const padT = 32
const padB = 38

const geometry = computed(() => {
  const p = props.params
  const W = Math.max(520, Math.round(stageWidth.value || 1120))
  const plotW = Math.max(240, W - padL - padR)
  const plotH = H - padT - padB

  const isEp = p.durationUnit === 'epochs'
  const total = Math.max(1, Number(isEp ? p.maxEpochs : p.maxSteps) || 1)
  const saveN = Math.max(1, Number(isEp ? p.saveEveryNEpochs : p.saveEveryNSteps) || 1)
  const unitShort = isEp ? 'epoch' : 'step'
  const unitPlural = isEp ? 'epochs' : 'steps'

  const peakLR = Math.max(1e-9, Number(p.learningRate) || 0.00005)
  const teLR = p.architecture === 'anima' ? Math.max(0, Number(p.textEncoderLr) || 0) : 0
  const maxY = Math.max(peakLR, teLR)

  const warmup = resolveWarmup(p)
  const wFrac = warmup.active ? warmup.fraction : 0

  const xOf = (frac: number) => padL + frac * plotW
  const yOf = (val: number) => padT + plotH * (1 - Math.max(0, Math.min(1, val / maxY)))

  const scheduleFree = isScheduleFreeOptimizer(p.optimizerType)
  const c = Math.max(1, Math.round(Number(p.numCycles) || 1))
  const isRestarts = !scheduleFree && p.scheduler === 'cosine_with_restarts'
  const N = p.scheduler === 'cosine_with_min_lr' ? Math.max(180, c * 64) : 140
  const span = Math.max(1e-6, 1 - wFrac)

  const buildCurve = (peak: number) => {
    const pts: Array<[number, number]> = []
    if (wFrac > 0) {
      pts.push([xOf(0), yOf(0)])
      pts.push([xOf(wFrac), yOf(peak)])
    }
    const annTarget = isRestarts
      ? Math.min(0.85, wFrac + span * (0.35 / c))
      : Math.min(0.76, Math.max(wFrac + 0.24, 0.46))
    let bestDist = Infinity
    let annPt: [number, number] = [xOf(0.5), yOf(peak * 0.5)]

    if (isRestarts) {
      const stepsPerCycle = Math.max(8, Math.min(64, Math.ceil(180 / c)))
      for (let k = 0; k < c; k++) {
        for (let j = 0; j <= stepsPerCycle; j++) {
          if (k === 0 && j === 0 && wFrac > 0) continue
          const local = j / stepsPerCycle
          const u = (k + local) / c
          const f = wFrac + span * u
          const mult = 0.5 * (1 + Math.cos(Math.PI * local))
          const pt: [number, number] = [xOf(f), yOf(peak * mult)]
          pts.push(pt)
          const d = Math.abs(f - annTarget)
          if (d < bestDist) { bestDist = d; annPt = pt }
        }
      }
    } else {
      for (let i = 0; i <= N; i++) {
        const u = i / N
        const f = wFrac + span * u
        const mult = evaluateScheduler(p, u, peak)
        const pt: [number, number] = [xOf(f), yOf(peak * mult)]
        pts.push(pt)
        const d = Math.abs(f - annTarget)
        if (d < bestDist) { bestDist = d; annPt = pt }
      }
    }
    const d = pts.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt[0].toFixed(1)},${pt[1].toFixed(1)}`).join(' ')
    return { d, endY: pts[pts.length - 1]![1], annPt }
  }

  const main = buildCurve(peakLR)
  const showTe = teLR > 0 && Math.abs(teLR - peakLR) / maxY > 0.02
  const te = showTe ? buildCurve(teLR) : null

  const saveCount = Math.floor(total / saveN)
  const maxTicks = Math.max(44, Math.floor(plotW / 24))
  const stride = saveCount > maxTicks ? Math.ceil(saveCount / maxTicks) : 1
  const ticks: number[] = []
  for (let k = 1; k <= saveCount; k += stride) {
    const pos = (k * saveN) / total
    if (pos > 1.0001) break
    ticks.push(xOf(pos))
  }

  const minFloorY = !scheduleFree && p.scheduler === 'cosine_with_min_lr'
    ? yOf(peakLR * Math.max(0, Math.min(1, Number(p.minLrRatio) || 0)))
    : null

  const isMinLr = !scheduleFree && p.scheduler === 'cosine_with_min_lr'
  const isMinLrMulti = isMinLr && c > 1
  const topAnchoredAnn = isRestarts || isMinLrMulti
  const schedAnnotation = scheduleFree
    ? `${p.optimizerType}（跳过外部调度器）`
    : isRestarts
      ? `${p.scheduler} · ${c} 周期（${c - 1} 次重启）`
      : topAnchoredAnn
        ? `${p.scheduler} · ${c} cycles`
        : p.scheduler

  const baseName = (p.outputName || 'output').trim()
  const nameLine = baseName.length > 18 ? `${baseName.slice(0, 17)}…` : baseName
  const extLine = p.saveModelAs ? `.${p.saveModelAs} · ${p.savePrecision}` : p.savePrecision

  const recipeSched = scheduleFree
    ? 'ScheduleFree'
    : p.scheduler === 'cosine_with_restarts'
      ? `cosine×${c}（重启${c - 1}次）`
      : p.scheduler === 'cosine_with_min_lr'
        ? c > 1 ? `cosine×${c} (min ${p.minLrRatio})` : `cosine (min ${p.minLrRatio})`
        : p.scheduler

  return {
    W, plotW, plotH, isEp, total, saveN, unitShort, unitPlural,
    peakLR, peakY: yOf(peakLR), teLR, showTe,
    warmup, wX: xOf(wFrac), wWidth: Math.max(0, xOf(wFrac) - padL),
    main, te, ticks, saveCount,
    saveField: isEp ? 'save_every_n_epochs' : 'save_every_n_steps',
    durationField: isEp ? 'max_train_epochs' : 'max_train_steps',
    saveSummary: `每 ${saveN} ${unitShort} 保存 · 共 ${saveCount} 次`,
    minFloorY, minFloorRatio: Math.max(0, Math.min(1, Number(p.minLrRatio) || 0)),
    isRestarts, topAnchoredAnn, schedAnnotation,
    annX: topAnchoredAnn
      ? xOf(Math.min(0.82, Math.max(wFrac + 0.18, wFrac + span * 0.5)))
      : main.annPt[0] + 10,
    annY: topAnchoredAnn ? padT - 10 : Math.max(padT + 14, main.annPt[1] - 10),
    endX: xOf(1), nameLine, extLine,
    q1X: padL + plotW * 0.25, q3X: padL + plotW * 0.75,
    q1Val: Math.round(total * 0.25), q3Val: Math.round(total * 0.75),
    recipeSched,
  }
})

function jump(field: string) {
  emit('focus-field', field)
}
</script>

<template>
  <div class="tt-timeline-block">
    <div class="tt-recipe-bar" aria-label="当前训练配方摘要">
      <button type="button" class="tt-recipe-item mono" @click="jump('optimizer_type')">{{ params.optimizerType }}</button>
      <span class="tt-recipe-sep" aria-hidden="true">·</span>
      <button type="button" class="tt-recipe-item mono" @click="jump('learning_rate')">LR {{ formatLr(geometry.peakLR) }}</button>
      <span class="tt-recipe-sep" aria-hidden="true">·</span>
      <button type="button" class="tt-recipe-item mono" @click="jump('lr_scheduler')">{{ geometry.recipeSched }}</button>
      <template v-if="geometry.warmup.active">
        <span class="tt-recipe-sep" aria-hidden="true">·</span>
        <button type="button" class="tt-recipe-item" @click="jump(geometry.warmup.field)">{{ geometry.warmup.label }}</button>
      </template>
      <span class="tt-recipe-sep" aria-hidden="true">·</span>
      <button type="button" class="tt-recipe-item mono" @click="jump(geometry.durationField)">{{ geometry.total }} {{ geometry.unitPlural }}</button>
      <span class="tt-recipe-sep" aria-hidden="true">·</span>
      <button type="button" class="tt-recipe-item" @click="jump(geometry.saveField)">每 {{ geometry.saveN }} {{ geometry.isEp ? '轮' : '步' }}保存</button>
      <span class="tt-recipe-sep" aria-hidden="true">·</span>
      <button type="button" class="tt-recipe-item mono" @click="jump('mixed_precision')">{{ params.mixedPrecision }}</button>
    </div>

    <section class="tt-hero" aria-label="学习率与保存时间线">
      <div class="tt-hero-head">
        <h2 class="tt-hero-title">训练时间线 · 学习率曲线与检查点节奏</h2>
        <span class="tt-hero-caption">点击曲线、预热区间、保存刻度或终点名称可定位对应参数</span>
      </div>
      <div ref="stageEl" class="tt-chart-stage">
        <svg
          class="tt-chart-svg"
          :viewBox="`0 0 ${geometry.W} ${H}`"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="学习率随训练进度的变化曲线"
        >
          <!-- Tufte range-frame axes -->
          <line :x1="padL" :y1="padT" :x2="padL" :y2="padT + geometry.plotH" stroke="var(--border)" stroke-width="1" />
          <line :x1="padL" :y1="padT + geometry.plotH" :x2="padL + geometry.plotW" :y2="padT + geometry.plotH" stroke="var(--border)" stroke-width="1" />
          <line :x1="padL" :y1="geometry.peakY" :x2="padL + geometry.plotW" :y2="geometry.peakY" stroke="var(--border)" stroke-opacity=".42" stroke-dasharray="2 5" />

          <!-- Y-axis direct labels -->
          <g class="tt-chart-hit" @click="jump('learning_rate')">
            <text :x="padL - 10" :y="geometry.peakY + 4" text-anchor="end" class="mono ink tt-hit-label">{{ formatLr(geometry.peakLR) }}</text>
          </g>
          <text :x="padL - 10" :y="padT + geometry.plotH + 4" text-anchor="end" class="mono">0</text>

          <!-- Single initial warmup zone -->
          <g v-if="geometry.warmup.active" class="tt-chart-hit" @click="jump(geometry.warmup.field)">
            <rect :x="padL" :y="padT" :width="geometry.wWidth" :height="geometry.plotH" fill="var(--primary)" opacity=".08" class="tt-hit-fill" />
            <line :x1="geometry.wX" :y1="padT - 5" :x2="geometry.wX" :y2="padT + geometry.plotH" stroke="var(--primary)" stroke-opacity=".42" stroke-dasharray="2 3" />
            <text :x="geometry.wX + 4" :y="padT - 10" class="tt-hit-label">{{ geometry.warmup.label }}</text>
          </g>

          <!-- Min LR floor reference -->
          <g v-if="geometry.minFloorY !== null" class="tt-chart-hit" @click="jump('lr_scheduler_min_lr_ratio')">
            <line :x1="padL" :y1="geometry.minFloorY" :x2="padL + geometry.plotW" :y2="geometry.minFloorY" stroke="var(--muted-foreground)" stroke-opacity=".45" stroke-dasharray="3 4" />
            <text :x="padL + geometry.plotW - 4" :y="geometry.minFloorY - 5" text-anchor="end" class="mono tt-hit-label">
              下限 {{ geometry.minFloorRatio }}× ({{ formatLr(geometry.peakLR * geometry.minFloorRatio) }})
            </text>
          </g>

          <!-- Optional Text Encoder LR curve (Anima) -->
          <g v-if="geometry.te" class="tt-chart-hit" @click="jump('text_encoder_lr')">
            <path :d="geometry.te.d" fill="none" stroke="var(--muted-foreground)" stroke-width="1.3" stroke-dasharray="4 3" class="tt-hit-stroke" />
            <text :x="geometry.te.annPt[0] + 6" :y="geometry.te.annPt[1] - 6" class="mono tt-hit-label">TE {{ formatLr(geometry.teLR) }}</text>
          </g>

          <!-- Main LR curve -->
          <g class="tt-chart-hit" @click="jump('lr_scheduler')">
            <path :d="geometry.main.d" fill="none" stroke="transparent" stroke-width="14" />
            <path :d="geometry.main.d" fill="none" stroke="var(--primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tt-hit-stroke" />
            <text
              :x="geometry.annX"
              :y="geometry.annY"
              :text-anchor="geometry.topAnchoredAnn ? 'middle' : 'start'"
              class="mono primary-ink tt-hit-label"
            >{{ geometry.schedAnnotation }}</text>
          </g>

          <!-- Checkpoint save ticks -->
          <g class="tt-chart-hit" @click="jump(geometry.saveField)">
            <rect :x="padL" :y="padT + geometry.plotH - 2" :width="geometry.plotW" height="24" fill="transparent" />
            <line
              v-for="(tx, idx) in geometry.ticks"
              :key="idx"
              :x1="tx"
              :y1="padT + geometry.plotH"
              :x2="tx"
              :y2="padT + geometry.plotH + 6"
              stroke="var(--foreground)"
              stroke-opacity=".55"
              stroke-width="1.2"
            />
            <text :x="padL + geometry.plotW / 2" :y="padT + geometry.plotH + 26" text-anchor="middle" class="tt-hit-label">{{ geometry.saveSummary }}</text>
          </g>

          <!-- X-axis endpoints -->
          <text :x="padL" :y="padT + geometry.plotH + 26" class="mono">0</text>
          <text :x="geometry.q1X" :y="padT + geometry.plotH + 26" text-anchor="middle" class="mono" opacity=".6">{{ geometry.q1Val }}</text>
          <text :x="geometry.q3X" :y="padT + geometry.plotH + 26" text-anchor="middle" class="mono" opacity=".6">{{ geometry.q3Val }}</text>
          <g class="tt-chart-hit" @click="jump(geometry.durationField)">
            <text :x="padL + geometry.plotW" :y="padT + geometry.plotH + 26" text-anchor="end" class="mono ink tt-hit-label">{{ geometry.total }} {{ geometry.unitPlural }}</text>
          </g>

          <!-- End marker & output filename -->
          <g class="tt-chart-hit" @click="jump('output_name')">
            <line :x1="geometry.endX" :y1="padT" :x2="geometry.endX" :y2="padT + geometry.plotH" stroke="var(--border)" stroke-width="1" />
            <circle :cx="geometry.endX" :cy="geometry.main.endY" r="3.5" fill="var(--primary)" />
            <text :x="geometry.endX + 12" :y="padT + geometry.plotH / 2 - 4" class="mono ink tt-hit-label">{{ geometry.nameLine }}</text>
            <text :x="geometry.endX + 12" :y="padT + geometry.plotH / 2 + 13" class="mono">{{ geometry.extLine }}</text>
          </g>
        </svg>
      </div>
    </section>
  </div>
</template>
