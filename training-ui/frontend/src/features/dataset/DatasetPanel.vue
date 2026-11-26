<script setup lang="ts">
import { computed, nextTick, onUnmounted, reactive, ref, watch } from 'vue'
import { useEditorStore } from '@/stores/editor'
import { api } from '@/services/api'
import ConfigField from '@/components/forms/ConfigField.vue'
import FieldHelp from '@/components/forms/FieldHelp.vue'
import { provideFieldHelp } from '@/components/forms/help-context'
import { LBAI } from '@/domain/training'
import DatasetAssetManager from './DatasetAssetManager.vue'

const store = useEditorStore()
provideFieldHelp('dataset')
const moss = computed(() => store.architecture === 'moss_image')
const isAnima = computed(() => !['krea2', 'moss_image'].includes(store.architecture))

type RecordValue = Record<string, any>
const collapsed = reactive(new WeakSet<object>())
const counts = reactive(new Map<string, { count?: number; error?: string }>())
const highlightedKey = ref<string | null>(null)
let highlightTimer: ReturnType<typeof setTimeout> | undefined
let countTimer: ReturnType<typeof setTimeout> | undefined
let countRequest: AbortController | undefined
let generation = 0
const targetIndex = ref(0)

const datasets = computed<RecordValue[]>(() => {
  const value = store.dataset?.datasets
  return Array.isArray(value) ? value : value ? [value] : []
})
const general = computed(() => store.dataset?.general || {})
const training = computed(() => store.config.training_arguments || {})
const network = computed(() => store.config.network_arguments || {})
const totalSubsetsCount = computed(() => datasets.value.reduce((sum, d) => sum + subsets(d).length, 0))

const assetTarget = ref<{ dataset: RecordValue; subset: RecordValue; mode: 'import' | 'browse'; job: string | null } | null>(null)
function manageAssets(dataset: RecordValue, subset: RecordValue, mode: 'import' | 'browse') {
  assetTarget.value = { dataset, subset, mode, job: store.name }
}
function applyImported(directories: string[]) {
  const target = assetTarget.value
  if (!target || target.job !== store.name || store.locked || store.running || !directories.length ||
    !datasets.value.includes(target.dataset) || !subsets(target.dataset).includes(target.subset)) return
  const existing = new Set(subsets(target.dataset).filter(s => s !== target.subset).map(s => String(s.image_dir || '').trim().toLowerCase()))
  const paths = directories.filter(p => !existing.has(p.toLowerCase()))
  if (!paths.length) { store.error = '这些目录已绑定到当前 Dataset 的其他子集'; return }
  target.subset.image_dir = paths[0]
  target.dataset.subsets = [...subsets(target.dataset), ...paths.slice(1).map(image_dir => ({ ...target.subset, image_dir }))]
  paths.forEach(p => counts.delete(p))
  store.touch(); assetTarget.value = null; void refreshCounts()
  store.notice = '数据集目录已绑定，请保存任务配置后再训练。'
}
function setTraining(field: string, value: any) {
  if (!store.config.training_arguments) store.config.training_arguments = {}
  if (value === undefined) delete store.config.training_arguments[field]
  else store.config.training_arguments[field] = value
}
function setGeneral(field: string, value: any) {
  if (!store.dataset.general) store.dataset.general = {}
  if (value === undefined) delete store.dataset.general[field]
  else store.dataset.general[field] = value
}
function subsets(dataset: RecordValue): RecordValue[] {
  return Array.isArray(dataset.subsets) ? dataset.subsets : dataset.subsets ? [dataset.subsets] : []
}
function addDataset() {
  store.dataset.datasets = [...datasets.value, { resolution: moss.value ? [512, 512] : [1024, 1024], batch_size: 1, caption_extension: '.txt', subsets: [{ image_dir: '', num_repeats: 1 }] }]
  store.touch()
}
function deleteDataset(index: number) {
  store.dataset.datasets = datasets.value.filter((_, i) => i !== index)
  store.touch()
}
function addSubset(dataset: RecordValue) {
  dataset.subsets = [...subsets(dataset), ['krea2', 'moss_image'].includes(store.architecture) ? { image_dir: '', num_repeats: 1 } : { image_dir: '', num_repeats: 1, epoch_sample_rate: 1, keep_tokens: 1, caption_dropout_rate: 0.05 }]
  store.touch()
}
function deleteSubset(dataset: RecordValue, index: number) {
  dataset.subsets = subsets(dataset).filter((_, i) => i !== index)
  store.touch()
}
function onGeneralClassTokensChange(value: any) {
  const cleaned = typeof value === 'string' && value.trim() === '' ? undefined : value
  setGeneral('class_tokens', cleaned)
  store.touch()
}
function toggle(subset: object) {
  if (collapsed.has(subset)) collapsed.delete(subset)
  else collapsed.add(subset)
}
async function openFolder(path: string) {
  try { await api('/api/system/open-folder', { method: 'POST', body: { path } }) }
  catch (error) { store.error = String(error) }
}
async function refreshCounts() {
  countRequest?.abort()
  const controller = new AbortController()
  countRequest = controller
  const version = generation
  const paths = [...new Set(datasets.value.flatMap(d => subsets(d).map(s => String(s.image_dir || '').trim())).filter(Boolean))]
  await Promise.all(paths.filter(path => !counts.has(path)).map(async path => {
    try {
      const result = await api('/api/system/dataset-image-count', { method: 'POST', body: { path }, signal: controller.signal })
      if (controller.signal.aborted || version !== generation) return
      counts.set(path, !result.exists ? { error: '路径不存在' } : !result.readable ? { error: result.error || '无法读取' } : { count: result.count })
    } catch (error) {
      if (!controller.signal.aborted && version === generation) counts.set(path, { error: String(error) })
    }
  }))
}
watch(() => store.name, () => { generation++; countRequest?.abort(); counts.clear(); assetTarget.value = null })
watch(() => datasets.value.flatMap(d => subsets(d).map(s => s.image_dir)), () => {
  clearTimeout(countTimer)
  countTimer = setTimeout(refreshCounts, 400)
}, { immediate: true })
onUnmounted(() => { generation++; clearTimeout(countTimer); clearTimeout(highlightTimer); countRequest?.abort() })

const targets = computed(() => LBAI.normalizeTargets(store.globalConfig?.ui?.lbai_targets))
const estimates = computed(() => datasets.value.map(dataset => {
  const nonReg = subsets(dataset).filter(s => !s.is_reg)
  if (!nonReg.length || nonReg.some(s => counts.get(String(s.image_dir || '').trim())?.count === undefined)) return null
  const t = store.config.training_arguments || {}, n = store.config.network_arguments || {}
  if (!t.max_train_epochs) return null
  return LBAI.calculate({
    samplesPerEpoch: nonReg.reduce((sum, s) => sum + counts.get(String(s.image_dir || '').trim())!.count! * Number(s.num_repeats ?? 1) * Math.max(0, Math.min(1, Number(s.epoch_sample_rate ?? 1))), 0),
    epochs: t.max_train_epochs,
    learningRate: t.learning_rate,
    rank: n.network_dim,
    batchSize: dataset.batch_size ?? 1,
    gradientAccumulationSteps: t.gradient_accumulation_steps ?? 1,
    scheduler: t.lr_scheduler,
    minLrRatio: t.lr_scheduler_min_lr_ratio ?? 0,
  })
}))
const totalEstimate = computed(() => {
  if (!estimates.value.length || estimates.value.some(value => !value)) return null
  return estimates.value.reduce((sum, value) => ({ value: sum.value + value.value, samplesPerEpoch: sum.samplesPerEpoch + value.samplesPerEpoch, exposure: sum.exposure + value.exposure }), { value: 0, samplesPerEpoch: 0, exposure: 0 })
})

function comparison(result: any) {
  const target = targets.value[targetIndex.value]
  if (!result || !target) return ''
  const bounds = LBAI.targetBounds(target), midpoint = (bounds.min + bounds.max) / 2
  return `${target.name} · ${midpoint > 0 ? Math.round(result.value / midpoint * 100) + '%' : '—'} · ${result.value < bounds.min ? '低于目标' : result.value > bounds.max ? '高于目标' : '目标范围内'}`
}
function comparisonState(result: any): 'in-range' | 'low' | 'high' | 'na' {
  const target = targets.value[targetIndex.value]
  if (!result || !target) return 'na'
  const bounds = LBAI.targetBounds(target)
  if (result.value < bounds.min) return 'low'
  if (result.value > bounds.max) return 'high'
  return 'in-range'
}

