<script setup lang="ts">
import { computed } from 'vue'
import Field from '@/components/forms/ConfigField.vue'
import FieldHelp from '@/components/forms/FieldHelp.vue'
import { provideFieldHelp } from '@/components/forms/help-context'
import { useEditorStore } from '@/stores/editor'
import { AdapterMatrix, Krea2, LayerRank, Moss } from '@/domain/training'
import { argumentValue, replaceArgument, section } from '../training/rules'
import Arg from './NetworkArgument.vue'
import LayerRankEditor from './LayerRankEditor.vue'
import { adapterDrafts, resumeDrafts } from './drafts'

const store = useEditorStore()
provideFieldHelp('network')

const n = computed(() => section(store.config, 'network_arguments'))
const t = computed(() => section(store.config, 'training_arguments'))
const moss = computed(() => store.architecture === 'moss_image')
const krea = computed(() => store.architecture === 'krea2')
const isolated = computed(() => moss.value || krea.value)
const moduleName = computed(() => n.value.network_module || '')
const lokr = computed(() => moduleName.value.endsWith('.lokr'))
const lycoris = computed(() => !isolated.value && ['networks.loha', 'networks.lokr'].includes(moduleName.value))
const dora = computed(() => !isolated.value && ['networks.lora_anima', 'networks.lokr'].includes(moduleName.value))
const full = computed(() => lokr.value && enabledArg('full_matrix'))
function enabledArg(key: string) { return /^(true|1|yes|y|on)$/i.test((argumentValue(n.value.network_args, key) || '').trim()) }
const layered = computed(() => !isolated.value && ['networks.lora_anima', 'networks.loha', 'networks.lokr'].includes(moduleName.value))
const layerActive = computed(() => layered.value && argumentValue(n.value.network_args, 'layer_configs') !== undefined)
const rankDisabled = computed(() => full.value || layerActive.value)
const adapterKeys = ['network_module', 'network_dim', 'network_alpha', 'network_train_unet_only', 'network_dropout', 'network_args', 'network_weights']

const trainingType = computed({
  get: () => (moduleName.value ? 'lora' : 'full_finetune'),
  set: value => {
    if (value === 'full_finetune') {
      adapterDrafts.set(n.value, Object.fromEntries(adapterKeys.filter(key => Object.hasOwn(n.value, key)).map(key => [key, n.value[key]])))
      for (const key of adapterKeys) delete n.value[key]
      t.value.freeze_llm_adapter ??= true
    } else {
      Object.assign(n.value, adapterDrafts.get(n.value) || { network_module: 'networks.lora_anima', network_dim: 16, network_alpha: 16, network_train_unet_only: true })
      delete t.value.freeze_llm_adapter
      delete t.value.use_muon
    }
  },
})

function autoResume(value: boolean) {
  if (value) {
    if (n.value.resume) resumeDrafts.set(n.value, n.value.resume)
    delete n.value.resume
  } else if (resumeDrafts.has(n.value)) {
    n.value.resume = resumeDrafts.get(n.value)
  }
}

const selectedModule = computed({
  get: () => moduleName.value,
  set: value => {
    n.value.network_module = value
    if (isolated.value) {
      const incompatible = value.endsWith('.lokr') ? ['loraplus_lr_ratio'] : value === 'networks.loha' ? ['factor', 'full_matrix', 'loraplus_lr_ratio'] : ['factor', 'full_matrix']
      for (const key of incompatible) n.value.network_args = replaceArgument(n.value.network_args, key, undefined)
    }
    if (!['networks.lora_anima', 'networks.lokr'].includes(value) && !krea.value) {
      for (const key of ['use_dora', 'dora_scale_fp32']) n.value.network_args = replaceArgument(n.value.network_args, key, undefined)
    }
  },
})

const dedicated = computed(() => [
  ...(lokr.value ? ['factor', 'full_matrix'] : []),
  ...(lycoris.value || isolated.value ? ['rank_dropout', 'module_dropout'] : []),
  ...(lycoris.value ? ['mod_dim', 'use_tucker'] : []),
  ...(dora.value ? ['use_dora', 'dora_scale_fp32'] : []),
  ...(krea.value && !lokr.value || moss.value && moduleName.value === Moss.MODULES[0] ? ['loraplus_lr_ratio'] : []),
  ...(layered.value ? ['layer_configs'] : []),
])

const freeArgs = computed({
  get: () => (n.value.network_args || []).filter((token: string) => !dedicated.value.includes(token.split('=')[0].trim())).join(' '),
  set: value => {
    const tokens = LayerRank.tokenize(value)
    // Dedicated controls remain authoritative, as in the legacy form.
    const preserved = (n.value.network_args || []).filter((token: string) => dedicated.value.includes(token.split('=')[0].trim()))
    n.value.network_args = [...preserved, ...tokens.filter((token: string) => !dedicated.value.includes(token.split('=')[0].trim()))]
  },
})

const modules = computed(() => moss.value ? Moss.MODULES : krea.value ? [Krea2.MODULE, Krea2.LOKR_MODULE] : ['networks.lora_anima', 'networks.loha', 'networks.lokr', 'networks.lora_lumina', 'networks.lora'])

const preview = computed(() => {
  try {
    return { rows: AdapterMatrix.preview({ architecture: store.architecture, networkModule: moduleName.value, rank: Number(n.value.network_dim ?? 16), args: n.value.network_args || [] }), error: '' }
  } catch (err) {
    return { rows: [], error: (err as Error).message }
  }
})
const previewSupported = computed(() => (krea.value ? modules.value.includes(moduleName.value) : store.architecture === 'anima' && layered.value))

