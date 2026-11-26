<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useEditorStore } from '@/stores/editor'
import { api, jobUrl } from '@/services/api'
import Field from '@/components/forms/ConfigField.vue'
import { defaultNegativePrompt, samplers, schedulers, serializePrompt } from './model'
import { parallelMode, section } from '@/features/training/rules'

const store = useEditorStore()
const krea = computed(() => store.architecture === 'krea2')
const moss = computed(() => store.architecture === 'moss_image')
const isolated = computed(() => krea.value || moss.value)
const mossFlow = ref(5)
const negExpanded = ref(false)

const training = computed(() => section(store.config, 'training_arguments'))
const samplingSteps = computed(() => training.value.max_train_steps > 0)
const samplingEnabled = computed(() => !!(training.value.sample_every_n_epochs || training.value.sample_every_n_steps))
const samplingUnsupported = computed(() => !isolated.value && parallelMode(training.value) === 'tp_sp' && (String(store.config.gpu_ids || '').trim() ? String(store.config.gpu_ids).split(',').filter(Boolean).length : store.gpus.length) > 1)
const samplingLocked = computed(() => store.locked || (isolated.value && store.running) || samplingUnsupported.value)

function toggleSampling(event: Event) {
  if (samplingLocked.value) return
  const on = (event.target as HTMLInputElement).checked
  const t = training.value
  if (!on) {
    delete t.sample_every_n_epochs
    delete t.sample_every_n_steps
  } else if (samplingSteps.value) {
    t.sample_every_n_steps ??= 100
    delete t.sample_every_n_epochs
  } else {
    t.sample_every_n_epochs ??= 1
    delete t.sample_every_n_steps
  }
}

const checkpoints = ref<any[]>([])
const busy = ref(false)
const message = ref('')

const defaults = () => ({
  lora_mul: 1,
  keep_loaded: false,
  flash_attn: false,
  sage_attn: false,
  global_w: moss.value ? 512 : krea.value ? 1024 : 832,
  global_h: moss.value ? 512 : krea.value ? 1024 : 1216,
  global_s: moss.value ? 30 : krea.value ? 52 : 28,
  global_l: 3.5,
  global_d: 0,
  global_sampler: 'euler',
  global_strength: 1,
  global_scheduler: 'linear',
  selected_lora: '',
  gen_gpu_ids: store.gpus.length ? [Number(store.gpus[0].index)] : ([] as number[]),
  gen_multi_gpu_mode: 'parallel_cfg',
})
const transient = reactive(defaults())
const generation = reactive({ base: 'turbo', steps: 8, cfg: 1 })

let restored = false
let controller: AbortController | null = null

function persist() {
  if (!restored || !store.name) return
  localStorage.setItem(
    `prompt_transient_${store.name}`,
    JSON.stringify({ ...transient, gen_gpu_ids: transient.gen_gpu_ids.join(','), negative_prompt: store.negativePrompt }),
  )
  localStorage.setItem(`krea2_generation_${store.name}`, JSON.stringify(generation))
}

async function refresh() {
  if (!store.name) return
  const name = store.name
  controller?.abort()
  controller = new AbortController()
  try {
    const files = await api<any[]>(jobUrl(name, '/checkpoints'), { signal: controller.signal })
    if (store.name === name) {
      checkpoints.value = files
      if (transient.selected_lora && !files.some(f => f.path === transient.selected_lora)) transient.selected_lora = ''
    }
  } catch (e: any) {
    if (e.name !== 'AbortError') message.value = e.message
  }
}

watch(
  () => store.name,
  () => {
    restored = false
    controller?.abort()
    checkpoints.value = []
    message.value = ''
    Object.assign(transient, defaults())
    Object.assign(generation, { base: 'turbo', steps: 8, cfg: 1 })
    if (store.name) {
      try {
        const saved = JSON.parse(localStorage.getItem(`prompt_transient_${store.name}`) || 'null')
        if (saved) Object.assign(transient, saved)
        const g = JSON.parse(localStorage.getItem(`krea2_generation_${store.name}`) || 'null')
        if (g) Object.assign(generation, g)
      } catch {}
    }
    if (!Array.isArray(transient.gen_gpu_ids)) {
      transient.gen_gpu_ids = String(transient.gen_gpu_ids).split(',').filter(Boolean).map(Number)
    }
    if (isolated.value) transient.gen_gpu_ids = transient.gen_gpu_ids.slice(0, 1)
    restored = true
    void refresh()
  },
  { immediate: true },
)

watch([transient, generation, () => store.negativePrompt], persist, { deep: true })
onBeforeUnmount(() => {
  persist()
  controller?.abort()
})

function gpu(id: number) {
  const selected = transient.gen_gpu_ids.includes(id)
  transient.gen_gpu_ids = isolated.value
    ? selected ? [] : [id]
    : selected ? transient.gen_gpu_ids.filter(x => x !== id) : [...transient.gen_gpu_ids, id]
}

function newPrompt() {
  return {
    text: '',
    w: Number(transient.global_w),
    h: Number(transient.global_h),
    s: Number(transient.global_s),
    l: Number(transient.global_l),
    d: moss.value ? Number(transient.global_d) : Number(transient.global_d) || Math.floor(Math.random() * 99999) + 1,
    sampler: transient.global_sampler,
    strength: Number(transient.global_strength),
    scheduler: transient.global_scheduler,
    skip: false,
  }
}