const scaleMax = computed(() => Math.max(LBAI.scaleMaximum(targets.value), totalEstimate.value?.value ?? 0, 0.001))
const zoneBands = computed(() => targets.value.map((target: any, idx: number) => {
  const bounds = LBAI.targetBounds(target)
  const left = Math.max(0, Math.min(98, (bounds.min / scaleMax.value) * 100))
  const width = Math.max(2, Math.min(100 - left, ((bounds.max - bounds.min) / scaleMax.value) * 100))
  return {
    idx,
    name: target.name,
    range: target.type === 'point' ? String(target.value) : `${target.min}–${target.max}`,
    left,
    width,
  }
}))
const rulerTicks = computed(() => {
  const max = scaleMax.value
  return [0, 0.2, 0.4, 0.6, 0.8, 1].map(frac => ({
    pct: frac * 100,
    label: frac === 0 ? '0' : Number((max * frac).toPrecision(2)).toString(),
  }))
})
const needlePct = computed(() => {
  if (!totalEstimate.value) return 0
  return Math.max(0, Math.min(100, (totalEstimate.value.value / scaleMax.value) * 100))
})

const subsetSegments = computed(() => {
  const list: Array<{ di: number; si: number; isReg: boolean; label: string; samples: number | null; lbai: number; widthPct: number; sharePct: number; colorIdx: number }> = []
  let colorIdx = 0
  datasets.value.forEach((ds, di) => {
    const est = estimates.value[di]
    subsets(ds).forEach((sub, si) => {
      const dirInfo = counts.get(String(sub.image_dir || '').trim())
      const repeats = Math.max(1, Number(sub.num_repeats ?? 1))
      const rate = Math.max(0, Math.min(1, Number(sub.epoch_sample_rate ?? 1)))
      const isReg = Boolean(sub.is_reg)
      const samples = dirInfo?.count !== undefined ? dirInfo.count * repeats * (isReg ? 1 : rate) : null
      let lbai = 0
      if (!isReg && est && samples !== null && est.samplesPerEpoch > 0) {
        lbai = est.value * (samples / est.samplesPerEpoch)
      }
      const widthPct = lbai > 0 ? Math.max(0, Math.min(100, (lbai / scaleMax.value) * 100)) : 0
      const sharePct = totalEstimate.value && totalEstimate.value.value > 0 ? Math.round((lbai / totalEstimate.value.value) * 100) : 0
      list.push({
        di, si, isReg,
        label: `D${di + 1}/子集${si + 1}${isReg ? ' (REG)' : ''}`,
        samples, lbai, widthPct, sharePct,
        colorIdx: isReg ? -1 : colorIdx++,
      })
    })
  })
  return list
})
const nonRegSegments = computed(() => subsetSegments.value.filter(s => !s.isReg && s.lbai > 0))

const formulaSummary = computed(() => {
  const gradAccum = Number(training.value.gradient_accumulation_steps ?? 1)
  const parts = datasets.value.map((ds, di) => {
    const est = estimates.value[di]
    const sCount = est ? Math.round(est.samplesPerEpoch) : '?'
    return `D${di + 1}(${sCount}/轮 ÷ [Batch ${ds.batch_size ?? 1}×累积 ${gradAccum}])`
  })
  const epochs = training.value.max_train_epochs ?? '—'
  const lr = training.value.learning_rate ?? '—'
  const rank = network.value.network_dim ?? '—'
  const rankFactor = typeof network.value.network_dim === 'number' ? Number((network.value.network_dim / 32).toPrecision(3)) : '—'
  return { breakdown: parts.join(' + ') || '—', epochs, lr, rank, rankFactor, gradAccum, scheduler: training.value.lr_scheduler || 'constant' }
})