const doraOn = computed(() => dora.value && enabledArg('use_dora'))
const moduleKind = computed(() => (moduleName.value.endsWith('.lokr') ? 'lokr' : moduleName.value.endsWith('.loha') ? 'loha' : 'lora'))
const rankNum = computed(() => Number(n.value.network_dim ?? 16))
const alphaNum = computed(() => Number(n.value.network_alpha ?? 16))
const alphaScaleText = computed(() => full.value ? 'Full Matrix 缩放 ×1.00' : `Alpha/Rank = ${(alphaNum.value / (rankNum.value || 1)).toFixed(2)}×`)
const factorLabel = computed(() => argumentValue(n.value.network_args, 'factor') ?? '-1')
const layerModeLabel = computed(() => {
  const raw = argumentValue(n.value.network_args, 'layer_configs')
  if (!raw) return '按层类型'
  try { return JSON.parse(raw)?.mode === 'layer' ? '按单个层' : '按层类型' }
  catch { return '按层类型' }
})
const hasModuleOptions = computed(() => lokr.value || dora.value || lycoris.value || isolated.value)
const archLabel = computed(() => krea.value ? 'Krea 2' : moss.value ? 'MOSS-Image' : 'Anima DiT')
const totalArgsCount = computed(() => (n.value.network_args || []).length)
const freeArgsCount = computed(() => (n.value.network_args || []).filter((token: string) => !dedicated.value.includes(token.split('=')[0].trim())).length)

const previewStats = computed(() => {
  const rows = preview.value.rows
  const totalCount = rows.reduce((sum: number, r: any) => sum + r.count, 0)
  const totalBase = rows.reduce((sum: number, r: any) => sum + r.base, 0)
  const totalPct = totalBase ? (totalCount / totalBase) * 100 : 0
  const maxPct = Math.max(0.0001, ...rows.map((r: any) => r.percent))
  return { totalCount, totalPct, maxPct }
})

const formulaKindLabel = computed(() => {
  if (moduleKind.value === 'lora') return doraOn.value ? 'DoRA 低秩方向 + 幅度分解' : '标准低秩矩阵分解'
  if (moduleKind.value === 'loha') return 'Hadamard 乘积双低秩分解'
  if (full.value) return doraOn.value ? 'DoKr 完整 Kronecker 因子 + 幅度分解' : 'Kronecker 完整因子分解'
  return doraOn.value ? 'DoKr Kronecker 低秩 + 幅度分解' : 'Kronecker 低秩分解'
})

const typeLabels: Record<string, string> = { self_attn: 'Self Attn', cross_attn: 'Cross Attn', mlp: 'MLP' }
function typeTag(name: string) {
  const key = LayerRank.typeOf(name)
  return key ? (typeLabels[key] || '') : ''
}
function rowBarWidth(row: any) {
  if (!row.count) return 0
  return Math.max(4, Math.min(100, (row.percent / previewStats.value.maxPct) * 100))
}
function setRankPreset(value: number) {
  if (rankDisabled.value || store.locked) return
  n.value.network_dim = value
}
function setAlphaRatio(ratio: number) {
  if (store.locked) return
  n.value.network_alpha = Number((rankNum.value * ratio).toFixed(4))
}
</script>