function applyAll() {
  for (const p of store.prompts) Object.assign(p, { ...newPrompt(), text: p.text, skip: p.skip })
  message.value = '已应用到所有提示词'
}

function move(i: number, delta: number) {
  const target = i + delta
  if (target < 0 || target >= store.prompts.length) return
  const [item] = store.prompts.splice(i, 1)
  store.prompts.splice(target, 0, item)
}

async function generate() {
  if (!store.name) return
  const name = store.name
  busy.value = true
  message.value = ''
  try {
    if (!store.prompts.some(p => p.text?.trim())) throw Error('请先添加非空提示词')
    persist()
    await store.save()
    if (store.name !== name) return
    const payload: any = { gen_gpu_ids: transient.gen_gpu_ids.join(',') }
    if (transient.selected_lora) {
      payload.network_weights = transient.selected_lora
      payload.network_mul = Number(transient.lora_mul)
    }
    if (krea.value) Object.assign(payload, { krea2_base: generation.base, krea2_steps: Number(generation.steps), krea2_cfg: Number(generation.cfg) })
    else if (moss.value) Object.assign(payload, { moss_flow_shift: mossFlow.value })
    else Object.assign(payload, {
      flow_shift: Number(store.config.anima_arguments?.discrete_flow_shift ?? 3),
      flash_attn: transient.flash_attn,
      sage_attn: transient.sage_attn,
      keep_loaded: transient.keep_loaded,
      gen_multi_gpu_mode: transient.gen_multi_gpu_mode,
    })
    const result = await api(jobUrl(name, '/generate'), { method: 'POST', body: payload })
    if (result.error) throw Error(result.error)
    if (store.name === name) {
      store.running = true
      message.value = '已启动独立采样'
      try {
        await store.refreshStatus()
      } catch (e: any) {
        throw Error(`采样已启动，但状态刷新失败：${e.message}`)
      }
      store.runtimeTick++
    }
  } catch (e: any) {
    if (store.name === name) message.value = e.message
  } finally {
    busy.value = false
  }
}

async function unload() {
  if (!store.name) return
  try {
    const r = await api(jobUrl(store.name, '/unload'), { method: 'POST' })
    message.value = r.error || r.message || '模型已卸载'
  } catch (e: any) {
    message.value = e.message
  }
}

// ===== Derived Display Helpers (read-only, never mutate store.config) =====
const activePromptCount = computed(() => store.prompts.filter(p => (isolated.value || !p.skip) && p.text?.trim()).length)
const skippedPromptCount = computed(() => (isolated.value ? 0 : store.prompts.filter(p => p.skip).length))

const cadence = computed(() => {
  const isSteps = samplingSteps.value
  const total = isSteps
    ? Math.max(1, Number(training.value.max_train_steps) || 1000)
    : Math.max(1, Number(training.value.max_train_epochs) || 20)
  const every = Math.max(1, Number(isSteps ? training.value.sample_every_n_steps : training.value.sample_every_n_epochs) || (isSteps ? 100 : 1))
  const active = samplingEnabled.value && !samplingUnsupported.value
  const points = active ? Math.floor(total / every) : 0
  const tickCount = 24
  const ticks = Array.from({ length: tickCount }, (_, idx) => {
    const pos = Math.round(((idx + 1) / tickCount) * total)
    const prevPos = Math.round((idx / tickCount) * total)
    const hasSample = active && Math.floor(pos / every) > Math.floor(prevPos / every)
    return { idx, hasSample }
  })
  return {
    isSteps,
    total,
    every,
    active,
    points,
    images: points * activePromptCount.value,
    ticks,
    unitLabel: isSteps ? 'steps' : 'epochs',
    rangeText: isSteps ? `Step 0 → ${total}` : `Epoch 1 → ${total}`,
  }
})

const flowShiftDisplay = computed(() => Number(store.config.anima_arguments?.discrete_flow_shift ?? 3))
const selectedCheckpointLabel = computed(() => {
  if (!transient.selected_lora) return 'Base Model'
  const match = checkpoints.value.find(c => c.path === transient.selected_lora)
  return match ? match.name : transient.selected_lora.split(/[\\/]/).pop() || transient.selected_lora
})

const negativeTagCount = computed(() =>
  String(store.negativePrompt || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean).length,
)

function gcd(a: number, b: number) {
  let x = Math.abs(Math.round(a)) || 1
  let y = Math.abs(Math.round(b)) || 1
  while (y) {
    const t = y
    y = x % y
    x = t
  }
  return x
}

function formatAspect(w: number, h: number) {
  const cw = Math.max(64, Number(w) || 832)
  const ch = Math.max(64, Number(h) || 1216)
  const ratio = cw / ch
  const mp = ((cw * ch) / 1e6).toFixed(2)
  const orient = ratio < 0.94 ? '竖图' : ratio > 1.06 ? '横图' : '方图'
  let rText: string
  if (Math.abs(ratio - 1) < 0.04) rText = '1:1'
  else if (Math.abs(ratio - 2 / 3) < 0.05) rText = '2:3'
  else if (Math.abs(ratio - 3 / 2) < 0.05) rText = '3:2'
  else if (Math.abs(ratio - 3 / 4) < 0.04) rText = '3:4'
  else if (Math.abs(ratio - 4 / 3) < 0.04) rText = '4:3'
  else if (Math.abs(ratio - 9 / 16) < 0.04) rText = '9:16'
  else if (Math.abs(ratio - 16 / 9) < 0.05) rText = '16:9'
  else {
    const g = gcd(cw, ch)
    const rw = Math.round(cw / g)
    const rh = Math.round(ch / g)
    rText = rw <= 24 && rh <= 24 ? `${rw}:${rh}` : `${ratio.toFixed(2)}:1`
  }
  return { cw, ch, mp, orient, rText }
}