function scrollToSubset(di: number, si: number) {
  const ds = datasets.value[di]
  const sub = ds ? subsets(ds)[si] : undefined
  if (!sub) return
  collapsed.delete(sub)
  highlightedKey.value = `${di}-${si}`
  clearTimeout(highlightTimer)
  highlightTimer = setTimeout(() => { highlightedKey.value = null }, 1400)
  void nextTick(() => {
    document.getElementById(`subset-block-${di}-${si}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
  })
}

const bucketSummary = computed(() => {
  const enabled = Boolean(general.value.enable_bucket ?? true)
  const noUpscale = Boolean(general.value.bucket_no_upscale ?? true)
  const minR = Math.max(64, Number(general.value.min_bucket_reso ?? 512) || 512)
  const maxR = Math.max(minR, Number(general.value.max_bucket_reso ?? 1536) || 1536)
  const step = Math.max(16, Number(general.value.bucket_reso_steps ?? 64) || 64)
  const count = Math.floor((maxR - minR) / step) + 1
  return { enabled, noUpscale, minR, maxR, step, count }
})

const schedulePresets = [
  { label: '关闭 (留空)', value: '' },
  { label: '512:0.3,1024:0.7', value: '512:0.3,1024:0.7' },
  { label: '512:0.4,1024:0.3,1536:0.3', value: '512:0.4,1024:0.3,1536:0.3' },
]
const scheduleSummary = computed(() => {
  const raw = String(training.value.resolution_schedule || '').trim()
  if (!raw) return { raw, status: 'off' as const, badge: '已关闭 (全程使用各 Dataset 设定分辨率)', stages: [] as Array<{ res: number; ratio: number; widthPct: number; label: string }> }
  const parts = raw.split(',').map(s => s.trim()).filter(Boolean)
  const parsed: Array<{ res: number; ratio: number }> = []
  let sum = 0
  let syntaxErr = false
  for (const p of parts) {
    const [rStr, pStr] = p.split(':')
    const res = Number(rStr), ratio = Number(pStr)
    if (!Number.isFinite(res) || res <= 0 || !Number.isFinite(ratio) || ratio <= 0) syntaxErr = true
    else { parsed.push({ res, ratio }); sum += ratio }
  }
  if (syntaxErr || !parsed.length) return { raw, status: 'warn' as const, badge: '格式错误：请使用 分辨率:比例 (如 512:0.3,1024:0.7)', stages: [] }
  const isOne = Math.abs(sum - 1) < 0.001
  const totalEpochs = Number(training.value.max_train_epochs || 0)
  let accEpoch = 1
  const stages = parsed.map(st => {
    const widthPct = (st.ratio / Math.max(sum, 1)) * 100
    let epochPart = ''
    if (totalEpochs > 0) {
      const span = Math.max(1, Math.round(st.ratio * totalEpochs))
      const end = Math.min(totalEpochs, accEpoch + span - 1)
      epochPart = ` (轮 ${accEpoch}–${end})`
      accEpoch = end + 1
    }
    return { res: st.res, ratio: st.ratio, widthPct, label: `${st.res}px · ${Math.round(st.ratio * 100)}%${epochPart}` }
  })
  return {
    raw,
    status: isOne ? ('ok' as const) : ('warn' as const),
    badge: isOne ? `比例合计 ${sum.toFixed(2)} ✓` : `当前合计 ${sum.toFixed(2)} ≠ 1.0 (比例之和应为 1)`,
    stages,
  }
})
function applySchedulePreset(val: string) {
  setTraining('resolution_schedule', val || undefined)
  store.touch()
}

function dirStatus(subset: RecordValue) {
  const path = String(subset.image_dir || '').trim()
  if (!path) return { kind: 'empty', text: '—', error: undefined as string | undefined, count: undefined as number | undefined }
  const entry = counts.get(path)
  if (!entry) return { kind: 'empty', text: '…', error: undefined, count: undefined }
  if (entry.error) return { kind: 'err', text: entry.error, error: entry.error, count: undefined }
  return { kind: 'ok', text: String(entry.count), error: undefined, count: entry.count }
}

function subsetMathSummary(subset: RecordValue) {
  const info = dirStatus(subset)
  if (info.count === undefined) return '需有效图片目录以计算单轮样本量'
  const repeats = Math.max(1, Number(subset.num_repeats ?? 1))
  if (subset.is_reg) return `${info.count} 张 × ${repeats} 重复 · 正则化子集 (不计入 LBAI)`
  const rate = Math.max(0, Math.min(1, Number(subset.epoch_sample_rate ?? 1)))
  const eff = Math.round(info.count * repeats * rate)
  return `${info.count} 张 × ${repeats} 重复 × ${rate.toFixed(2)} 采样 = ${eff} 样本/轮`
}

const SAMPLE_FILE_TAGS = ['1girl', 'silver_hair', 'blue_eyes', 'pleated_skirt']
const SAMPLE_NL = 'She stands under a neon-lit overpass at dusk.'
function captionPreview(sub: RecordValue) {
  const prefix = String(sub.caption_prefix || '')
  const tagsSuffix = String(sub.tags_suffix || '')
  const nlPrefix = String(sub.natural_language_prefix || '')
  const suffix = String(sub.caption_suffix || '')
  const keep = Math.max(0, Number(sub.keep_tokens ?? 1) || 0)
  const shuffle = Boolean(sub.shuffle_caption)
  let items: string[] = []
  let mergedFirstTag = false
  if (prefix) {
    if (prefix.trimEnd().endsWith(',')) {
      items = [...prefix.split(',').map(t => t.trim()).filter(Boolean), ...SAMPLE_FILE_TAGS]
    } else {
      mergedFirstTag = true
      const pParts = prefix.split(',').map(t => t.trim()).filter(Boolean)
      if (pParts.length > 1) {
        const lastP = pParts.pop()!
        items = [...pParts, `${lastP} ${SAMPLE_FILE_TAGS[0]}`, ...SAMPLE_FILE_TAGS.slice(1)]
      } else {
        items = [`${prefix.trim()} ${SAMPLE_FILE_TAGS[0]}`, ...SAMPLE_FILE_TAGS.slice(1)]
      }
    }
  } else {
    items = [...SAMPLE_FILE_TAGS]
  }
  const tokens = items.map((text, idx) => ({
    text,
    idx,
    kind: idx < keep ? 'fixed' : shuffle ? 'shuffle' : 'plain',
  }))
  return {
    tokens,
    tagsSuffix,
    nlPrefix,
    suffix,
    keep,
    shuffle,
    showNoCommaTip: Boolean(prefix && !prefix.trimEnd().endsWith(',') && keep >= 1 && mergedFirstTag),
  }
}

const generalBoolFields = [
  ['enable_bucket', '启用 Bucket', true],
  ['bucket_no_upscale', '不放大小图', true],
  ['balance_regularization_images', '平衡正则化图片', false],
] as const
const generalNumFields = [
  ['min_bucket_reso', '最小 Bucket 分辨率', 512],
  ['max_bucket_reso', '最大 Bucket 分辨率', 1536],
  ['bucket_reso_steps', 'Bucket 步长', 64],
] as const
const subsetDropoutFields = [
  ['keep_tokens', '保留 Token', 1],
  ['caption_dropout_rate', 'Caption Dropout', 0.05],
  ['caption_tag_dropout_rate', 'Tag Dropout', 0],
  ['caption_dropout_every_n_epochs', '每 N 轮 Caption Dropout', 0],
] as const
const subsetBoolFields = [
  ['shuffle_caption', '打乱 Caption'],
  ['flip_aug', '水平翻转'],
  ['is_reg', '正则化数据集'],
  ['alpha_mask', 'Alpha Mask'],
] as const
const segColors = ['#3b82f6', '#8b5cf6', '#0d9488']
</script>

<template>
  <section class="dataset-panel dt-wrap" v-if="store.name">
    <!-- Top Header -->
    <div class="dt-top-bar">
      <div class="dt-title-block">
        <h2>数据集</h2>
        <p class="muted">每个 Dataset 保留独立分辨率、批量和全部子集。未编辑的扩展字段保持原值。</p>
      </div>
    </div>

    <!-- 1. HERO: Live Multi-Zone LBAI Ruler & Stacked Contribution Bar + Plugged-in Formula (Outside Fieldset) -->
    <section v-if="isAnima" class="lbai total-lbai dt-lbai-hero" aria-label="LBAI 训练强度估算">
      <div class="dt-lbai-top">
        <div class="dt-lbai-main">
          <strong class="dt-lbai-val">总 LBAI {{ totalEstimate ? Number(totalEstimate.value.toPrecision(4)) : '—' }}</strong>
          <span class="dt-status-badge" :class="comparisonState(totalEstimate)">
            {{ totalEstimate ? comparison(totalEstimate) : '需有效目录图片计数及 Epoch 设置以计算 LBAI' }}
          </span>
        </div>
        <div class="dt-lbai-target-ctl">
          <label for="lbai-target-select">LBAI 比较目标</label>
          <select id="lbai-target-select" v-model="targetIndex" class="dt-target-select" aria-label="LBAI 比较目标">
            <option v-for="(target, ti) in targets" :key="ti" :value="ti">{{ target.name }}：{{ target.type === 'point' ? target.value : `${target.min}–${target.max}` }}</option>
          </select>
          <FieldHelp field="lbai_target" label="LBAI 比较目标" />
        </div>
      </div>

      <!-- Calibrated Multi-Zone Horizontal Ruler -->
      <div class="dt-ruler-stage">
        <div class="dt-ruler-zones">
          <button
            v-for="band in zoneBands"
            :key="band.idx"
            type="button"
            class="dt-zone-band"
            :class="[`z${band.idx % 3}`, { 'is-active': band.idx === targetIndex }]"
            :style="{ left: `${band.left}%`, width: `${band.width}%` }"
            :title="`点击切换比较目标：${band.name} (${band.range})`"
            @click="targetIndex = band.idx"
          >
            <span class="dt-zone-name">{{ band.name }}</span>
            <span class="dt-zone-range">{{ band.range }}</span>
          </button>
        </div>

        <div class="dt-ruler-track">
          <div class="dt-ruler-stack">
            <button
              v-for="(seg, idx) in nonRegSegments"
              :key="`${seg.di}-${seg.si}`"
              type="button"
              class="dt-stack-seg"
              :class="`seg-${idx % 3}`"
              :style="{ width: `${seg.widthPct}%` }"
              :title="`点击定位：${seg.label} · LBAI 贡献 ${Number(seg.lbai.toPrecision(4))}`"
              @click="scrollToSubset(seg.di, seg.si)"
            >
              {{ seg.widthPct >= 9 ? `${seg.label}: ${Number(seg.lbai.toPrecision(3))}` : `D${seg.di + 1}` }}
            </button>
          </div>
          <div v-if="totalEstimate" class="dt-ruler-needle" :style="{ left: `${needlePct}%` }">
            <span class="dt-needle-flag">{{ Number(totalEstimate.value.toPrecision(4)) }}</span>
          </div>
        </div>

        <div class="dt-ruler-ticks">
          <span v-for="tick in rulerTicks" :key="tick.pct" class="dt-tick" :style="{ left: `${tick.pct}%` }">{{ tick.label }}</span>
        </div>
      </div>

      <!-- Subset Contributions Legend -->
      <div v-if="subsetSegments.length" class="dt-lbai-legend-row">
        <div class="dt-seg-chips">
          <button
            v-for="seg in subsetSegments"
            :key="`${seg.di}-${seg.si}`"
            type="button"
            class="dt-seg-chip"
            :class="{ 'is-reg': seg.isReg }"
            @click="scrollToSubset(seg.di, seg.si)"
          >
            <span class="dt-seg-swatch" :style="{ background: seg.isReg ? 'var(--dt-warn)' : segColors[seg.colorIdx % segColors.length] }" />
            <span class="mono">
              <template v-if="seg.isReg">{{ seg.label }} · {{ seg.samples !== null ? Math.round(seg.samples) : '—' }} 样本/轮 (不计入 LBAI)</template>
              <template v-else>{{ seg.label }}: {{ seg.lbai > 0 ? Number(seg.lbai.toPrecision(4)) : '—' }}<template v-if="seg.lbai > 0"> ({{ seg.sharePct }}%)</template></template>
            </span>
          </button>
        </div>
        <span class="muted dt-legend-hint">点击上方色块或子集标签可定位至对应子集 · 正则化子集 (REG) 不计入 LBAI</span>
      </div>

      <!-- Live Plugged-in Formula Strip -->
      <div class="dt-formula-strip">
        <div class="dt-formula-eq">
          <span class="dt-f-op">∑</span>
          <span class="dt-f-term"><span class="k">非REG图片×重复×采样率÷(Batch×累积)</span><span class="v">{{ formulaSummary.breakdown }}</span></span>
          <span class="dt-f-op">×</span>
          <span class="dt-f-term"><span class="k">轮数</span><span class="v">{{ formulaSummary.epochs }}</span></span>
          <span class="dt-f-op">×</span>
          <span class="dt-f-term"><span class="k">LR</span><span class="v">{{ formulaSummary.lr }}</span></span>
          <span class="dt-f-op">×</span>
          <span class="dt-f-term"><span class="k">Rank/32</span><span class="v">{{ formulaSummary.rankFactor }}</span></span>
          <span class="dt-f-op">=</span>
          <span class="dt-f-term"><span class="k">总 LBAI</span><span class="v">{{ totalEstimate ? Number(totalEstimate.value.toPrecision(4)) : '—' }}</span></span>
        </div>
        <small class="dt-formula-note">合计所有 Dataset 的训练程度；多分辨率训练中同一路径在不同 Dataset 会分别贡献训练量。</small>
      </div>
    </section>

    <fieldset :disabled="store.locked" class="dataset-edit-fields dt-fieldset">
      <!-- 2. GLOBAL BUCKETING & PROGRESSIVE RESOLUTION STRIP -->
      <section class="dt-global-grid" :class="{ 'single-col': !isAnima }" aria-label="全局分桶与渐进分辨率计划">
        <!-- Left Column: Aspect Ratio Bucketing -->
        <div class="dt-g-col">
          <div class="dt-sec-head">
            <h3>宽高比分桶 · Bucketing</h3>
            <span class="dt-sec-meta">dataset.general</span>
          </div>

          <div class="dt-check-strip">
            <template v-for="[field, label, fallback] in generalBoolFields" :key="field">
              <ConfigField
                v-if="isAnima || ['enable_bucket', 'bucket_no_upscale'].includes(field)"
                :object="general"
                :field="field"
                :label="label"
                type="boolean"
                :fallback="fallback"
                @change="setGeneral(field, $event)"
              />
            </template>
            <ConfigField
              v-if="isAnima"
              :object="training"
              field="disable_bucket_shuffle"
              label="Disable Bucket Shuffle"
              type="boolean"
              :fallback="false"
              help="保持 resolution bucket 内的 DataLoader 顺序。"
              @change="setTraining('disable_bucket_shuffle', $event)"
            />
            <ConfigField
              v-if="moss"
              :object="general"
              field="enable_multiline_caption"
              label="保留多行 Caption"
              type="boolean"
              :fallback="true"
              @change="setGeneral('enable_multiline_caption', $event)"
            />
          </div>

          <div v-if="isAnima || moss" class="dt-num-triad">
            <ConfigField
              v-for="[field, label, fallback] in generalNumFields"
              :key="field"
              :object="general"
              :field="field"
              :label="label"
              type="number"
              :fallback="fallback"
              @change="setGeneral(field, $event)"
            />
          </div>

          <div v-if="isAnima || moss" class="dt-bucket-ruler">
            <span>{{ bucketSummary.enabled ? `${bucketSummary.minR}px` : 'Bucket 已关闭' }}</span>
            <div class="dt-bucket-ticks" aria-hidden="true" />
            <span>{{ bucketSummary.enabled ? `步长 ${bucketSummary.step}px (共 ${bucketSummary.count} 档候选边界)` : '按各 Dataset 固定目标分辨率裁剪' }}</span>
            <div class="dt-bucket-ticks" aria-hidden="true" />
            <span>{{ bucketSummary.enabled ? `${bucketSummary.maxR}px · ${bucketSummary.noUpscale ? '禁放大小图' : '允许放大小图'}` : '—' }}</span>
          </div>
        </div>

        <!-- Right Column: Progressive Resolution Schedule (Anima only) -->
        <div v-if="isAnima" class="dt-g-col">
          <div class="dt-sec-head">
            <h3>渐进式分辨率计划 · Progressive Resolution</h3>
            <span class="dt-sec-meta">training_arguments</span>
          </div>

          <ConfigField
            :object="training"
            field="resolution_schedule"
            label="Progressive Resolution Schedule"
            help="留空关闭。格式：512:0.4,1024:0.3,1536:0.3；按顺序切换分辨率，各比例之和应为 1。各阶段优先使用相同分辨率的 Dataset，否则覆盖分辨率。支持 epochs 和 steps。"
            @change="setTraining('resolution_schedule', $event)"
          />

          <div class="dt-sched-bar-wrap">
            <div class="dt-sched-head">
              <span class="muted">阶段分配预览</span>
              <span class="dt-sched-status" :class="scheduleSummary.status">{{ scheduleSummary.badge }}</span>
            </div>
            <div class="dt-sched-stages">
              <div v-if="!scheduleSummary.stages.length" class="dt-sched-stage st-0" style="width: 100%">
                {{ scheduleSummary.status === 'off' ? '未启用渐进式分辨率计划 · 全程使用各 Dataset 设定分辨率' : '等待有效格式输入' }}
              </div>
              <div
                v-for="(st, idx) in scheduleSummary.stages"
                :key="idx"
                class="dt-sched-stage"
                :class="`st-${idx % 3}`"
                :style="{ width: `${st.widthPct}%` }"
              >
                {{ st.label }}
              </div>
            </div>
          </div>

          <div class="dt-preset-row">
            <span>快捷预设：</span>
            <button
              v-for="preset in schedulePresets"
              :key="preset.label"
              type="button"
              class="dt-chip"
              :class="{ active: scheduleSummary.raw === preset.value }"
              @click="applySchedulePreset(preset.value)"
            >
              {{ preset.label }}
            </button>
          </div>
        </div>
      </section>

      <section v-if="isAnima" class="dt-global-meta" aria-label="模型元数据触发词">
        <div class="dt-sec-head">
          <h3>模型元数据 · Metadata</h3>
          <span class="dt-sec-meta">dataset.general</span>
        </div>
        <ConfigField
          :object="general"
          field="class_tokens"
          label="元数据触发词 (class_tokens)"
          @change="onGeneralClassTokensChange($event)"
        />
      </section>

      <!-- 3. DATASET & SUBSET HAIRLINE WORKBENCH -->
      <div class="dt-list-header">
        <div class="dt-list-title">
          <h3>数据集列表</h3>
          <span class="mono">({{ datasets.length }} 个 Dataset · 共 {{ totalSubsetsCount }} 个子集)</span>
        </div>
        <button type="button" class="button dt-btn primary" @click="addDataset">添加 Dataset</button>
      </div>

      <article v-for="(dataset, di) in datasets" :key="di" class="dataset-card dt-dataset-block">
        <header class="dt-ds-bar">
          <div class="dt-ds-identity">
            <h3>Dataset {{ di + 1 }}</h3>
            <span v-if="isAnima" class="dt-ds-lbai-pill">
              LBAI {{ estimates[di] ? Number(estimates[di].value.toPrecision(4)) : '—' }}
              <small v-if="estimates[di] && totalEstimate && totalEstimate.value > 0"> · 占总量 {{ ((estimates[di].value / totalEstimate.value) * 100).toFixed(1) }}%</small>
            </span>
          </div>

          <div class="dt-ds-inline-fields">
            <ConfigField :object="dataset" field="resolution" label="分辨率 [宽, 高] 或单值" type="json" :fallback="[1024, 1024]" class="dt-inline-cf dt-res-cf" />
            <ConfigField :object="dataset" field="batch_size" label="Batch Size" type="number" :fallback="1" :min="1" class="dt-inline-cf dt-short-cf" />
            <ConfigField :object="dataset" field="caption_extension" label="Caption 扩展名" fallback=".txt" class="dt-inline-cf dt-short-cf" />
          </div>

          <div class="dt-ds-actions">
            <button type="button" class="button dt-btn" @click="addSubset(dataset)">添加子集</button>
            <button type="button" class="button dt-btn danger" :disabled="datasets.length <= 1" @click="deleteDataset(di)">删除 Dataset</button>
          </div>
        </header>

        <article
          v-for="(subset, si) in subsets(dataset)"
          :key="si"
          :id="`subset-block-${di}-${si}`"
          class="subset-card dt-subset-block"
          :class="{ 'is-highlighted': highlightedKey === `${di}-${si}` }"
        >
          <header class="dt-sub-header">
            <div class="dt-sub-head-left">
              <button type="button" class="button dt-sub-toggle" :aria-expanded="!collapsed.has(subset)" @click="toggle(subset)">
                {{ collapsed.has(subset) ? '▸' : '▾' }} 子集 {{ si + 1 }} {{ subset.is_reg ? '(REG)' : '' }}
              </button>
              <span v-if="subset.is_reg" class="dt-reg-badge">(REG)</span>
              <span class="dt-count-badge" :class="dirStatus(subset).kind" :title="dirStatus(subset).error">
                图片：{{ dirStatus(subset).text }}
              </span>
              <span v-if="isAnima" class="dt-sub-math-summary">{{ subsetMathSummary(subset) }}</span>
            </div>
            <button type="button" class="button dt-mini-btn dt-btn danger" :disabled="subsets(dataset).length <= 1" @click="deleteSubset(dataset, si)">删除子集</button>
          </header>

          <div v-if="!collapsed.has(subset)" class="dt-sub-body" :class="{ 'single-col': !isAnima && !moss }">
            <!-- Left Column: Directory, Exposure Weight & Image Augmentations -->
            <div class="dt-sub-col">
              <div class="dt-col-label">
                <span>数据源、曝光权重与图像增强</span>
                <span class="mono">D{{ di + 1 }} · S{{ si + 1 }}</span>
              </div>

              <ConfigField :object="subset" field="image_dir" label="服务器图片目录" />

              <div class="dt-dir-action-bar">
                <button type="button" class="button dt-mini-btn" :disabled="!subset.image_dir" @click="openFolder(subset.image_dir)">打开目录</button>
                <button type="button" class="button dt-mini-btn" :disabled="store.running" @click="manageAssets(dataset, subset, 'import')">导入数据集</button>
                <button type="button" class="button dt-mini-btn" :disabled="!subset.image_dir" @click="manageAssets(dataset, subset, 'browse')">浏览 / 预览</button>
                <button type="button" class="button dt-mini-btn" @click="counts.delete(String(subset.image_dir || '').trim()); refreshCounts()">重新计数</button>
              </div>

              <div class="dt-weight-grid" :class="{ 'single-col': !isAnima }">
                <ConfigField :object="subset" field="num_repeats" label="重复次数" type="number" :min="1" :fallback="1" />
                <ConfigField v-if="isAnima" :object="subset" field="epoch_sample_rate" label="每轮图片采样比例" type="number" :fallback="1" :step="0.01" :min="0" :max="1" />
              </div>

              <div v-if="isAnima" class="dt-live-mult-strip">
                <span>单轮有效样本算式：</span>
                <strong>{{ subsetMathSummary(subset) }}</strong>
              </div>

              <div v-if="isAnima" class="dt-bool-grid">
                <div v-for="[field, label] in subsetBoolFields" :key="field" class="dt-bool-cell">
                  <ConfigField :object="subset" :field="field" :label="label" type="boolean" />
                </div>
              </div>
            </div>

            <!-- Right Column (MOSS) -->
            <div v-if="moss" class="dt-sub-col">
              <div class="dt-col-label">
                <span>Caption 标注设置</span>
                <span class="mono">MOSS</span>
              </div>
              <div class="dt-affix-grid">
                <ConfigField :object="subset" field="caption_prefix" label="Caption 前缀" />
                <ConfigField :object="subset" field="caption_suffix" label="Caption 后缀" />
                <ConfigField :object="subset" field="caption_dropout_rate" label="Caption Dropout" type="number" :min="0" :max="1" :step="0.01" />
              </div>
            </div>

            <!-- Right Column (Anima): Live Caption Assembly Pipeline & Dropout Regularization -->
            <div v-if="isAnima" class="dt-sub-col">
              <div class="dt-col-label">
                <span>Caption 拼接流水线与丢弃正则</span>
                <span class="mono">顺序 1 ➔ 2 ➔ 3 ➔ 4 ➔ 5 ➔ 6</span>
              </div>

              <div class="dt-pipeline-box">
                <div class="dt-pipe-flow">
                  <span class="dt-pipe-node" :class="{ 'has-val': Boolean(subset.caption_prefix) }">1. Caption 前缀</span>
                  <span class="dt-pipe-arrow">➔</span>
                  <span class="dt-pipe-node tags-core">2. Tags (前 {{ captionPreview(subset).keep }} 项保留 | {{ captionPreview(subset).shuffle ? '其余打乱' : '原序' }})</span>
                  <span class="dt-pipe-arrow">➔</span>
                  <span class="dt-pipe-node" :class="{ 'has-val': Boolean(subset.tags_suffix) }">3. tags部分后缀</span>
                  <span class="dt-pipe-arrow">➔</span>
                  <span class="dt-pipe-node" :class="{ 'has-val': Boolean(subset.natural_language_prefix) }">4. 自然语言前缀</span>
                  <span class="dt-pipe-arrow">➔</span>
                  <span class="dt-pipe-node tags-core">5. 自然语言正文</span>
                  <span class="dt-pipe-arrow">➔</span>
                  <span class="dt-pipe-node" :class="{ 'has-val': Boolean(subset.caption_suffix) }">6. Caption 后缀</span>
                </div>

                <div class="dt-pipe-preview">
                  <template v-for="tok in captionPreview(subset).tokens" :key="tok.idx">
                    <span v-if="tok.kind === 'fixed'" class="dt-tok-fixed" :title="`保留 Token 保护项 #${tok.idx + 1} (固定不打乱)`">[固定#{{ tok.idx + 1 }}] {{ tok.text }},</span>
                    <span v-else-if="tok.kind === 'shuffle'" class="dt-tok-shuffle" title="参与随机打乱 / Tag Dropout">{{ tok.text }},</span>
                    <span v-else>{{ tok.text }}, </span>
                  </template>
                  <span v-if="captionPreview(subset).tagsSuffix" class="dt-tok-affix" title="3. tags部分后缀 (固定在 Tags 后)">{{ captionPreview(subset).tagsSuffix }}</span>
                  <span v-if="captionPreview(subset).nlPrefix" class="dt-tok-affix" title="4. 自然语言部分前缀 (固定在自然语言前)">{{ captionPreview(subset).nlPrefix }}</span>
                  <span class="dt-tok-nl" title="5. 自然语言正文 (保持原序)">{{ SAMPLE_NL }}</span>
                  <span v-if="captionPreview(subset).suffix" class="dt-tok-affix" title="6. Caption 后缀 (固定在末尾)">{{ captionPreview(subset).suffix }}</span>
                </div>

                <div v-if="captionPreview(subset).showNoCommaTip" class="dt-comma-tip">
                  提示：当前「Caption 前缀」末尾无逗号，将通过空格与第 1 个 Tag 合并为同一标签项，并被「保留 Token = {{ captionPreview(subset).keep }}」整体固定。若需单独作为一项请以英文逗号结尾。
                </div>
              </div>

              <div class="dt-affix-grid">
                <ConfigField :object="subset" field="caption_prefix" label="Caption 前缀" />
                <ConfigField :object="subset" field="tags_suffix" label="tags部分后缀" />
                <ConfigField :object="subset" field="natural_language_prefix" label="自然语言部分前缀" />
                <ConfigField :object="subset" field="caption_suffix" label="Caption 后缀" />
              </div>

              <div class="dt-dropout-grid">
                <ConfigField
                  v-for="[field, label, fallback] in subsetDropoutFields"
                  :key="field"
                  :object="subset"
                  :field="field"
                  :label="label"
                  type="number"
                  :fallback="fallback"
                  :step="field.includes('rate') ? 0.01 : 1"
                  :min="0"
                  :max="field.includes('rate') ? 1 : undefined"
                />
              </div>
            </div>
          </div>
        </article>
      </article>
    </fieldset>

    <!-- Read-only Preview Strip (Outside Fieldset when locked) -->
    <section v-if="store.locked" class="dt-readonly-bar" aria-label="数据集只读预览">
      <span class="dt-readonly-title">数据集只读预览（任务已锁定 / 训练中，仍可浏览已绑定目录的样本与切分预览）：</span>
      <div class="dt-readonly-btns">
        <template v-for="(dataset, di) in datasets" :key="di">
          <button
            v-for="(subset, si) in subsets(dataset)"
            :key="si"
            type="button"
            class="button dt-btn"
            :disabled="!subset.image_dir"
            @click="manageAssets(dataset, subset, 'browse')"
          >
            预览 Dataset {{ di + 1 }} / 子集 {{ si + 1 }}
          </button>
        </template>
      </div>
    </section>

    <DatasetAssetManager
      v-if="assetTarget"
      :key="assetTarget.job || ''"
      :directory="assetTarget.subset.image_dir || ''"
      :mode="assetTarget.mode"
      :caption-extension="assetTarget.dataset.caption_extension || '.txt'"
      :caption-config="{ ...general, ...assetTarget.dataset, ...assetTarget.subset }"
      :disabled="store.locked || store.running"
      @close="assetTarget = null"
      @imported="applyImported"
    />
  </section>
</template>

<style scoped>
.dt-wrap {
  --dt-mono: "Cascadia Mono", Consolas, "JetBrains Mono", ui-monospace, monospace;
  --dt-hairline: color-mix(in srgb, var(--border) 82%, transparent);
  --dt-hairline-soft: color-mix(in srgb, var(--border) 48%, transparent);
  --dt-surface: color-mix(in srgb, var(--foreground) 2.5%, transparent);
  --dt-surface-strong: color-mix(in srgb, var(--foreground) 4.5%, transparent);
  --dt-ok: #26895a;
  --dt-warn: #b87114;
  --dt-err: var(--destructive);
  width: 100%;
  min-width: 0;
  color: var(--foreground);
}
:global(.dark) .dt-wrap {
  --dt-ok: #5ace9d;
  --dt-warn: #f0b254;
}
.mono {
  font-family: var(--dt-mono);
  font-variant-numeric: tabular-nums;
}

/* Top Header */
.dt-top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--dt-hairline);
  margin-bottom: 18px;
}
.dt-title-block {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
}
.dt-title-block h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 650;
  letter-spacing: -0.01em;
}
.dt-title-block p {
  margin: 0;
  font-size: 13px;
}

/* 1. HERO: LBAI Multi-Zone Ruler & Live Formula Workbench */
.dt-lbai-hero {
  padding: 4px 0 18px;
  border-bottom: 1px solid var(--dt-hairline);
  margin-bottom: 20px;
}
.dt-lbai-top {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.dt-lbai-main {
  display: flex;
  align-items: baseline;
  gap: 14px;
  flex-wrap: wrap;
}
.dt-lbai-val {
  font-family: var(--dt-mono);
  font-variant-numeric: tabular-nums;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.1;
  color: var(--foreground);
}
.dt-status-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 600;
  border: 1px solid currentColor;
}
.dt-status-badge.in-range {
  color: var(--dt-ok);
  background: color-mix(in srgb, var(--dt-ok) 11%, transparent);
  border-color: color-mix(in srgb, var(--dt-ok) 40%, transparent);
}
.dt-status-badge.low {
  color: var(--dt-warn);
  background: color-mix(in srgb, var(--dt-warn) 11%, transparent);
  border-color: color-mix(in srgb, var(--dt-warn) 40%, transparent);
}
.dt-status-badge.high {
  color: var(--dt-err);
  background: color-mix(in srgb, var(--dt-err) 11%, transparent);
  border-color: color-mix(in srgb, var(--dt-err) 40%, transparent);
}
.dt-status-badge.na {
  color: var(--muted-foreground);
  background: var(--dt-surface);
  border-color: var(--dt-hairline);
}
.dt-lbai-target-ctl {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.dt-lbai-target-ctl label {
  font-size: 12px;
  font-weight: 500;
  color: var(--muted-foreground);
}
.dt-target-select {
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--dt-hairline);
  border-radius: 4px;
  background: var(--card);
  color: var(--foreground);
  font-size: 13px;
  font-family: var(--dt-mono);
}

/* LBAI Calibrated Multi-Zone Ruler */
.dt-ruler-stage {
  position: relative;
  padding: 8px 0 4px;
  user-select: none;
}
.dt-ruler-zones {
  position: relative;
  height: 22px;
  margin-bottom: 6px;
}
.dt-zone-band {
  position: absolute;
  top: 0;
  height: 21px;
  border-radius: 3px;
  border: 1px solid transparent;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  padding: 0 6px;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  cursor: pointer;
  color: var(--foreground);
  transition: opacity .15s, border-color .15s;
}
.dt-zone-band.z0 {
  background: color-mix(in srgb, #3b82f6 15%, transparent);
  border-color: color-mix(in srgb, #3b82f6 40%, transparent);
}
.dt-zone-band.z1 {
  background: color-mix(in srgb, #a855f7 15%, transparent);
  border-color: color-mix(in srgb, #a855f7 40%, transparent);
}
.dt-zone-band.z2 {
  background: color-mix(in srgb, #ef4444 15%, transparent);
  border-color: color-mix(in srgb, #ef4444 40%, transparent);
}
.dt-zone-band.is-active {
  border-width: 1.5px;
  border-color: var(--primary);
  background: color-mix(in srgb, var(--primary) 22%, transparent);
  font-weight: 650;
}
.dt-zone-name {
  overflow: hidden;
  text-overflow: ellipsis;
}
.dt-zone-range {
  font-family: var(--dt-mono);
  font-size: 10.5px;
  opacity: 0.9;
  flex-shrink: 0;
}
.dt-ruler-track {
  position: relative;
  height: 24px;
  background: var(--dt-surface-strong);
  border: 1px solid var(--dt-hairline);
  border-radius: 3px;
  overflow: visible;
}
.dt-ruler-stack {
  display: flex;
  height: 100%;
  width: 100%;
  border-radius: 2px;
  overflow: hidden;
}
.dt-stack-seg {
  height: 100%;
  display: flex;
  align-items: center;
  padding: 0 6px;
  font-size: 11px;
  font-family: var(--dt-mono);
  font-weight: 600;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  cursor: pointer;
  transition: width .2s ease, filter .15s;
  border-right: 1px solid rgba(0, 0, 0, 0.25);
}
.dt-stack-seg:hover { filter: brightness(1.12); }
.dt-stack-seg.seg-0 { background: #326cd4; }
.dt-stack-seg.seg-1 { background: #7c4dff; }
.dt-stack-seg.seg-2 { background: #0d9488; }
:global(.dark) .dt-stack-seg.seg-0 { background: #3b6fd4; }
:global(.dark) .dt-stack-seg.seg-1 { background: #7e57c2; }
:global(.dark) .dt-stack-seg.seg-2 { background: #0f766e; }

.dt-ruler-needle {
  position: absolute;
  top: -3px;
  bottom: -18px;
  width: 2px;
  background: var(--foreground);
  pointer-events: none;
  z-index: 4;
  transition: left .2s ease;
}
.dt-ruler-needle::before {
  content: "";
  position: absolute;
  top: -3px;
  left: -4px;
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
  border-top: 6px solid var(--foreground);
}
.dt-needle-flag {
  position: absolute;
  bottom: -2px;
  left: 6px;
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--foreground);
  color: var(--background);
  font-family: var(--dt-mono);
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
}
.dt-ruler-ticks {
  position: relative;
  height: 20px;
  margin-top: 16px;
  font-family: var(--dt-mono);
  font-size: 11px;
  color: var(--muted-foreground);
}
.dt-tick {
  position: absolute;
  transform: translateX(-50%);
  top: 0;
}
.dt-tick::before {
  content: "";
  display: block;
  width: 1px;
  height: 4px;
  background: var(--dt-hairline);
  margin: 0 auto 1px;
}
.dt-tick:first-child { transform: none; }
.dt-tick:first-child::before { margin-left: 0; }
.dt-tick:last-child { transform: translateX(-100%); }
.dt-tick:last-child::before { margin-right: 0; }

/* Legend + Formula Strip */
.dt-lbai-legend-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--dt-hairline-soft);
  font-size: 12px;
}
.dt-seg-chips {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.dt-seg-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  border: 1px solid var(--dt-hairline);
  border-radius: 4px;
  background: var(--dt-surface);
  font-size: 12px;
  cursor: pointer;
  transition: border-color .15s, color .15s;
}
.dt-seg-chip:hover { border-color: var(--primary); color: var(--primary); }
.dt-seg-chip.is-reg { opacity: 0.8; border-style: dashed; }
.dt-seg-swatch { width: 8px; height: 8px; border-radius: 2px; flex-shrink: 0; }
.dt-legend-hint { font-size: 12px; }

.dt-formula-strip {
  margin-top: 10px;
  padding: 8px 12px;
  background: var(--dt-surface);
  border-top: 1px solid var(--dt-hairline-soft);
  border-bottom: 1px solid var(--dt-hairline-soft);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.dt-formula-eq {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 13px;
}
.dt-f-term {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
  padding: 2px 7px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--card) 85%, transparent);
  border: 1px solid var(--dt-hairline-soft);
}
.dt-f-term .k { font-size: 11.5px; color: var(--muted-foreground); }
.dt-f-term .v { font-family: var(--dt-mono); font-weight: 600; font-size: 12.5px; color: var(--foreground); }
.dt-f-op { font-family: var(--dt-mono); color: var(--muted-foreground); font-weight: 600; }
.dt-formula-note { font-size: 12px; color: var(--muted-foreground); }

/* Fieldset */
.dt-fieldset {
  border: 0;
  padding: 0;
  margin: 0;
  min-width: 0;
}
.dt-fieldset:disabled { opacity: 0.65; }

/* 2. GLOBAL BUCKETING & PROGRESSIVE RESOLUTION STRIP */
.dt-global-grid {
  display: grid;
  grid-template-columns: 1.08fr 0.92fr;
  gap: 0;
  border-bottom: 1px solid var(--dt-hairline);
  padding-bottom: 18px;
  margin-bottom: 22px;
}
.dt-global-grid.single-col {
  grid-template-columns: 1fr;
}
.dt-global-meta {
  border-bottom: 1px solid var(--dt-hairline);
  padding-bottom: 18px;
  margin-bottom: 22px;
}
.dt-g-col {
  min-width: 0;
  padding-right: 24px;
  border-right: 1px solid var(--dt-hairline-soft);
}
.dt-g-col:last-child {
  padding-right: 0;
  padding-left: 24px;
  border-right: 0;
}
.dt-global-grid.single-col .dt-g-col {
  padding: 0;
  border-right: 0;
}
.dt-sec-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  padding-bottom: 8px;
  margin-bottom: 10px;
  border-bottom: 1px solid var(--dt-hairline);
}
.dt-sec-head h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 650;
}
.dt-sec-meta {
  font-family: var(--dt-mono);
  font-size: 12px;
  color: var(--muted-foreground);
}
.dt-check-strip {
  display: flex;
  align-items: center;
  gap: 10px 18px;
  flex-wrap: wrap;
  padding: 6px 0 10px;
  border-bottom: 1px solid var(--dt-hairline-soft);
}
.dt-num-triad {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  padding: 10px 0;
  border-bottom: 1px solid var(--dt-hairline-soft);
}
.dt-bucket-ruler {
  margin-top: 10px;
  padding: 7px 10px;
  border-radius: 4px;
  background: var(--dt-surface);
  border: 1px solid var(--dt-hairline-soft);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
  font-family: var(--dt-mono);
}
.dt-bucket-ticks {
  flex: 1;
  height: 6px;
  border-left: 2px solid var(--primary);
  border-right: 2px solid var(--primary);
  background-image: repeating-linear-gradient(
    90deg,
    color-mix(in srgb, var(--primary) 50%, transparent) 0,
    color-mix(in srgb, var(--primary) 50%, transparent) 1px,
    transparent 1px,
    transparent 12px
  );
}

/* Progressive Resolution Schedule */
.dt-sched-bar-wrap { margin-top: 10px; }
.dt-sched-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 5px;
  font-size: 12px;
}
.dt-sched-status {
  font-family: var(--dt-mono);
  font-weight: 600;
  font-size: 12px;
  padding: 1px 7px;
  border-radius: 3px;
}
.dt-sched-status.ok { color: var(--dt-ok); background: color-mix(in srgb, var(--dt-ok) 12%, transparent); }
.dt-sched-status.warn { color: var(--dt-warn); background: color-mix(in srgb, var(--dt-warn) 15%, transparent); }
.dt-sched-status.off { color: var(--muted-foreground); background: var(--dt-surface); }
.dt-sched-stages {
  display: flex;
  height: 26px;
  border: 1px solid var(--dt-hairline);
  border-radius: 4px;
  overflow: hidden;
  background: var(--dt-surface);
}
.dt-sched-stage {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 8px;
  font-family: var(--dt-mono);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  border-right: 1px solid var(--dt-hairline);
}
.dt-sched-stage:last-child { border-right: 0; }
.dt-sched-stage.st-0 { background: color-mix(in srgb, var(--primary) 16%, transparent); }
.dt-sched-stage.st-1 { background: color-mix(in srgb, var(--primary) 30%, transparent); }
.dt-sched-stage.st-2 { background: color-mix(in srgb, var(--primary) 44%, transparent); }
.dt-preset-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 8px;
}
.dt-preset-row span { font-size: 12px; color: var(--muted-foreground); }
.dt-chip {
  padding: 2px 8px;
  border: 1px solid var(--dt-hairline);
  border-radius: 4px;
  font-family: var(--dt-mono);
  font-size: 12px;
  color: var(--muted-foreground);
  background: transparent;
  transition: border-color .15s, color .15s, background .15s;
}
.dt-chip:hover:not(:disabled),
.dt-chip.active {
  border-color: var(--primary);
  color: var(--primary);
}
.dt-chip.active {
  background: color-mix(in srgb, var(--primary) 12%, transparent);
}

/* 3. DATASET & SUBSET HAIRLINE WORKBENCH */
.dt-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding-bottom: 10px;
  border-bottom: 2px solid var(--dt-hairline);
  margin-bottom: 16px;
}
.dt-list-title {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.dt-list-title h3 { margin: 0; font-size: 15px; font-weight: 650; }
.dt-list-title span { font-size: 13px; color: var(--muted-foreground); }

.dt-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border: 1px solid var(--dt-hairline);
  border-radius: 5px;
  font-size: 13px;
  font-weight: 500;
  background: color-mix(in srgb, var(--card) 85%, transparent);
  color: var(--foreground);
  transition: border-color .15s, background .15s, color .15s;
}
.dt-btn:hover:not(:disabled) { border-color: var(--primary); color: var(--primary); }
.dt-btn.primary {
  background: color-mix(in srgb, var(--primary) 15%, var(--card));
  border-color: color-mix(in srgb, var(--primary) 55%, var(--border));
  color: var(--primary);
  font-weight: 600;
}
.dt-btn.primary:hover:not(:disabled) { background: var(--primary); color: var(--primary-foreground); }
.dt-btn.danger:hover:not(:disabled) { border-color: var(--destructive); color: var(--destructive); }

/* Dataset Section */
.dt-dataset-block {
  margin-bottom: 24px;
  border-top: 1px solid var(--dt-hairline);
  padding-top: 12px;
}
.dt-dataset-block:first-of-type { border-top: 0; padding-top: 0; }
.dt-ds-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px 14px;
  flex-wrap: wrap;
  padding: 9px 12px;
  background: var(--dt-surface-strong);
  border: 1px solid var(--dt-hairline);
  border-left: 3px solid var(--primary);
  border-radius: 4px;
  margin-bottom: 12px;
}
.dt-ds-identity {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.dt-ds-identity h3 { margin: 0; font-size: 15px; font-weight: 700; }
.dt-ds-lbai-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--primary) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--primary) 35%, transparent);
  font-family: var(--dt-mono);
  font-size: 12.5px;
  font-weight: 600;
}
.dt-ds-lbai-pill small { display: inline; font-weight: 400; color: var(--muted-foreground); }
.dt-ds-inline-fields {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  flex-wrap: wrap;
}
.dt-ds-actions { display: flex; align-items: center; gap: 8px; }

