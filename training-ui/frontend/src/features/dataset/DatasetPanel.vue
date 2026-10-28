<script setup lang="ts">
import { computed, onUnmounted, reactive, ref, watch } from 'vue'
import { useEditorStore } from '@/stores/editor'
import { api } from '@/services/api'
import ConfigField from '@/components/forms/ConfigField.vue'
import FieldHelp from '@/components/forms/FieldHelp.vue'
import { provideFieldHelp } from '@/components/forms/help-context'
import { LBAI } from '@/domain/legacy'
import DatasetAssetManager from './DatasetAssetManager.vue'

const store = useEditorStore()
provideFieldHelp('dataset')
const moss = computed(() => store.architecture === 'moss_image')
type RecordValue = Record<string, any>
const collapsed = reactive(new WeakSet<object>())
const counts = reactive(new Map<string, { count?: number; error?: string }>())
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
  store.dataset.datasets = [...datasets.value, { resolution: moss.value ? [512,512] : [1024, 1024], batch_size: 1, caption_extension: '.txt', subsets: [{ image_dir: '', num_repeats: 1 }] }]
  store.touch()
}
function deleteDataset(index: number) {
  store.dataset.datasets = datasets.value.filter((_, i) => i !== index)
  store.touch()
}
function addSubset(dataset: RecordValue) {
  dataset.subsets = [...subsets(dataset), ['krea2','moss_image'].includes(store.architecture) ? { image_dir: '', num_repeats: 1 } : { image_dir: '', num_repeats: 1, epoch_sample_rate: 1, keep_tokens: 1, caption_dropout_rate: 0.05 }]
  store.touch()
}
function deleteSubset(dataset: RecordValue, index: number) {
  dataset.subsets = subsets(dataset).filter((_, i) => i !== index)
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
onUnmounted(() => { generation++; clearTimeout(countTimer); countRequest?.abort() })
const targets = computed(() => LBAI.normalizeTargets(store.globalConfig?.ui?.lbai_targets))
const estimates = computed(() => datasets.value.map(dataset => {
  const training = subsets(dataset).filter(s => !s.is_reg)
  if (!training.length || training.some(s => counts.get(String(s.image_dir || '').trim())?.count === undefined)) return null
  const t = store.config.training_arguments || {}, n = store.config.network_arguments || {}
  if (!t.max_train_epochs) return null
  return LBAI.calculate({ samplesPerEpoch: training.reduce((sum, s) => sum + counts.get(String(s.image_dir || '').trim())!.count! * Number(s.num_repeats ?? 1) * Math.max(0, Math.min(1, Number(s.epoch_sample_rate ?? 1))), 0), epochs: t.max_train_epochs, learningRate: t.learning_rate, rank: n.network_dim, batchSize: dataset.batch_size ?? 1, gradientAccumulationSteps: t.gradient_accumulation_steps ?? 1, scheduler: t.lr_scheduler, minLrRatio: t.lr_scheduler_min_lr_ratio ?? 0 })
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
const generalFields = [ ['enable_bucket', '启用 Bucket', 'boolean', true], ['bucket_no_upscale', '不放大小图', 'boolean', true], ['balance_regularization_images', '平衡正则化图片', 'boolean', false], ['min_bucket_reso', '最小 Bucket 分辨率', 'number', 512], ['max_bucket_reso', '最大 Bucket 分辨率', 'number', 1536], ['bucket_reso_steps', 'Bucket 步长', 'number', 64] ] as const
const subsetNumbers = [ ['epoch_sample_rate', '每轮图片采样比例', 1], ['keep_tokens', '保留 Token', 1], ['caption_dropout_rate', 'Caption Dropout', 0.05], ['caption_tag_dropout_rate', 'Tag Dropout', 0], ['caption_dropout_every_n_epochs', '每 N 轮 Caption Dropout', 0] ] as const
</script>

<template>
  <section class="panel dataset-panel" v-if="store.name">
    <h2>数据集</h2>
    <p class="muted">每个 Dataset 保留独立分辨率、批量和全部子集。未编辑的扩展字段保持原值。</p>
    <section v-if="!['krea2','moss_image'].includes(store.architecture)" class="lbai total-lbai">
      <strong>总 LBAI {{ totalEstimate ? Number(totalEstimate.value.toPrecision(4)) : '—' }}</strong>
      <select v-model="targetIndex" aria-label="LBAI 比较目标"><option v-for="(target, ti) in targets" :key="ti" :value="ti">{{ target.name }}：{{ target.type === 'point' ? target.value : `${target.min}–${target.max}` }}</option></select><FieldHelp field="lbai_target" label="LBAI 比较目标" />
      <meter v-if="totalEstimate" min="0" :max="Math.max(LBAI.scaleMaximum(targets), totalEstimate.value)" :value="totalEstimate.value" />
      <span>{{ comparison(totalEstimate) }}</span>
      <small class="muted">合计所有 Dataset 的训练程度；每项按其非正则化图片数 × repeats × 采样比例 × epochs × 有效学习率 × rank/32，再除以该项 batch size × 梯度累积。多分辨率训练中同一路径在不同 Dataset 会分别贡献训练量。</small>
    </section>
    <fieldset :disabled="store.locked" class="dataset-edit-fields">
    <div class="fields">
      <template v-for="[field, label, type, fallback] in generalFields" :key="field">
        <ConfigField v-if="!['krea2','moss_image'].includes(store.architecture) || ['enable_bucket','bucket_no_upscale'].includes(field) || moss && ['min_bucket_reso','max_bucket_reso','bucket_reso_steps'].includes(field)" :object="general" :field="field" :label="label" :type="type" :fallback="fallback" @change="setGeneral(field,$event)" />
      </template>
    </div>
    <div v-if="!['krea2','moss_image'].includes(store.architecture)" class="fields">
      <ConfigField :object="training" field="resolution_schedule" label="Progressive Resolution Schedule" help="留空关闭。格式：512:0.4,1024:0.3,1536:0.3；按顺序切换分辨率，各比例之和应为 1。各阶段优先使用相同分辨率的 Dataset，否则覆盖分辨率。支持 epochs 和 steps。" @change="setTraining('resolution_schedule',$event)" />
      <ConfigField :object="training" field="disable_bucket_shuffle" label="Disable Bucket Shuffle" type="boolean" :fallback="false" help="保持 resolution bucket 内的 DataLoader 顺序。" @change="setTraining('disable_bucket_shuffle',$event)" />
    </div>
    <ConfigField v-if="moss" :object="general" field="enable_multiline_caption" label="保留多行 Caption" type="boolean" :fallback="true" @change="setGeneral('enable_multiline_caption',$event)"/>
    <button class="button" @click="addDataset">添加 Dataset</button>
    <article v-for="(dataset, di) in datasets" :key="di" class="dataset-card">
      <header><h3>Dataset {{ di + 1 }}</h3><button class="button" :disabled="datasets.length <= 1" @click="deleteDataset(di)">删除 Dataset</button></header>
      <div class="fields">
        <ConfigField :object="dataset" field="resolution" label="分辨率 [宽, 高] 或单值" type="json" :fallback="[1024,1024]" />
        <ConfigField :object="dataset" field="batch_size" label="Batch Size" type="number" :fallback="1" :min="1" />
        <ConfigField :object="dataset" field="caption_extension" label="Caption 扩展名" fallback=".txt" />
      </div>
      <section v-if="!['krea2','moss_image'].includes(store.architecture)" class="lbai">
        <strong>LBAI {{ estimates[di] ? Number(estimates[di].value.toPrecision(4)) : '—' }}</strong>
        <small class="muted">本 Dataset 的贡献；需要 epoch 模式及有效图片计数。</small>
      </section>
      <article v-for="(subset, si) in subsets(dataset)" :key="si" class="subset-card">
        <header><button class="button" :aria-expanded="!collapsed.has(subset)" @click="toggle(subset)">{{ collapsed.has(subset) ? '▸' : '▾' }} 子集 {{ si + 1 }} {{ subset.is_reg ? '(REG)' : '' }}</button><span :title="counts.get(String(subset.image_dir || '').trim())?.error">图片：{{ !subset.image_dir ? '—' : counts.get(String(subset.image_dir || '').trim())?.error || (counts.get(String(subset.image_dir || '').trim())?.count ?? '…') }}</span><button class="button" :disabled="subsets(dataset).length <= 1" @click="deleteSubset(dataset,si)">删除子集</button></header>
        <div v-if="!collapsed.has(subset)">
          <div class="fields"><ConfigField :object="subset" field="image_dir" label="服务器图片目录" /><ConfigField :object="subset" field="num_repeats" label="重复次数" type="number" :min="1" :fallback="1" /></div>
          <button class="button" :disabled="!subset.image_dir" @click="openFolder(subset.image_dir)">打开目录</button>
          <button class="button" :disabled="store.running" @click="manageAssets(dataset, subset, 'import')">导入数据集</button>
          <button class="button" :disabled="!subset.image_dir" @click="manageAssets(dataset, subset, 'browse')">浏览 / 预览</button>
          <button class="button" @click="counts.delete(String(subset.image_dir || '').trim()); refreshCounts()">重新计数</button>
          <div v-if="moss" class="fields"><ConfigField :object="subset" field="caption_prefix" label="Caption 前缀"/><ConfigField :object="subset" field="caption_suffix" label="Caption 后缀"/><ConfigField :object="subset" field="caption_dropout_rate" label="Caption Dropout" type="number" :min="0" :max="1" :step="0.01"/></div>
          <div class="fields" v-if="!['krea2','moss_image'].includes(store.architecture)">
            <ConfigField v-for="[field,label,fallback] in subsetNumbers" :key="field" :object="subset" :field="field" :label="label" type="number" :fallback="fallback" :step="field.includes('rate') ? 0.01 : 1" :min="0" :max="field.includes('rate') ? 1 : undefined" />
            <ConfigField :object="subset" field="caption_prefix" label="Caption 前缀" />
            <ConfigField v-for="[field,label] in [['shuffle_caption','打乱 Caption'],['flip_aug','水平翻转'],['is_reg','正则化数据集'],['alpha_mask','Alpha Mask']]" :key="field" :object="subset" :field="field" :label="label" type="boolean" />
          </div>
        </div>
      </article>
      <button class="button" @click="addSubset(dataset)">添加子集</button>
    </article>
    </fieldset>
    <section v-if="store.locked" aria-label="数据集只读预览">
      <template v-for="(dataset, di) in datasets" :key="di"><button v-for="(subset, si) in subsets(dataset)" :key="si" class="button" :disabled="!subset.image_dir" @click="manageAssets(dataset, subset, 'browse')">预览 Dataset {{ di + 1 }} / 子集 {{ si + 1 }}</button></template>
    </section>
    <DatasetAssetManager v-if="assetTarget" :key="assetTarget.job || ''" :directory="assetTarget.subset.image_dir || ''" :mode="assetTarget.mode" :caption-extension="assetTarget.dataset.caption_extension || '.txt'" :disabled="store.locked || store.running" @close="assetTarget = null" @imported="applyImported" />
  </section>
</template>

<style scoped>
.dataset-card,.subset-card { border:1px solid var(--border,#444);border-radius:8px;padding:1rem;margin:1rem 0 }
header { display:flex;align-items:center;gap:.75rem;flex-wrap:wrap;justify-content:space-between }
.lbai { display:flex;flex-wrap:wrap;gap:.75rem;padding:1rem 0;align-items:center }.lbai small { flex-basis:100% } meter { width:12rem }
.dataset-edit-fields{border:0;padding:0;margin:0;min-width:0}
</style>