const tplAspect = computed(() => formatAspect(transient.global_w, transient.global_h))

const aspectPresets = [
  { w: 832, h: 1216, label: '832×1216 竖图' },
  { w: 1024, h: 1024, label: '1024×1024 方图' },
  { w: 1216, h: 832, label: '1216×832 横图' },
]

function applyAspectPreset(w: number, h: number) {
  transient.global_w = w
  transient.global_h = h
}

function aspectBox(w: number, h: number) {
  const cw = Math.max(64, Number(w) || 832)
  const ch = Math.max(64, Number(h) || 1216)
  const maxBox = 16
  let rw: number
  let rh: number
  if (cw >= ch) {
    rw = maxBox
    rh = Math.max(6, Math.round((ch / cw) * maxBox))
  } else {
    rh = maxBox
    rw = Math.max(6, Math.round((cw / ch) * maxBox))
  }
  return {
    x: ((20 - rw) / 2).toFixed(1),
    y: ((20 - rh) / 2).toFixed(1),
    rw: rw.toFixed(1),
    rh: rh.toFixed(1),
  }
}

function promptMeta(text: string) {
  const raw = String(text || '')
  const tags = raw.split(',').map(s => s.trim()).filter(Boolean).length
  return `${tags} tags · ${raw.length} chars`
}

function cliPreview(p: any) {
  return serializePrompt(p, store.architecture, '')
}
</script>