/* Subset Section */
.dt-subset-block {
  margin-left: 12px;
  padding-left: 16px;
  border-left: 2px solid var(--dt-hairline);
  margin-bottom: 16px;
  transition: border-color .2s, background .2s;
}
.dt-subset-block.is-highlighted {
  border-left-color: var(--primary);
  background: color-mix(in srgb, var(--primary) 6%, transparent);
}
.dt-sub-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 7px 10px;
  background: var(--dt-surface);
  border-top: 1px solid var(--dt-hairline);
  border-bottom: 1px solid var(--dt-hairline);
}
.dt-sub-head-left {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.dt-sub-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 650;
  color: var(--foreground);
  padding: 2px 4px;
  border: 0;
  background: transparent;
}
.dt-sub-toggle:hover { color: var(--primary); }
.dt-reg-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border-radius: 3px;
  font-family: var(--dt-mono);
  font-size: 11px;
  font-weight: 700;
  color: var(--dt-warn);
  background: color-mix(in srgb, var(--dt-warn) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--dt-warn) 40%, transparent);
}
.dt-count-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border-radius: 4px;
  font-family: var(--dt-mono);
  font-size: 12px;
  font-weight: 600;
}
.dt-count-badge.ok { color: var(--dt-ok); background: color-mix(in srgb, var(--dt-ok) 12%, transparent); }
.dt-count-badge.empty { color: var(--muted-foreground); background: var(--dt-surface-strong); }
.dt-count-badge.err {
  color: var(--dt-err);
  background: color-mix(in srgb, var(--dt-err) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--dt-err) 40%, transparent);
}
.dt-sub-math-summary { font-family: var(--dt-mono); font-size: 12px; color: var(--muted-foreground); }