<template>
  <section class="nt-wrap" aria-label="网络配置">
    <!-- Top Header -->
    <div class="nt-top-bar">
      <div class="nt-title-block">
        <h2>网络</h2>
        <p>配置适配器架构、低秩矩阵分解、分层容量分配与断点续训。</p>
      </div>
      <span class="nt-sec-meta">{{ archLabel }}</span>
    </div>

    <!-- Live Recipe Summary Strip -->
    <div class="nt-recipe-strip" aria-live="polite">
      <template v-if="trainingType === 'lora'">
        <div class="nt-recipe-items">
          <span class="nt-recipe-chip">Adapter</span>
          <span class="nt-recipe-sep">·</span>
          <span class="nt-recipe-key">{{ moduleName }}</span>
          <span class="nt-recipe-sep">·</span>
          <span class="mono">
            <template v-if="full">Full Matrix (Factor {{ factorLabel }}) · 缩放 ×1.00</template>
            <template v-else>Rank {{ rankNum }} / Alpha {{ alphaNum }} ({{ alphaScaleText }})</template>
          </span>
          <template v-if="!isolated">
            <span class="nt-recipe-sep">·</span>
            <span>{{ (n.network_train_unet_only ?? true) ? '仅训练 DiT 主干' : 'DiT + 文本编码器' }}</span>
          </template>
          <template v-if="dora">
            <span class="nt-recipe-sep">·</span>
            <span class="nt-recipe-chip" :class="doraOn ? 'is-ok' : 'is-off'">{{ lokr ? 'DoKr' : 'DoRA' }} {{ doraOn ? '开' : '关' }}</span>
          </template>
          <template v-if="layered">
            <span class="nt-recipe-sep">·</span>
            <span class="nt-recipe-chip" :class="layerActive ? 'is-ok' : 'is-off'">
              {{ layerActive ? `分层覆盖 开 (${layerModeLabel})` : '分层覆盖 关' }}
            </span>
          </template>
        </div>
        <span class="nt-sec-meta">实时配方</span>
      </template>
      <template v-else>
        <div class="nt-recipe-items">
          <span class="nt-recipe-chip is-warn">Full Finetune</span>
          <span class="nt-recipe-sep">·</span>
          <span class="nt-recipe-key">完整底模微调</span>
          <span class="nt-recipe-sep">·</span>
          <span class="nt-recipe-chip" :class="(t.freeze_llm_adapter ?? true) ? 'is-ok' : 'is-warn'">
            Freeze LLM Adapter {{ (t.freeze_llm_adapter ?? true) ? '开' : '关' }}
          </span>
          <span class="nt-recipe-sep">·</span>
          <span class="nt-recipe-chip" :class="n.auto_resume_last_state ? 'is-ok' : 'is-off'">
            自动恢复 {{ n.auto_resume_last_state ? '开' : '关' }}
          </span>
        </div>
        <span class="nt-sec-meta">高显存模式</span>
      </template>
    </div>

    <!-- Hero: Explorable Adapter Matrix Blueprint -->
    <section v-if="trainingType === 'lora' && previewSupported" class="nt-hero" aria-label="样例层矩阵分解与参数量图解">
      <div class="nt-hero-head">
        <div class="nt-hero-title">
          <h3>样例层矩阵分解与参数量图解</h3>
          <span class="nt-hero-sub">{{ krea ? 'Krea 2 主干宽度 6144' : '实时响应 Rank · Factor · Full Matrix · DoRA · Block 0 分层覆盖' }}</span>
        </div>
        <div v-if="!preview.error && preview.rows.length" class="nt-hero-totals">
          <span class="nt-stat-inline">{{ preview.rows.length }} 样例层合计 <strong>{{ previewStats.totalCount.toLocaleString('en-US') }}</strong> 参数</span>
          <span class="nt-stat-inline">平均占比 <strong>{{ previewStats.totalPct.toFixed(4) }}%</strong></span>
        </div>
      </div>

      <!-- Schematic Matrix Decomposition Formula -->
      <div class="nt-formula-strip">
        <div class="nt-formula-eq">
          <span class="nt-f-lhs">ΔW</span><span class="nt-f-op">=</span>
          <template v-if="moduleKind === 'lora'">
            <span class="nt-f-mat">up<small>[out × r]</small></span>
            <span class="nt-f-op">·</span>
            <span class="nt-f-mat">down<small>[r × in]</small></span>
            <span class="nt-f-scale">× (α / r)</span>
          </template>
          <template v-else-if="moduleKind === 'loha'">
            <span class="nt-f-op">(</span>
            <span class="nt-f-mat">W1a<small>[out × r]</small></span>
            <span class="nt-f-op">·</span>
            <span class="nt-f-mat">W1b<small>[r × in]</small></span>
            <span class="nt-f-op">) ⊙ (</span>
            <span class="nt-f-mat">W2a<small>[out × r]</small></span>
            <span class="nt-f-op">·</span>
            <span class="nt-f-mat">W2b<small>[r × in]</small></span>
            <span class="nt-f-op">)</span>
          </template>
          <template v-else-if="full">
            <span class="nt-f-mat">W1<small>[ol × im]</small></span>
            <span class="nt-f-op">⊗</span>
            <span class="nt-f-mat">W2<small>[ok × inn]</small></span>
            <span class="nt-f-scale">Full Matrix · 缩放 ×1</span>
          </template>
          <template v-else>
            <span class="nt-f-mat">W1<small>[ol × im]</small></span>
            <span class="nt-f-op">⊗ (</span>
            <span class="nt-f-mat">W2a<small>[ok × r]</small></span>
            <span class="nt-f-op">·</span>
            <span class="nt-f-mat">W2b<small>[r × inn]</small></span>
            <span class="nt-f-op">)</span>
          </template>
          <template v-if="doraOn">
            <span class="nt-f-op">+</span>
            <span class="nt-f-mat is-dora">magnitude<small>[out × 1]</small></span>
          </template>
        </div>
        <span class="nt-formula-kind">{{ formulaKindLabel }}</span>
      </div>

      <p v-if="preview.error" class="nt-error-banner" role="alert">暂无法计算：{{ preview.error }}</p>

      <div v-else class="nt-table-scroll">
        <table class="nt-matrix-table">
          <thead>
            <tr>
              <th>样例层</th>
              <th>原始 [输出 × 输入]</th>
              <th>模式</th>
              <th>适配器矩阵</th>
              <th class="nt-align-right">参数量</th>
              <th class="nt-align-right">占原始层</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in preview.rows" :key="row.name" :class="{ 'is-disabled': row.count === 0 }">
              <td>
                <span class="nt-layer-name">{{ row.name }}</span>
                <span v-if="typeTag(row.name)" class="nt-layer-type-tag">{{ typeTag(row.name) }}</span>
              </td>
              <td class="nt-dim-cell">{{ row.output }} × {{ row.input }}</td>
              <td>
                <span class="nt-mode-pill" :class="{ 'is-off': row.count === 0, 'is-full': row.mode.includes('Full') }">{{ row.mode }}</span>
              </td>
              <td>
                <div v-if="row.matrices.length" class="nt-mat-list">
                  <span v-for="matrix in row.matrices" :key="matrix[0]" class="nt-mat-chip" :class="{ 'is-mag': matrix[0] === 'magnitude' }">
                    <b>{{ matrix[0] }}</b> {{ matrix[1].join(' × ') }}
                  </span>
                </div>
                <span v-else class="muted">—</span>
              </td>
              <td class="nt-num-cell">{{ row.count.toLocaleString('en-US') }}</td>
              <td class="nt-pct-cell">
                <div class="nt-pct-wrap">
                  <div class="nt-bar-track" :title="`占原始层 ${row.percent.toFixed(4)}%`">
                    <div class="nt-bar-fill" :style="{ width: `${rowBarWidth(row).toFixed(1)}%` }" />
                  </div>
                  <span class="nt-pct-val">{{ row.percent.toFixed(4) }}%</span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p class="nt-hero-note">
        {{ krea ? 'Krea 2 主干宽度 6144。' : 'Anima 2B 标准宽度 2048，应用 Block 0 分层覆盖；未读取实际底模尺寸。' }}
        单层结构示例，非整网统计；不计 Alpha 缓冲与底模 bias。Alpha / Dropout 不影响参数量。筛选目标层或加载已有权重可能改变实际结构。
      </p>
    </section>

    <div v-else-if="trainingType === 'lora' && store.architecture === 'anima'" class="nt-info-note">
      当前适配器模块（<code class="mono">{{ moduleName }}</code>）不支持 Anima 2B 结构分解预览；切换至 <code>networks.lora_anima</code>、<code>networks.loha</code> 或 <code>networks.lokr</code> 可实时查看矩阵分解图解。
    </div>

    <!-- Main Configuration Fieldset -->
    <fieldset class="nt-fieldset" :disabled="store.locked">
      <!-- Row 1: Two-Column Hairline Configuration Grid -->
      <div class="nt-grid-2">
        <!-- Left Column: Training Type & Core Capacity -->
        <div class="nt-col">
          <div class="nt-sec-head">
            <h3>训练类型与核心容量</h3>
            <span class="nt-sec-meta">{{ archLabel }} · {{ trainingType === 'lora' ? 'Adapter' : 'Full' }}</span>
          </div>

          <label class="field nt-native-field">
            <span class="field-label-row">Training Type<FieldHelp field="training_type" label="Training Type" /></span>
            <select v-model="trainingType" :disabled="isolated">
              <option value="lora">Adapter (LoRA / LoHa / LoKR)</option>
              <option v-if="!isolated" value="full_finetune">Full Finetune</option>
            </select>
          </label>

          <template v-if="trainingType === 'lora'">
            <label class="field nt-native-field">
              <span class="field-label-row">Network Module<FieldHelp field="network_module" label="Network Module" /></span>
              <select v-model="selectedModule" class="mono">
                <option v-for="name in modules" :key="name">{{ name }}</option>
                <option v-if="moduleName && !modules.includes(moduleName)" :value="moduleName">{{ moduleName }}</option>
              </select>
            </label>

            <div class="nt-pair">
              <div class="nt-cap-cell">
                <div class="nt-cap-status">
                  <span v-if="rankDisabled" class="nt-badge is-lock">{{ full ? 'Full Matrix 下 Rank 不生效' : '已由高级分层设置接管' }}</span>
                  <span v-else class="nt-cap-status-placeholder">全局低秩容量</span>
                </div>
                <Field
                  :object="n"
                  field="network_dim"
                  label="Network Dim (Rank)"
                  type="number"
                  :min="1"
                  :fallback="16"
                  :disabled="rankDisabled"
                  :help="full ? 'Full Matrix 下 Rank 不生效。' : rankDisabled ? 'Block 层采用高级分层设置；此 Rank 值保留。' : '更高 Rank 增加容量与显存。'"
                />
                <div class="nt-chip-row">
                  <button
                    v-for="preset in [8, 16, 32, 64]"
                    :key="preset"
                    type="button"
                    class="nt-chip"
                    :class="{ active: rankNum === preset }"
                    :disabled="rankDisabled || store.locked"
                    @click="setRankPreset(preset)"
                  >{{ preset }}</button>
                </div>
              </div>

              <div class="nt-cap-cell">
                <div class="nt-cap-status">
                  <span class="nt-badge is-scale">{{ alphaScaleText }}</span>
                </div>
                <Field
                  :object="n"
                  field="network_alpha"
                  label="Network Alpha"
                  type="number"
                  :min="0.000001"
                  step="any"
                  :fallback="16"
                  help="通常与 Rank 相同；Full Matrix 下缩放固定为 1。"
                />
                <div class="nt-chip-row">
                  <button
                    v-for="ratio in [0.5, 1, 2]"
                    :key="ratio"
                    type="button"
                    class="nt-chip"
                    :class="{ active: Math.abs(alphaNum - rankNum * ratio) < 0.001 }"
                    :disabled="store.locked"
                    @click="setAlphaRatio(ratio)"
                  >{{ ratio }}×R</button>
                </div>
              </div>
            </div>

            <div class="nt-sub-pair">
              <div v-if="!isolated" class="nt-sub-check-cell">
                <Field :object="n" field="network_train_unet_only" label="Train UNet Only" type="boolean" :fallback="true" />
              </div>
              <div class="nt-sub-num-cell">
                <Field :object="n" field="network_dropout" label="Network Dropout" type="number" :min="0" :max="isolated ? 0.999 : 1" :step="0.05" :fallback="0" />
              </div>
            </div>
          </template>

          <div v-else class="nt-fullft-box">
            <h4>Full Finetune Options</h4>
            <Field
              :object="t"
              field="freeze_llm_adapter"
              label="Freeze LLM Adapter"
              type="boolean"
              :fallback="true"
              help="建议冻结预训练 LLM adapter，避免文本理解退化及 DDP graph 问题。"
            />
          </div>
        </div>

        <!-- Right Column: Module-Specific Options & Weights / Resume -->
        <div class="nt-col">
          <div v-if="trainingType === 'lora'" class="nt-mod-wrap">
            <div class="nt-sec-head">
              <h3>模块专有选项</h3>
              <span class="nt-sec-meta">{{ moduleName }}</span>
            </div>

            <div v-if="hasModuleOptions" class="nt-mod-grid" :class="{ 'is-single': !lokr && !lycoris && !isolated }">
              <Arg v-if="lokr" :network="n" name="factor" label="LoKR Factor" type="number" :min="-1" :step="1" help="空值 / -1 自动平衡分解；否则为正整数。" />
              <Arg v-if="lokr" :network="n" name="full_matrix" label="Full Matrix" type="boolean" :fallback="false" help="直接训练完整 Kronecker 因子，忽略 Rank 与 Alpha 缩放；恢复结构由保存矩阵决定。" />
              <Arg
                v-if="dora"
                :network="n"
                name="use_dora"
                :label="lokr ? 'Use DoKr' : 'Use DoRA'"
                type="boolean"
                :fallback="false"
                help="保存 ComfyUI 兼容的 dora_scale 权重。"
                @change="value => { if (!value) n.network_args = replaceArgument(n.network_args, 'dora_scale_fp32', undefined) }"
              />
              <Arg v-if="dora && enabledArg('use_dora')" :network="n" name="dora_scale_fp32" label="Save Magnitude Scale in FP32" type="boolean" :fallback="false" />
              <Arg v-if="lycoris" :network="n" name="mod_dim" label="Mod Dim" type="number" :min="0" :step="1" help="AdaLN modulation rank；空值排除。" />
              <Arg
                v-if="lycoris || isolated"
                :network="n"
                name="rank_dropout"
                label="Rank Dropout"
                type="number"
                :min="0"
                :max="isolated ? 0.999 : 1"
                :step="0.05"
                :help="lycoris ? 'LyCORIS 为输出通道 dropout，不是 Rank 维度。' : '丢弃轴由当前原生模块实现决定，概率必须小于 1。'"
              />
              <Arg v-if="lycoris || isolated" :network="n" name="module_dropout" label="Module Dropout" type="number" :min="0" :max="isolated ? 0.999 : 1" :step="0.05" />
              <Arg v-if="lycoris" :network="n" name="use_tucker" label="Use Tucker" type="boolean" :fallback="false" help="用于 Conv2d 3×3；Anima DiT 的 Linear 层不受影响。" />
              <Arg v-if="krea && !lokr || moss && moduleName === Moss.MODULES[0]" :network="n" name="loraplus_lr_ratio" label="LoRA+ LR Ratio" type="number" :min="0.01" step="any" />
            </div>
            <div v-else class="nt-mod-empty">
              当前模块无额外专有选项；可通过下方 <code>Network Args</code> 传入附加参数。
            </div>
          </div>

          <!-- Weights vs Resume Section -->
          <div class="nt-wr-section" :class="{ 'is-solo': trainingType !== 'lora' }">
            <div class="nt-wr-head">
              <h4>权重初始化与断点续训</h4>
              <span class="nt-sec-meta">区分：仅权重 vs 完整状态</span>
            </div>

            <div v-if="trainingType === 'lora'" class="nt-wr-card is-weights">
              <span class="nt-wr-tag">仅权重初始化</span>
              <Field :object="n" field="network_weights" label="Network Weights (Adapter checkpoint)" help="使用同类型 adapter 初始化；完整训练状态使用下方 Resume。" />
            </div>

            <div class="nt-wr-card is-resume">
              <div class="nt-wr-badges">
                <span v-if="n.auto_resume_last_state" class="nt-badge is-lock">自动恢复已接管</span>
                <span class="nt-wr-tag">完整断点续训</span>
              </div>
              <Field :object="n" field="auto_resume_last_state" label="Auto-resume from last saved state" type="boolean" :fallback="false" @change="autoResume" />
              <Field :object="n" field="resume" label="Resume State Folder" :disabled="!!n.auto_resume_last_state" help="恢复 optimizer、scheduler 与训练步数；启用自动恢复时忽略手动目录。" />
            </div>
          </div>
        </div>
      </div>

      <!-- Row 2: LayerRankEditor Hairline Matrix -->
      <LayerRankEditor v-if="trainingType === 'lora' && layered" :network="n" :full="full" :disabled="store.locked" />

      <!-- Row 3: Network Args & JSON Details -->
      <section v-if="trainingType === 'lora'" class="nt-args-sec" aria-label="附加参数">
        <label class="field nt-native-field">
          <span class="field-label-row nt-args-label-row">
            <span class="nt-args-label-left">Network Args<FieldHelp field="network_args" label="Network Args" /></span>
            <span class="nt-sec-meta">{{ totalArgsCount }} 项总参数（{{ freeArgsCount }} 项自由参数）</span>
          </span>
          <textarea v-model="freeArgs" class="mono" rows="3" spellcheck="false" />
          <small class="muted">空格分隔 key=value；JSON 列表与对象整体保留。专用字段优先。Krea 仅支持当前 adapter 的参数白名单。</small>
        </label>
        <details class="nt-json-details">
          <summary>
            <span>全部 Network Args（JSON）</span>
            <span class="nt-sec-meta">原始参数数组</span>
          </summary>
          <div class="nt-json-body">
            <Field :object="n" field="network_args" label="Network Args JSON" type="json" help="可用于修正已有原始参数与 layer_configs；保存时校验。" />
          </div>
        </details>
      </section>
    </fieldset>
  </section>