<template>
  <section class="pt-wrap">
    <!-- 1. HERO: Dual-Track Sampling Control Strip (38fr / 62fr) -->
    <div class="pt-hero-grid" aria-label="采样控制区">
      <!-- Left Column: In-Training Sampling -->
      <div class="pt-hero-col">
        <div class="pt-sec-head">
          <div class="pt-sec-title">
            <h2>训练中采样</h2>
          </div>
          <span class="pt-mode-pill">{{ cadence.isSteps ? 'Steps 模式' : 'Epochs 模式' }} · {{ cadence.total }} {{ cadence.unitLabel }}</span>
        </div>

        <div v-if="samplingUnsupported" class="pt-warn-banner">
          <strong>TP/SP 多 GPU 训练不支持训练中采样。</strong>
          当前多卡并行模式为 <code>tp_sp</code>，训练期间定时采样已自动禁用；请使用右侧「独立采样」加载权重出图。
        </div>

        <div class="pt-train-controls">
          <label class="pt-check-item" :class="{ 'is-disabled': samplingLocked }">
            <input type="checkbox" :checked="samplingEnabled && !samplingUnsupported" :disabled="samplingLocked" @change="toggleSampling" />
            <span>启用训练中采样</span>
          </label>

          <div v-if="samplingEnabled && !samplingUnsupported" class="pt-every-field">
            <Field
              :object="training"
              :field="samplingSteps ? 'sample_every_n_steps' : 'sample_every_n_epochs'"
              :label="samplingSteps ? '每 N steps 采样' : '每 N epochs 采样'"
              type="number"
              :min="1"
              :step="1"
              :fallback="samplingSteps ? 100 : 1"
              :disabled="samplingLocked"
            />
          </div>
        </div>

        <!-- Live Sampling Cadence Strip (Tufte micro-timeline) -->
        <div class="pt-cadence-box" :class="{ 'is-off': !cadence.active }">
          <div class="pt-cadence-head">
            <span class="pt-cadence-label">采样节奏预览</span>
            <span class="pt-cadence-range">{{ cadence.rangeText }}</span>
          </div>
          <div class="pt-cadence-track" aria-hidden="true">
            <span v-for="t in cadence.ticks" :key="t.idx" class="pt-cadence-tick" :class="{ 'is-sample': t.hasSample }" />
          </div>
          <div v-if="cadence.active" class="pt-cadence-summary">
            共 <span class="mono">{{ cadence.points }}</span> 个采样点 × <span class="mono">{{ activePromptCount }}</span> 条启用提示词 = 预计生成
            <span class="mono">{{ cadence.images }}</span> 张样例图
          </div>
          <div v-else class="pt-cadence-summary muted">
            {{ samplingUnsupported ? 'TP/SP 多卡模式下训练中采样不可用' : '训练中采样未启用' }}
          </div>
        </div>
      </div>

      <!-- Right Column: Standalone Generation -->
      <div class="pt-hero-col">
        <div class="pt-sec-head">
          <div class="pt-sec-title">
            <h2>独立采样</h2>
            <span class="pt-sec-meta">{{ transient.gen_gpu_ids.length }} 张 GPU · {{ selectedCheckpointLabel }}</span>
          </div>
          <span v-if="!isolated" class="pt-sec-meta">Flow Shift {{ flowShiftDisplay }}</span>
        </div>

        <div class="pt-ckpt-row">
          <select v-model="transient.selected_lora" class="pt-select" aria-label="选择推理权重">
            <option value="">Base Model（无适配器）</option>
            <option v-for="file in checkpoints" :key="file.path" :value="file.path">
              {{ file.name }} · {{ new Date(file.mtime).toLocaleString() }}
            </option>
          </select>
          <button type="button" class="pt-btn" @click="refresh">刷新权重</button>
        </div>

        <div class="pt-gen-params-row">
          <div class="pt-lora-mul-field">
            <Field :object="transient" field="lora_mul" label="适配器强度" type="number" :step="0.1" />
          </div>

          <template v-if="krea">
            <div class="pt-krea-fields">
              <Field :object="generation" field="base" label="采样底模" type="select" :options="['turbo', 'raw']" />
              <Field :object="generation" field="steps" label="独立采样步数" type="number" :min="1" :max="1000" />
              <Field :object="generation" field="cfg" label="独立采样 CFG" type="number" :min="1" :step="0.5" />
            </div>
          </template>

          <template v-else-if="!moss">
            <div class="pt-attn-toggles">
              <Field :object="transient" field="flash_attn" label="Flash Attention" type="boolean" @change="value => { if (value) transient.sage_attn = false }" />
              <Field :object="transient" field="sage_attn" label="Sage Attention" type="boolean" @change="value => { if (value) transient.flash_attn = false }" />
              <Field :object="transient" field="keep_loaded" label="保持模型加载" type="boolean" />
            </div>
          </template>

          <template v-else>
            <div class="pt-moss-flow">
              <Field :object="{ value: mossFlow }" field="value" label="MOSS Generation Flow Shift" type="number" :min="0.01" :step="0.1" @change="mossFlow = Number($event)" />
            </div>
          </template>
        </div>

        <p v-if="moss" class="pt-arch-note">独立出图使用当前任务 Base/SFT、卡片的宽高、步数、CFG、种子。种子 0 为固定种子；不保持模型常驻。</p>
        <p v-if="krea" class="pt-arch-note">RAW / Turbo 参数仅用于独立采样；提示词卡片中的步数和 CFG 用于 RAW 训练预览。</p>

        <div v-if="store.gpus.length" class="pt-gpu-chips" role="group" aria-label="独立采样 GPU 选择">
          <button
            v-for="g in store.gpus"
            :key="g.index"
            type="button"
            class="pt-gpu-chip"
            :aria-pressed="transient.gen_gpu_ids.includes(g.index)"
            @click="gpu(g.index)"
          >
            <span class="pt-gpu-dot" />
            <span>GPU {{ g.index }} · {{ g.name }}</span>
          </button>
        </div>

        <div v-if="!isolated && transient.gen_gpu_ids.length > 1" class="pt-mgpu-strip">
          <Field :object="transient" field="gen_multi_gpu_mode" label="多 GPU 模式" type="select" :options="['parallel_cfg', 'sharding']" />
          <span class="pt-mgpu-hint">parallel_cfg 并行正负条件加速 | sharding 分片显存</span>
        </div>

        <div class="pt-gen-actions">
          <button type="button" class="pt-btn primary" :disabled="busy || store.running" @click="generate">{{ busy ? '启动中…' : '保存并生成' }}</button>
          <button v-if="!isolated" type="button" class="pt-btn" :disabled="busy" @click="unload">卸载采样模型</button>
          <p v-if="message" role="status" class="pt-status-line">{{ message }}</p>
        </div>
      </div>
    </div>

    <!-- 2. Global Negative Prompt & Batch Parameter Template -->
    <div class="pt-global-sec" aria-label="全局负面词与参数模板">
      <div class="pt-neg-block">
        <div class="pt-neg-bar">
          <div class="pt-neg-left">
            <strong>负面提示词</strong>
            <span class="pt-count-pill">{{ negativeTagCount }} 个负面词</span>
            <span class="pt-sec-meta">--n 自动附加到每条提示词</span>
          </div>
          <div class="pt-neg-actions">
            <button type="button" class="pt-btn sm" @click="store.negativePrompt = defaultNegativePrompt">恢复默认</button>
            <button type="button" class="pt-btn sm" :aria-expanded="negExpanded" @click="negExpanded = !negExpanded">
              {{ negExpanded ? '收起预览' : '展开编辑' }}
            </button>
          </div>
        </div>

        <div v-if="!negExpanded" class="pt-neg-preview" title="点击展开编辑负面提示词" @click="negExpanded = true">
          <div class="pt-neg-preview-text">{{ store.negativePrompt || '（空）点击展开编辑负面提示词' }}</div>
        </div>
        <div v-else class="pt-neg-editor-wrap">
          <textarea v-model="store.negativePrompt" rows="4" class="pt-textarea" placeholder="输入全局负面提示词（英文逗号分隔）" />
        </div>
      </div>

      <div class="pt-tpl-box">
        <div class="pt-tpl-head">
          <div class="pt-tpl-title-group">
            <h3>全局默认参数模板</h3>
            <span class="pt-aspect-readout">{{ tplAspect.cw }} × {{ tplAspect.ch }} · {{ tplAspect.rText }} {{ tplAspect.orient }} · {{ tplAspect.mp }} MP</span>
          </div>
          <div class="pt-tpl-right">
            <button
              v-for="preset in aspectPresets"
              :key="preset.label"
              type="button"
              class="pt-chip"
              :class="{ active: Number(transient.global_w) === preset.w && Number(transient.global_h) === preset.h }"
              @click="applyAspectPreset(preset.w, preset.h)"
            >
              {{ preset.label }}
            </button>
            <button type="button" class="pt-btn soft-primary sm" @click="applyAll">应用到所有卡片</button>
          </div>
        </div>

        <div :class="isolated ? 'pt-param-grid-5' : 'pt-param-grid-8'">
          <Field
            v-for="[key, label] in [['global_w', '宽度'], ['global_h', '高度'], ['global_s', '步数'], ['global_l', 'CFG'], ['global_d', '种子（0随机）']]"
            :key="key"
            :object="transient"
            :field="key!"
            :label="key === 'global_d' && moss ? '种子（0固定）' : label!"
            type="number"
          />
          <template v-if="!isolated">
            <Field :object="transient" field="global_sampler" label="Sampler" type="select" :options="samplers" />
            <Field :object="transient" field="global_strength" label="强度" type="number" :min="0" :max="2" :step="0.05" />
            <Field :object="transient" field="global_scheduler" label="Scheduler" type="select" :options="schedulers" />
          </template>
        </div>
      </div>
    </div>

    <!-- 3. Prompt Cards Workbench -->
    <div aria-label="训练采样提示词列表">
      <div class="pt-list-header">
        <div class="pt-list-title">
          <h2>训练采样提示词</h2>
          <span class="pt-list-counters">
            共 <strong>{{ store.prompts.length }}</strong> 条 · <strong>{{ activePromptCount }}</strong> 启用
            <template v-if="!isolated && skippedPromptCount"> · {{ skippedPromptCount }} 已跳过</template>
          </span>
        </div>
        <button type="button" class="pt-btn soft-primary" @click="store.prompts.push(newPrompt())">添加提示词</button>
      </div>

      <p v-if="!store.prompts.length" class="pt-empty-state">暂无提示词。</p>

      <div v-else class="pt-cards-stack">
        <article v-for="(p, i) in store.prompts" :key="i" class="pt-card" :class="{ 'is-skipped': !isolated && p.skip }">
          <div class="pt-card-head">
            <div class="pt-card-ident">
              <span class="pt-card-idx">#{{ i + 1 }}</span>
              <span class="pt-aspect-mini">
                <svg class="pt-aspect-svg" viewBox="0 0 20 20" aria-hidden="true">
                  <rect
                    :x="aspectBox(p.w, p.h).x"
                    :y="aspectBox(p.w, p.h).y"
                    :width="aspectBox(p.w, p.h).rw"
                    :height="aspectBox(p.w, p.h).rh"
                    rx="1.5"
                    class="pt-aspect-rect"
                  />
                </svg>
                <span class="pt-aspect-dim">{{ p.w }}×{{ p.h }}</span>
                <span class="pt-aspect-ratio-tag">{{ formatAspect(p.w, p.h).rText }}</span>
              </span>
              <span v-if="!isolated && p.skip" class="pt-skip-pill">已跳过</span>
            </div>

            <div class="pt-card-controls">
              <label v-if="!isolated" class="pt-check-item pt-card-skip">
                <input v-model="p.skip" type="checkbox" />
                <span>跳过</span>
              </label>
              <button type="button" class="pt-btn sm" :disabled="i === 0" @click="move(i, -1)">上移</button>
              <button type="button" class="pt-btn sm" :disabled="i === store.prompts.length - 1" @click="move(i, 1)">下移</button>
              <button type="button" class="pt-btn sm danger" @click="store.prompts.splice(i, 1)">删除</button>
            </div>
          </div>

          <div class="pt-card-body">
            <div class="pt-prompt-meta">
              <span>提示词内容</span>
              <span class="mono">{{ promptMeta(p.text) }}</span>
            </div>
            <textarea v-model="p.text" rows="3" placeholder="提示词" class="pt-textarea" />
            <div :class="isolated ? 'pt-param-grid-5' : 'pt-param-grid-8'">
              <Field
                v-for="[key, label] in [['w', '宽度'], ['h', '高度'], ['s', '步数'], ['l', 'CFG'], ['d', '种子']]"
                :key="key"
                :object="p"
                :field="key!"
                :label="label!"
                type="number"
              />
              <template v-if="!isolated">
                <Field :object="p" field="sampler" label="Sampler" type="select" :options="samplers" />
                <Field :object="p" field="strength" label="强度" type="number" :min="0" :max="2" :step="0.05" />
                <Field :object="p" field="scheduler" label="Scheduler" type="select" :options="schedulers" />
              </template>
            </div>
          </div>

          <div class="pt-card-footer">
            <span class="pt-cli-line">{{ cliPreview(p) }}</span>
            <span class="pt-cli-tag">prompts.txt</span>
          </div>
        </article>
      </div>
    </div>
  </section>