/* Subset 2-Column Hairline Body */
.dt-sub-body {
  display: grid;
  grid-template-columns: 0.92fr 1.08fr;
  gap: 0;
  padding: 12px 0 8px;
  border-bottom: 1px solid var(--dt-hairline);
}
.dt-sub-body.single-col { grid-template-columns: 1fr; }
.dt-sub-col {
  min-width: 0;
  padding-right: 20px;
  border-right: 1px solid var(--dt-hairline-soft);
}
.dt-sub-col:last-child { padding-right: 0; padding-left: 20px; border-right: 0; }
.dt-sub-body.single-col .dt-sub-col { padding: 0; border-right: 0; }
.dt-col-label {
  font-size: 12px;
  font-weight: 650;
  color: var(--muted-foreground);
  padding-bottom: 6px;
  margin-bottom: 8px;
  border-bottom: 1px solid var(--dt-hairline-soft);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.dt-dir-action-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 8px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--dt-hairline-soft);
}
.dt-mini-btn {
  height: 26px;
  padding: 0 9px;
  border: 1px solid var(--dt-hairline);
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
  background: var(--dt-surface);
  color: var(--foreground);
  transition: border-color .15s, color .15s;
}
.dt-mini-btn:hover:not(:disabled) { border-color: var(--primary); color: var(--primary); }