</template>

<style scoped>
.nt-wrap {
  --nt-mono: "Cascadia Mono", Consolas, "JetBrains Mono", ui-monospace, monospace;
  --nt-hairline: color-mix(in srgb, var(--border) 82%, transparent);
  --nt-hairline-soft: color-mix(in srgb, var(--border) 48%, transparent);
  --nt-surface: color-mix(in srgb, var(--foreground) 2.5%, transparent);
  --nt-surface-strong: color-mix(in srgb, var(--foreground) 4.5%, transparent);
  --nt-ok: #26895a;
  --nt-warn: #b87114;
  --nt-accent-2: #7c4dff;
  width: 100%;
  min-width: 0;
}
:global(.dark) .nt-wrap {
  --nt-ok: #5ace9d;
  --nt-warn: #f0b254;
  --nt-accent-2: #b58cff;
}
.mono {
  font-family: var(--nt-mono);
  font-variant-numeric: tabular-nums;
}

/* 1. Top Header & Recipe Strip */
.nt-top-bar {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--nt-hairline);
  margin-bottom: 10px;
}
.nt-title-block {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
}
.nt-title-block h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 650;
}
.nt-title-block p {
  margin: 0;
  font-size: 13px;
  color: var(--muted-foreground);
}

.nt-recipe-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px 16px;
  flex-wrap: wrap;
  padding: 6px 12px;
  margin-bottom: 16px;
  background: var(--nt-surface);
  border-top: 1px solid var(--nt-hairline-soft);
  border-bottom: 1px solid var(--nt-hairline);
  font-size: 13px;
}
.nt-recipe-items {
  display: flex;
  align-items: center;
  gap: 6px 8px;
  flex-wrap: wrap;
  line-height: 1.4;
}
.nt-recipe-sep {
  color: var(--muted-foreground);
  opacity: .6;
  user-select: none;
}
.nt-recipe-key {
  font-family: var(--nt-mono);
  font-weight: 600;
}
.nt-recipe-chip {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border-radius: 3px;
  font-family: var(--nt-mono);
  font-size: 12px;
  font-weight: 600;
  background: color-mix(in srgb, var(--primary) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--primary) 38%, transparent);
  color: var(--foreground);
}
.nt-recipe-chip.is-ok {
  background: color-mix(in srgb, var(--nt-ok) 14%, transparent);
  border-color: color-mix(in srgb, var(--nt-ok) 40%, transparent);
  color: var(--nt-ok);
}
.nt-recipe-chip.is-warn {
  background: color-mix(in srgb, var(--nt-warn) 14%, transparent);
  border-color: color-mix(in srgb, var(--nt-warn) 40%, transparent);
  color: var(--nt-warn);
}
.nt-recipe-chip.is-off {
  background: var(--nt-surface-strong);
  border-color: var(--nt-hairline);
  color: var(--muted-foreground);
  font-weight: 500;
}