</template>

<style scoped>
.pt-wrap {
  --pt-mono: 'Cascadia Mono', Consolas, 'JetBrains Mono', ui-monospace, monospace;
  --pt-hairline: color-mix(in srgb, var(--border) 82%, transparent);
  --pt-hairline-soft: color-mix(in srgb, var(--border) 48%, transparent);
  --pt-surface: color-mix(in srgb, var(--foreground) 2.5%, transparent);
  --pt-surface-strong: color-mix(in srgb, var(--foreground) 4.5%, transparent);
  --pt-ok: #26895a;
  --pt-warn: #b87114;
  width: 100%;
  min-width: 0;
  color: var(--foreground);
}

:global(.dark) .pt-wrap {
  --pt-ok: #5ace9d;
  --pt-warn: #f0b254;
}

.mono {
  font-family: var(--pt-mono);
  font-variant-numeric: tabular-nums;
}

.muted {
  color: var(--muted-foreground);
}

/* Shared headers & controls */
.pt-sec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  padding-bottom: 8px;
  margin-bottom: 10px;
  border-bottom: 1px solid var(--pt-hairline);
}

.pt-sec-title {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  flex-wrap: wrap;
}

.pt-sec-title h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 650;
  color: var(--foreground);
}

.pt-sec-meta {
  font-family: var(--pt-mono);
  font-size: 12px;
  color: var(--muted-foreground);
}