.dt-weight-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  padding: 10px 0 8px;
}
.dt-weight-grid.single-col { grid-template-columns: 1fr; }
.dt-live-mult-strip {
  padding: 6px 10px;
  margin-bottom: 10px;
  border-radius: 4px;
  background: var(--dt-surface);
  border: 1px solid var(--dt-hairline-soft);
  font-family: var(--dt-mono);
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.dt-bool-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px 12px;
  padding-top: 8px;
  border-top: 1px solid var(--dt-hairline-soft);
}
.dt-bool-cell {
  padding: 4px 8px;
  border-radius: 4px;
  background: var(--dt-surface);
  border: 1px solid var(--dt-hairline-soft);
}

/* Right Column: Live Caption Assembly Pipeline */
.dt-pipeline-box {
  padding: 9px 11px;
  border-radius: 4px;
  background: var(--dt-surface);
  border: 1px solid var(--dt-hairline);
  margin-bottom: 10px;
}
.dt-pipe-flow {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.dt-pipe-node {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  border-radius: 3px;
  font-size: 12px;
  font-family: var(--dt-mono);
  border: 1px solid var(--dt-hairline);
  background: var(--card);
  color: var(--muted-foreground);
}
.dt-pipe-node.has-val {
  color: var(--foreground);
  border-color: color-mix(in srgb, var(--primary) 55%, var(--border));
  background: color-mix(in srgb, var(--primary) 11%, var(--card));
  font-weight: 600;
}
.dt-pipe-node.tags-core {
  color: var(--foreground);
  background: color-mix(in srgb, var(--foreground) 5%, var(--card));
}
.dt-pipe-arrow { color: var(--muted-foreground); font-size: 11px; user-select: none; }
.dt-pipe-preview {
  padding: 6px 8px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--background) 75%, var(--card));
  border: 1px solid var(--dt-hairline-soft);
  font-family: var(--dt-mono);
  font-size: 12px;
  line-height: 1.5;
  word-break: break-word;
}
.dt-tok-fixed {
  display: inline-block;
  padding: 0 5px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--dt-ok) 18%, transparent);
  border: 1px solid color-mix(in srgb, var(--dt-ok) 45%, transparent);
  margin-right: 3px;
}
.dt-tok-shuffle {
  display: inline-block;
  padding: 0 5px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--primary) 14%, transparent);
  border: 1px dashed color-mix(in srgb, var(--primary) 45%, transparent);
  margin-right: 3px;
}
.dt-tok-affix {
  display: inline-block;
  padding: 0 5px;
  border-radius: 3px;
  background: color-mix(in srgb, #a855f7 16%, transparent);
  border: 1px solid color-mix(in srgb, #a855f7 42%, transparent);
  margin-right: 3px;
}
.dt-tok-nl { color: var(--muted-foreground); }
.dt-comma-tip {
  margin-top: 6px;
  padding: 5px 8px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--dt-warn) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--dt-warn) 45%, transparent);
  color: var(--dt-warn);
  font-size: 12px;
  line-height: 1.45;
}
.dt-affix-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--dt-hairline-soft);
}
.dt-dropout-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  padding-top: 10px;
}