/* 2. Hero: Explorable Adapter Matrix Blueprint */
.nt-hero {
  padding-bottom: 14px;
  border-bottom: 1px solid var(--nt-hairline);
  margin-bottom: 18px;
}
.nt-hero-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.nt-hero-title {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}
.nt-hero-title h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 650;
}
.nt-hero-sub {
  font-size: 12px;
  color: var(--muted-foreground);
}
.nt-hero-totals {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.nt-stat-inline {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  padding: 2px 9px;
  border-radius: 4px;
  background: var(--nt-surface-strong);
  border: 1px solid var(--nt-hairline-soft);
  font-size: 12px;
  color: var(--muted-foreground);
}
.nt-stat-inline strong {
  font-family: var(--nt-mono);
  font-size: 13px;
  font-weight: 700;
  color: var(--foreground);
}

.nt-formula-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px 16px;
  flex-wrap: wrap;
  padding: 8px 12px;
  margin-bottom: 10px;
  border-radius: 4px;
  background: var(--nt-surface);
  border: 1px solid var(--nt-hairline-soft);
  border-left: 3px solid var(--primary);
}
.nt-formula-eq {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-family: var(--nt-mono);
  font-size: 13px;
}
.nt-f-lhs { font-weight: 700; color: var(--primary); }
.nt-f-op { color: var(--muted-foreground); font-weight: 600; }
.nt-f-mat {
  display: inline-flex;
  align-items: baseline;
  gap: 3px;
  padding: 1px 7px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--card) 85%, transparent);
  border: 1px solid var(--nt-hairline);
  font-weight: 600;
}
.nt-f-mat small {
  display: inline;
  font-weight: 400;
  font-size: 11px;
  color: var(--muted-foreground);
}
.nt-f-mat.is-dora {
  border-color: color-mix(in srgb, var(--nt-accent-2) 50%, var(--border));
  background: color-mix(in srgb, var(--nt-accent-2) 12%, var(--card));
}
.nt-f-scale {
  font-size: 12px;
  color: var(--muted-foreground);
  padding: 1px 7px;
  border-radius: 3px;
  border: 1px dashed var(--nt-hairline);
}
.nt-formula-kind {
  font-size: 12px;
  color: var(--muted-foreground);
}