.pt-select,
.pt-textarea {
  width: 100%;
  border: 1px solid var(--pt-hairline);
  border-radius: 4px;
  background: color-mix(in srgb, var(--card) 78%, transparent);
  color: var(--foreground);
  font-size: 13.5px;
  transition: border-color 0.15s, background 0.15s;
}

.pt-select {
  height: 30px;
  padding: 0 8px;
  font-family: var(--pt-mono);
  font-size: 13px;
}

.pt-textarea {
  padding: 7px 10px;
  line-height: 1.5;
  resize: vertical;
}

.pt-select:focus,
.pt-textarea:focus {
  outline: none;
  border-color: var(--primary);
  background: color-mix(in srgb, var(--primary) 6%, var(--card));
}

.pt-check-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13.5px;
  color: var(--foreground);
  white-space: nowrap;
  cursor: pointer;
}

.pt-check-item input[type='checkbox'] {
  width: 15px;
  height: 15px;
  accent-color: var(--primary);
  margin: 0;
  cursor: pointer;
}

.pt-check-item.is-disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.pt-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border: 1px solid var(--pt-hairline);
  border-radius: 5px;
  font-size: 13px;
  font-weight: 500;
  background: color-mix(in srgb, var(--card) 85%, transparent);
  color: var(--foreground);
  white-space: nowrap;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}

.pt-btn:hover:not(:disabled) {
  border-color: var(--primary);
  color: var(--primary);
}

.pt-btn.primary {
  background: var(--primary);
  border-color: var(--primary);
  color: var(--primary-foreground);
  font-weight: 600;
}

.pt-btn.primary:hover:not(:disabled) {
  filter: brightness(1.08);
  color: var(--primary-foreground);
}

.pt-btn.soft-primary {
  background: color-mix(in srgb, var(--primary) 14%, var(--card));
  border-color: color-mix(in srgb, var(--primary) 55%, var(--border));
  color: var(--primary);
  font-weight: 600;
}

.pt-btn.soft-primary:hover:not(:disabled) {
  background: var(--primary);
  color: var(--primary-foreground);
}

.pt-btn.danger:hover:not(:disabled) {
  border-color: var(--destructive);
  color: var(--destructive);
}

.pt-btn.sm {
  height: 26px;
  padding: 0 9px;
  font-size: 12px;
}

.pt-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border: 1px solid var(--pt-hairline);
  border-radius: 4px;
  font-family: var(--pt-mono);
  font-size: 12px;
  color: var(--muted-foreground);
  background: transparent;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}

.pt-chip:hover:not(:disabled) {
  border-color: var(--primary);
  color: var(--primary);
}

.pt-chip.active {
  border-color: var(--primary);
  color: var(--primary);
  background: color-mix(in srgb, var(--primary) 12%, transparent);
  font-weight: 600;
}

/* Harmonize ConfigField inside workbench */
.pt-wrap :deep(label) {
  font-size: 12px;
  color: var(--muted-foreground);
}

.pt-wrap :deep(input[type='number']),
.pt-wrap :deep(input[type='text']),
.pt-wrap :deep(select) {
  height: 30px;
  padding: 0 8px;
  border: 1px solid var(--pt-hairline);
  border-radius: 4px;
  background: color-mix(in srgb, var(--card) 75%, transparent);
  font-family: var(--pt-mono);
  font-variant-numeric: tabular-nums;
  font-size: 13px;
}

/* 1. HERO: Dual-Track Sampling Control Strip */
.pt-hero-grid {
  display: grid;
  grid-template-columns: 38fr 62fr;
  border-bottom: 1px solid var(--pt-hairline);
  padding-bottom: 16px;
  margin-bottom: 16px;
}

.pt-hero-col {
  min-width: 0;
  padding-right: 22px;
  border-right: 1px solid var(--pt-hairline-soft);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.pt-hero-col:last-child {
  padding-right: 0;
  padding-left: 22px;
  border-right: 0;
}

.pt-mode-pill {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--pt-hairline);
  border-radius: 4px;
  background: var(--pt-surface);
  font-family: var(--pt-mono);
  font-size: 12px;
  color: var(--muted-foreground);
}

.pt-warn-banner {
  padding: 8px 11px;
  border: 1px solid color-mix(in srgb, var(--pt-warn) 45%, var(--border));
  border-left: 3px solid var(--pt-warn);
  border-radius: 4px;
  background: color-mix(in srgb, var(--pt-warn) 10%, var(--card));
  font-size: 13px;
  line-height: 1.45;
}

.pt-warn-banner strong {
  color: var(--pt-warn);
  font-weight: 650;
}

.pt-train-controls {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
}

.pt-every-field {
  min-width: 150px;
  max-width: 200px;
}