/* Read-only preview section when locked */
.dt-readonly-bar {
  margin-top: 18px;
  padding: 12px 16px;
  border: 1px solid color-mix(in srgb, var(--primary) 45%, var(--border));
  border-radius: 5px;
  background: color-mix(in srgb, var(--primary) 8%, var(--card));
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.dt-readonly-title { font-size: 13px; font-weight: 600; }
.dt-readonly-btns { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

/* Hairline ConfigField Styling */
.dt-wrap :deep(.field) {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.dt-wrap :deep(.field-check) {
  flex-direction: row;
  align-items: center;
  gap: 6px;
}
.dt-wrap :deep(.field-label-row) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.dt-wrap :deep(.field-label-row label) {
  font-size: 12px;
  font-weight: 500;
  color: var(--muted-foreground);
}
.dt-wrap :deep(.field input:not([type="checkbox"])),
.dt-wrap :deep(.field select) {
  height: 30px;
  padding: 0 8px;
  border: 1px solid var(--dt-hairline);
  border-radius: 4px;
  background: color-mix(in srgb, var(--card) 75%, transparent);
  color: var(--foreground);
  font-family: var(--dt-mono);
  font-size: 13px;
}
.dt-wrap :deep(.field textarea) {
  min-height: 30px;
  height: 30px;
  padding: 4px 8px;
  border: 1px solid var(--dt-hairline);
  border-radius: 4px;
  background: color-mix(in srgb, var(--card) 75%, transparent);
  color: var(--foreground);
  font-family: var(--dt-mono);
  font-size: 13px;
  resize: vertical;
}
.dt-wrap :deep(.dt-res-cf) { width: 148px; }
.dt-wrap :deep(.dt-short-cf) { width: 92px; }
.dt-wrap :deep(.field small.muted) {
  font-size: 11.5px;
  line-height: 1.4;
}

@media (min-width: 1800px) {
  .dt-g-col { padding-right: 28px; }
  .dt-g-col:last-child { padding-left: 28px; }
  .dt-sub-col { padding-right: 24px; }
  .dt-sub-col:last-child { padding-left: 24px; }
}
@media (min-width: 1920px) {
  .dt-affix-grid { grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
}
@media (max-width: 1220px) {
  .dt-global-grid,
  .dt-sub-body {
    grid-template-columns: 1fr;
    gap: 16px;
  }
  .dt-g-col,
  .dt-g-col:last-child,
  .dt-sub-col,
  .dt-sub-col:last-child {
    padding: 0;
    border-right: 0;
  }
  .dt-dropout-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 680px) {
  .dt-num-triad,
  .dt-affix-grid,
  .dt-weight-grid,
  .dt-bool-grid {
    grid-template-columns: 1fr;
  }
}
</style>