.nt-table-scroll {
  overflow-x: auto;
  border-top: 1px solid var(--nt-hairline);
  border-bottom: 1px solid var(--nt-hairline);
}
.nt-matrix-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.nt-matrix-table th {
  text-align: left;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted-foreground);
  padding: 7px 10px;
  border-bottom: 1px solid var(--nt-hairline);
  background: var(--nt-surface);
  white-space: nowrap;
}
.nt-matrix-table th.nt-align-right { text-align: right; }
.nt-matrix-table td {
  padding: 6px 10px;
  border-bottom: 1px solid var(--nt-hairline-soft);
  vertical-align: middle;
}
.nt-matrix-table tbody tr:last-child td { border-bottom: 0; }
.nt-matrix-table tbody tr:hover { background: var(--nt-surface); }
.nt-matrix-table tbody tr.is-disabled td { color: var(--muted-foreground); opacity: .75; }
.nt-layer-name { font-family: var(--nt-mono); font-size: 13px; font-weight: 600; white-space: nowrap; }
.nt-layer-type-tag {
  display: inline-block;
  margin-left: 6px;
  padding: 0 5px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 500;
  color: var(--muted-foreground);
  background: var(--nt-surface-strong);
  border: 1px solid var(--nt-hairline-soft);
}
.nt-dim-cell { font-family: var(--nt-mono); white-space: nowrap; color: var(--muted-foreground); }
.nt-mode-pill {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border-radius: 3px;
  font-family: var(--nt-mono);
  font-size: 12px;
  font-weight: 600;
  background: color-mix(in srgb, var(--primary) 13%, transparent);
  border: 1px solid color-mix(in srgb, var(--primary) 35%, transparent);
  white-space: nowrap;
}
.nt-mode-pill.is-off { background: var(--nt-surface-strong); border-color: var(--nt-hairline); color: var(--muted-foreground); font-weight: 500; }
.nt-mode-pill.is-full { background: color-mix(in srgb, var(--nt-warn) 14%, transparent); border-color: color-mix(in srgb, var(--nt-warn) 40%, transparent); color: var(--nt-warn); }
.nt-mat-list { display: flex; flex-wrap: wrap; gap: 4px 6px; }
.nt-mat-chip {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  padding: 1px 6px;
  border-radius: 3px;
  font-family: var(--nt-mono);
  font-size: 12px;
  background: color-mix(in srgb, var(--card) 80%, transparent);
  border: 1px solid var(--nt-hairline-soft);
  white-space: nowrap;
}
.nt-mat-chip b { color: var(--primary); font-weight: 650; }
.nt-mat-chip.is-mag b { color: var(--nt-accent-2); }
.nt-num-cell { font-family: var(--nt-mono); font-weight: 600; text-align: right; white-space: nowrap; }
.nt-pct-cell { min-width: 150px; }
.nt-pct-wrap { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
.nt-bar-track {
  width: 72px;
  height: 7px;
  border-radius: 2px;
  background: var(--nt-surface-strong);
  border: 1px solid var(--nt-hairline-soft);
  overflow: hidden;
  flex-shrink: 0;
}
.nt-bar-fill { height: 100%; background: var(--primary); border-radius: 1px; transition: width .2s ease; }
.nt-pct-val { font-family: var(--nt-mono); font-size: 12.5px; font-weight: 600; min-width: 64px; text-align: right; }
.nt-hero-note { margin: 8px 0 0; font-size: 12px; color: var(--muted-foreground); line-height: 1.5; }
.nt-error-banner {
  padding: 8px 12px;
  margin: 8px 0;
  border-radius: 4px;
  border: 1px solid color-mix(in srgb, var(--destructive) 50%, var(--border));
  border-left: 3px solid var(--destructive);
  background: color-mix(in srgb, var(--destructive) 10%, var(--card));
  color: var(--destructive);
  font-size: 13px;
}
.nt-info-note {
  padding: 10px 14px;
  margin-bottom: 18px;
  border-radius: 4px;
  border: 1px solid var(--nt-hairline);
  border-left: 3px solid var(--muted-foreground);
  background: var(--nt-surface);
  font-size: 13px;
  color: var(--muted-foreground);
}

/* 3. Row 1: Two-Column Hairline Grid */
.nt-fieldset {
  border: 0;
  padding: 0;
  margin: 0;
  min-width: 0;
  display: block;
  background: transparent;
  border-radius: 0;
}
.nt-fieldset :deep(.field) {
  gap: 5px;
}
.nt-fieldset :deep(.field > .field-label-row),
.nt-fieldset :deep(.field > .field-label-row label) {
  font-size: 12px;
  font-weight: 500;
  color: var(--muted-foreground);
}
.nt-fieldset :deep(.field input:not([type="checkbox"]):not([type="color"])),
.nt-fieldset :deep(.field select) {
  min-height: 32px;
  height: 32px;
  padding: 0 9px;
  border: 1px solid var(--nt-hairline);
  border-radius: 4px;
  background: color-mix(in srgb, var(--card) 82%, transparent);
  color: var(--foreground);
  font-size: 13.5px;
  box-shadow: none;
}
.nt-fieldset :deep(.field input[type="number"]) {
  font-family: var(--nt-mono);
  font-variant-numeric: tabular-nums;
}
.nt-fieldset :deep(.field textarea) {
  padding: 7px 10px;
  border: 1px solid var(--nt-hairline);
  border-radius: 4px;
  background: color-mix(in srgb, var(--card) 82%, transparent);
  color: var(--foreground);
  font-size: 13px;
  line-height: 1.5;
}
.nt-fieldset :deep(.field input:not([type="checkbox"]):focus),
.nt-fieldset :deep(.field select:focus),
.nt-fieldset :deep(.field textarea:focus) {
  outline: none;
  border-color: var(--primary);
}
.nt-fieldset :deep(.field-check) {
  min-height: 30px;
  gap: 7px;
}
.nt-fieldset :deep(.field-check label) {
  font-size: 13.5px;
  font-weight: 500;
  color: var(--foreground);
}
.nt-fieldset :deep(.field small.muted) {
  font-size: 12px;
  line-height: 1.45;
  color: var(--muted-foreground);
}

.nt-grid-2 {
  display: grid;
  grid-template-columns: 1.06fr 0.94fr;
  gap: 0;
  border-bottom: 1px solid var(--nt-hairline);
  padding-bottom: 20px;
  margin-bottom: 20px;
}
.nt-col {
  min-width: 0;
  padding-right: 26px;
  border-right: 1px solid var(--nt-hairline-soft);
}
.nt-col:last-child {
  padding-right: 0;
  padding-left: 26px;
  border-right: 0;
}
.nt-sec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-bottom: 8px;
  margin-bottom: 12px;
  border-bottom: 1px solid var(--nt-hairline);
}
.nt-sec-head h3 { margin: 0; font-size: 14px; font-weight: 650; }
.nt-sec-meta { font-family: var(--nt-mono); font-size: 12px; color: var(--muted-foreground); }