/* Tufte Micro-Timeline: Live Sampling Cadence Strip */
.pt-cadence-box {
  margin-top: auto;
  padding: 10px 12px;
  border: 1px solid var(--pt-hairline-soft);
  border-radius: 4px;
  background: var(--pt-surface);
}

.pt-cadence-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.pt-cadence-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--muted-foreground);
}

.pt-cadence-range {
  font-family: var(--pt-mono);
  font-size: 12px;
  color: var(--muted-foreground);
}

.pt-cadence-track {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  height: 22px;
  padding: 0 2px;
  border-bottom: 1px solid var(--pt-hairline);
  margin-bottom: 8px;
}

.pt-cadence-tick {
  width: 3px;
  height: 6px;
  border-radius: 1.5px 1.5px 0 0;
  background: color-mix(in srgb, var(--border) 80%, transparent);
  transition: height 0.18s ease, background 0.18s ease;
}

.pt-cadence-tick.is-sample {
  height: 18px;
  background: var(--primary);
}

.pt-cadence-box.is-off .pt-cadence-tick.is-sample {
  height: 6px;
  background: color-mix(in srgb, var(--border) 65%, transparent);
}

.pt-cadence-summary {
  font-size: 13px;
  line-height: 1.45;
}

.pt-cadence-summary .mono {
  font-weight: 650;
  color: var(--primary);
}

/* Right Column: Standalone Generation */
.pt-ckpt-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pt-ckpt-row .pt-select {
  flex: 1;
  min-width: 0;
}

.pt-gen-params-row {
  display: flex;
  align-items: flex-end;
  gap: 14px 20px;
  flex-wrap: wrap;
  padding: 4px 0 10px;
  border-bottom: 1px solid var(--pt-hairline-soft);
}

.pt-lora-mul-field {
  width: 130px;
  flex-shrink: 0;
}

.pt-krea-fields {
  display: grid;
  grid-template-columns: repeat(3, minmax(110px, 1fr));
  gap: 10px;
  flex: 1;
  min-width: 260px;
}

.pt-attn-toggles {
  display: flex;
  align-items: center;
  gap: 10px 16px;
  flex-wrap: wrap;
  padding-left: 16px;
  border-left: 1px solid var(--pt-hairline-soft);
}

.pt-moss-flow {
  width: 200px;
}

.pt-arch-note {
  margin: 0;
  font-size: 12.5px;
  color: var(--muted-foreground);
}

.pt-gpu-chips {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.pt-gpu-chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 30px;
  padding: 0 11px;
  border: 1px solid var(--pt-hairline);
  border-radius: 5px;
  background: var(--pt-surface);
  font-size: 13px;
  color: var(--foreground);
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}

.pt-gpu-chip:hover {
  border-color: var(--primary);
}

.pt-gpu-chip[aria-pressed='true'] {
  background: color-mix(in srgb, var(--primary) 16%, var(--card));
  border-color: var(--primary);
  color: var(--primary);
  font-weight: 600;
}

.pt-gpu-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--muted-foreground);
  opacity: 0.5;
}

.pt-gpu-chip[aria-pressed='true'] .pt-gpu-dot {
  background: var(--pt-ok);
  opacity: 1;
}

.pt-mgpu-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px 14px;
  flex-wrap: wrap;
  padding: 7px 10px;
  border: 1px solid color-mix(in srgb, var(--primary) 35%, var(--border));
  border-radius: 4px;
  background: color-mix(in srgb, var(--primary) 6%, var(--pt-surface));
}

.pt-mgpu-hint {
  font-size: 12px;
  color: var(--muted-foreground);
}

.pt-gen-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: auto;
  padding-top: 4px;
}

.pt-status-line {
  margin: 0 0 0 auto;
  font-size: 13px;
  color: var(--pt-ok);
  font-weight: 500;
}

/* 2. Global Negative Prompt & Batch Parameter Template */
.pt-global-sec {
  padding-bottom: 16px;
  border-bottom: 1px solid var(--pt-hairline);
  margin-bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.pt-neg-block {
  border: 1px solid var(--pt-hairline);
  border-radius: 4px;
  background: var(--pt-surface);
  overflow: hidden;
}

.pt-neg-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  padding: 6px 12px;
  border-bottom: 1px solid var(--pt-hairline-soft);
  background: var(--pt-surface-strong);
}

.pt-neg-left {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-wrap: wrap;
}

.pt-neg-left strong {
  font-size: 13px;
  font-weight: 650;
}

.pt-count-pill {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border-radius: 3px;
  border: 1px solid var(--pt-hairline);
  background: var(--card);
  font-family: var(--pt-mono);
  font-size: 12px;
  color: var(--muted-foreground);
}

.pt-neg-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.pt-neg-preview {
  padding: 7px 12px;
  cursor: pointer;
}

.pt-neg-preview-text {
  font-family: var(--pt-mono);
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--muted-foreground);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.pt-neg-preview:hover .pt-neg-preview-text {
  color: var(--foreground);
}

.pt-neg-editor-wrap {
  padding: 10px 12px;
}

.pt-neg-editor-wrap .pt-textarea {
  font-family: var(--pt-mono);
  font-size: 13px;
}

.pt-tpl-box {
  padding: 10px 14px 12px;
  border: 1px solid var(--pt-hairline);
  border-radius: 4px;
  background: color-mix(in srgb, var(--card) 50%, transparent);
}