.nt-native-field {
  margin-bottom: 12px;
}
.nt-pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  padding: 12px 0;
  border-top: 1px solid var(--nt-hairline-soft);
  border-bottom: 1px solid var(--nt-hairline-soft);
  margin: 12px 0;
  align-items: start;
}
.nt-cap-cell {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.nt-cap-status {
  display: flex;
  align-items: center;
  min-height: 22px;
}
.nt-cap-status-placeholder {
  font-size: 11.5px;
  color: var(--muted-foreground);
}
.nt-chip-row {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}
.nt-chip {
  padding: 1px 8px;
  border: 1px solid var(--nt-hairline);
  border-radius: 4px;
  font-family: var(--nt-mono);
  font-size: 12px;
  color: var(--muted-foreground);
  background: transparent;
  cursor: pointer;
  transition: border-color .15s, color .15s, background .15s;
}
.nt-chip:hover:not(:disabled) { border-color: var(--primary); color: var(--primary); }
.nt-chip.active {
  border-color: var(--primary);
  color: var(--primary);
  background: color-mix(in srgb, var(--primary) 13%, transparent);
  font-weight: 600;
}

.nt-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border-radius: 3px;
  font-family: var(--nt-mono);
  font-size: 11.5px;
  font-weight: 600;
  border: 1px solid var(--nt-hairline);
  background: var(--nt-surface-strong);
}
.nt-badge.is-lock {
  color: var(--nt-warn);
  border-color: color-mix(in srgb, var(--nt-warn) 45%, transparent);
  background: color-mix(in srgb, var(--nt-warn) 12%, transparent);
}
.nt-badge.is-scale {
  color: var(--primary);
  border-color: color-mix(in srgb, var(--primary) 40%, transparent);
  background: color-mix(in srgb, var(--primary) 12%, transparent);
}

.nt-sub-pair {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
  padding-top: 4px;
}
.nt-sub-check-cell {
  flex: 1;
  min-width: 180px;
}
.nt-sub-num-cell {
  width: 190px;
  flex-shrink: 0;
}

.nt-fullft-box {
  padding: 14px 16px;
  border: 1px solid var(--nt-hairline);
  border-left: 3px solid var(--nt-warn);
  border-radius: 4px;
  background: var(--nt-surface);
  margin-top: 12px;
}
.nt-fullft-box h4 { margin: 0 0 8px; font-size: 14px; font-weight: 650; }

/* Right Column: Module-Specific & Weights vs Resume */
.nt-mod-wrap { margin-bottom: 14px; }
.nt-mod-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px 14px;
  align-items: start;
}
.nt-mod-grid.is-single {
  grid-template-columns: 1fr;
}
.nt-mod-grid.is-single :deep(.field-check) {
  padding: 8px 12px;
  border: 1px solid var(--nt-hairline-soft);
  border-radius: 4px;
  background: var(--nt-surface);
}
.nt-mod-empty {
  padding: 10px 12px;
  border-radius: 4px;
  border: 1px dashed var(--nt-hairline);
  color: var(--muted-foreground);
  font-size: 13px;
}

.nt-wr-section {
  padding-top: 12px;
  border-top: 1px solid var(--nt-hairline);
}
.nt-wr-section.is-solo {
  padding-top: 0;
  border-top: 0;
}
.nt-wr-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}
.nt-wr-head h4 { margin: 0; font-size: 13px; font-weight: 650; }
.nt-wr-card {
  position: relative;
  padding: 10px 12px;
  border: 1px solid var(--nt-hairline-soft);
  border-radius: 4px;
  background: var(--nt-surface);
  margin-bottom: 10px;
  display: grid;
  gap: 8px;
}
.nt-wr-card:last-child { margin-bottom: 0; }
.nt-wr-card.is-weights { border-left: 3px solid var(--primary); }
.nt-wr-card.is-resume { border-left: 3px solid var(--nt-ok); }
.nt-wr-card.is-weights > .nt-wr-tag {
  position: absolute;
  top: 10px;
  right: 12px;
}
.nt-wr-badges {
  position: absolute;
  top: 10px;
  right: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.nt-wr-card :deep(.field > .field-label-row),
.nt-wr-card :deep(.field-check) {
  padding-right: 92px;
}
.nt-wr-tag {
  font-size: 11px;
  font-weight: 650;
  padding: 1px 6px;
  border-radius: 3px;
  font-family: var(--nt-mono);
  white-space: nowrap;
}
.nt-wr-card.is-weights .nt-wr-tag {
  color: var(--primary);
  background: color-mix(in srgb, var(--primary) 14%, transparent);
}
.nt-wr-card.is-resume .nt-wr-tag {
  color: var(--nt-ok);
  background: color-mix(in srgb, var(--nt-ok) 14%, transparent);
}

/* Row 3: Network Args & JSON Details */
.nt-args-sec { margin-bottom: 10px; }
.nt-args-label-row {
  width: 100%;
  justify-content: space-between;
}
.nt-args-label-left {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.nt-json-details {
  margin-top: 10px;
  border: 1px solid var(--nt-hairline-soft);
  border-radius: 4px;
  background: var(--nt-surface);
}
.nt-json-details summary {
  cursor: pointer;
  padding: 8px 12px;
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: space-between;
  user-select: none;
}
.nt-json-details[open] summary { border-bottom: 1px solid var(--nt-hairline-soft); }
.nt-json-body { padding: 10px 12px; }

@media (min-width: 1800px) {
  .nt-col { padding-right: 32px; }
  .nt-col:last-child { padding-left: 32px; }
}
@media (max-width: 1180px) {
  .nt-grid-2 { grid-template-columns: 1fr; gap: 18px; }
  .nt-col, .nt-col:last-child { padding: 0; border-right: 0; }
}
@media (max-width: 680px) {
  .nt-pair, .nt-sub-pair, .nt-mod-grid { grid-template-columns: 1fr; }
}
</style>