.pt-tpl-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px 14px;
  flex-wrap: wrap;
  padding-bottom: 8px;
  margin-bottom: 9px;
  border-bottom: 1px solid var(--pt-hairline-soft);
}

.pt-tpl-title-group {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.pt-tpl-title-group h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 650;
}

.pt-aspect-readout {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--primary) 11%, var(--card));
  border: 1px solid color-mix(in srgb, var(--primary) 40%, var(--border));
  font-family: var(--pt-mono);
  font-size: 12px;
}

.pt-tpl-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.pt-param-grid-8 {
  display: grid;
  grid-template-columns: 0.88fr 0.88fr 0.72fr 0.76fr 1.12fr 1.02fr 0.84fr 1.24fr;
  gap: 10px;
}

.pt-param-grid-5 {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 10px;
}

/* 3. Prompt Cards Workbench */
.pt-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding-bottom: 10px;
  border-bottom: 2px solid var(--pt-hairline);
  margin-bottom: 14px;
}

.pt-list-title {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}

.pt-list-title h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 650;
}

.pt-list-counters {
  font-family: var(--pt-mono);
  font-size: 13px;
  color: var(--muted-foreground);
}

.pt-list-counters strong {
  color: var(--foreground);
  font-weight: 650;
}

.pt-empty-state {
  padding: 28px 16px;
  text-align: center;
  border: 1px dashed var(--pt-hairline);
  border-radius: 4px;
  color: var(--muted-foreground);
  font-size: 14px;
}

.pt-cards-stack {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 14px;
}

.pt-card {
  border: 1px solid var(--pt-hairline);
  border-left: 3px solid var(--primary);
  border-radius: 4px;
  background: color-mix(in srgb, var(--card) 68%, transparent);
  transition: opacity 0.18s, border-color 0.18s;
}

.pt-card.is-skipped {
  opacity: 0.62;
  border-left-color: var(--muted-foreground);
  border-left-style: dashed;
}

.pt-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  padding: 7px 12px;
  border-bottom: 1px solid var(--pt-hairline-soft);
  background: var(--pt-surface);
}

.pt-card-ident {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.pt-card-idx {
  font-family: var(--pt-mono);
  font-size: 13px;
  font-weight: 700;
  color: var(--primary);
  min-width: 24px;
}

.pt-card.is-skipped .pt-card-idx {
  color: var(--muted-foreground);
}

.pt-aspect-mini {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 2px 8px 2px 5px;
  border: 1px solid var(--pt-hairline-soft);
  border-radius: 3px;
  background: var(--card);
}

.pt-aspect-svg {
  display: block;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}

.pt-aspect-rect {
  fill: color-mix(in srgb, var(--primary) 18%, transparent);
  stroke: var(--primary);
  stroke-width: 1.4;
}

.pt-card.is-skipped .pt-aspect-rect {
  fill: color-mix(in srgb, var(--muted-foreground) 14%, transparent);
  stroke: var(--muted-foreground);
}

.pt-aspect-dim {
  font-family: var(--pt-mono);
  font-size: 12px;
  color: var(--foreground);
}

.pt-aspect-ratio-tag {
  font-family: var(--pt-mono);
  font-size: 11.5px;
  color: var(--muted-foreground);
}

.pt-skip-pill {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border-radius: 3px;
  font-size: 12px;
  font-weight: 600;
  color: var(--pt-warn);
  background: color-mix(in srgb, var(--pt-warn) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--pt-warn) 42%, transparent);
}

.pt-card-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.pt-card-skip {
  font-size: 12.5px;
}

.pt-card-body {
  padding: 9px 12px 11px;
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.pt-prompt-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: var(--muted-foreground);
}

.pt-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 12px;
  border-top: 1px dashed var(--pt-hairline-soft);
  background: color-mix(in srgb, var(--background) 55%, var(--card));
  font-family: var(--pt-mono);
  font-size: 12px;
  color: var(--muted-foreground);
  overflow-x: auto;
}

.pt-cli-line {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pt-cli-tag {
  flex-shrink: 0;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 3px;
  border: 1px solid var(--pt-hairline-soft);
  background: var(--pt-surface);
  color: var(--muted-foreground);
}

@media (min-width: 1800px) {
  .pt-hero-col { padding-right: 28px; }
  .pt-hero-col:last-child { padding-left: 28px; }
  .pt-cards-stack {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
    align-items: start;
  }
  .pt-cards-stack > .pt-card:only-child {
    grid-column: 1 / -1;
  }
  .pt-cards-stack > .pt-card:not(:only-child) .pt-param-grid-8 {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

@media (min-width: 2300px) {
  .pt-cards-stack > .pt-card:not(:only-child) .pt-param-grid-8 {
    grid-template-columns: 0.88fr 0.88fr 0.72fr 0.76fr 1.12fr 1.02fr 0.84fr 1.24fr;
  }
}

@media (max-width: 1180px) {
  .pt-hero-grid {
    grid-template-columns: 1fr;
    gap: 18px;
  }
  .pt-hero-col {
    padding-right: 0;
    border-right: 0;
    border-bottom: 1px solid var(--pt-hairline-soft);
    padding-bottom: 16px;
  }
  .pt-hero-col:last-child {
    padding-left: 0;
    border-bottom: 0;
    padding-bottom: 0;
  }
  .pt-param-grid-8 {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .pt-param-grid-8,
  .pt-param-grid-5 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
