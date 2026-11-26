<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { LayerRank } from '@/domain/training'
import { api } from '@/services/api'
import { argumentValue, replaceArgument } from '../training/rules'
import { layerDrafts } from './drafts'
import FieldHelp from '@/components/forms/FieldHelp.vue'

const props = defineProps<{ network: Record<string, any>; full: boolean; disabled?: boolean }>()
const layers = ref<string[]>([])
const message = ref('')
const error = ref('')
const draft = ref<any>(null)
let generation = 0
let controller: AbortController | undefined
let serialized = ''

const raw = computed(() => argumentValue(props.network.network_args, 'layer_configs'))
const active = computed(() => raw.value !== undefined)
const lokr = computed(() => String(props.network.network_module).endsWith('.lokr'))
const rows = computed(() => (!draft.value ? [] : draft.value.mode === 'type' ? Object.keys(LayerRank.types) : layers.value))
const groups = computed(() => {
  if (draft.value?.mode !== 'layer') return [{ title: '层类型', names: rows.value }]
  const blocks = new Map<string, string[]>()
  for (const name of rows.value) {
    const block = name.split('.')[1] || '?'
    const list = blocks.get(block) || []
    list.push(name)
    blocks.set(block, list)
  }
  return [...blocks].map(([block, names]) => ({ title: `Block ${block}`, names }))
})

const maxRankForBar = computed(() => {
  if (!draft.value) return 32
  const isType = draft.value.mode === 'type'
  let maxVal = Math.max(1, Number(draft.value.default_rank) || 16)
  for (const name of rows.value) {
    const val = LayerRank.resolve(draft.value, name, isType)
    if (val.enabled && Number(val.rank) > maxVal) maxVal = Number(val.rank)
  }
  return Math.max(maxVal, 32)
})

watch(raw, value => {
  if (value === serialized) return
  error.value = ''
  if (value === undefined) { draft.value = null; return }
  try {
    const cached = layerDrafts.get(props.network)
    draft.value = cached?.source === value ? cached.value : JSON.parse(value)
    if (!draft.value || !['type', 'layer'].includes(draft.value.mode)) throw Error('不支持的分层配置')
  } catch (err) {
    draft.value = null
    error.value = `layer_configs JSON 无效：${(err as Error).message}。原值已保留，可在 Network Args 修正或重置。`
  }
}, { immediate: true })

watch(() => props.network, () => {
  controller?.abort()
  layers.value = []
  generation++
  if (active.value) void refresh()
}, { immediate: true })

async function refresh() {
  const id = ++generation
  controller?.abort()
  controller = new AbortController()
  message.value = '正在读取模型层列表…'
  try {
    const data = await api<{ layers: string[]; block_count: number }>('/api/anima-layers', { signal: controller.signal })
    if (id !== generation) return
    layers.value = data.layers
    message.value = `已读取 ${data.block_count} 个 Block，${data.layers.length} 个可配置层。`
    validate()
  } catch (err) {
    if (id !== generation || (err as Error).name === 'AbortError') return
    message.value = ''
    error.value = (err as Error).message
  }
}

function validate() {
  if (!draft.value) return
  try {
    LayerRank.validate(LayerRank.compact(draft.value, lokr.value), layers.value)
    error.value = ''
  } catch (err) {
    error.value = (err as Error).message
  }
}

function commit() {
  serialized = JSON.stringify(LayerRank.compact(draft.value, lokr.value))
  layerDrafts.set(props.network, { source: serialized, value: draft.value })
  props.network.network_args = replaceArgument(props.network.network_args, 'layer_configs', serialized)
  validate()
}

function toggle(event: Event) {
  if (!(event.target as HTMLInputElement).checked) {
    props.network.network_args = replaceArgument(props.network.network_args, 'layer_configs', undefined)
    return
  }
  const cached = layerDrafts.get(props.network)
  if (cached) {
    draft.value = cached.value
    commit()
    void refresh()
  } else {
    reset()
  }
}

function reset() {
  draft.value = LayerRank.create(props.network.network_dim ?? 16, Number(argumentValue(props.network.network_args, 'factor') ?? -1))
  commit()
  void refresh()
}

function values(name: string) {
  return LayerRank.resolve(draft.value, name, draft.value.mode === 'type')
}

function isAlphaExplicit(name: string) {
  const group = draft.value?.mode === 'type' ? draft.value.types?.[name] : draft.value.layers?.[name]
  return Boolean(group && 'alpha' in group && group.alpha !== null && group.alpha !== undefined)
}

function budgetPct(name: string) {
  const val = values(name)
  if (!val.enabled) return 0
  if (props.full) return 100
  return Math.min(100, (Number(val.rank) / maxRankForBar.value) * 100)
}

function budgetLabel(name: string) {
  const val = values(name)
  if (!val.enabled) return '已关闭'
  if (props.full) return 'Full'
  return `r=${val.rank}`
}

function edit(name: string, key: string, event: Event) {
  const group = draft.value.mode === 'type' ? 'types' : 'layers'
  draft.value[group] ||= {}
  draft.value[group][name] ||= {}
  const input = event.target as HTMLInputElement
  const value = key === 'enabled' ? input.checked : input.value === '' ? null : Number(input.value)
  draft.value[group][name][key] = value
  if (key === 'alpha' && value === values(name).rank) delete draft.value[group][name].alpha
  commit()
}

onBeforeUnmount(() => {
  generation++
  controller?.abort()
})
</script>

<template>
  <section class="nt-layer-sec" aria-label="高级分层设置">
    <div class="nt-layer-top">
      <label class="nt-layer-toggle">
        <input type="checkbox" :checked="active" :disabled="disabled" @change="toggle" />
        高级分层设置
        <code class="nt-code-tag">layer_configs</code>
        <FieldHelp field="layer_configs" label="高级分层设置" />
      </label>

      <div v-if="active" class="nt-layer-controls">
        <label v-if="draft" class="nt-mode-select-label">
          <span class="field-label-row">配置模式<FieldHelp field="layer_mode" label="配置模式" /></span>
          <select v-model="draft.mode" class="nt-select" :disabled="disabled" @change="commit">
            <option value="type">按层类型</option>
            <option value="layer">按单个层</option>
          </select>
        </label>
        <button class="nt-btn" type="button" @click="refresh">↻ 重新读取模型</button>
        <button class="nt-btn" type="button" :disabled="disabled" @click="reset">重置为原 Rank</button>
        <span v-if="message" class="nt-badge is-ok" role="status">{{ message }}</span>
      </div>
    </div>

    <div v-if="active" class="nt-layer-body">
      <div class="nt-layer-meta-bar">
        <div v-if="draft" class="nt-layer-defaults">
          <label class="field nt-inline-field">
            <span class="field-label-row">默认 Rank<FieldHelp field="layer_rank" label="默认 Rank" /></span>
            <input v-model.number="draft.default_rank" class="nt-input mono" type="number" min="1" :disabled="disabled || full" @input="commit" />
          </label>
          <label v-if="lokr" class="field nt-inline-field">
            <span class="field-label-row">默认 Factor<FieldHelp field="layer_factor" label="默认 Factor" /></span>
            <input v-model.number="draft.default_factor" class="nt-input mono" type="number" min="-1" :disabled="disabled" @input="commit" />
          </label>
        </div>
        <div class="nt-layer-hints">
          <p class="nt-hint">仅配置 DiT Block，优先于全局 Alpha、Factor 和旧的 Block 配置。Alpha 默认随 Rank 变化；切换模式只应用当前模式，另一模式草稿暂存于此页面。</p>
          <p v-if="full" class="nt-hint is-warn">Full Matrix 下 Rank / Alpha 不生效；训练开关和 Factor 仍生效。</p>
        </div>
      </div>

      <p v-if="error" class="nt-error-banner" role="alert">{{ error }}</p>

      <template v-if="draft">
        <details v-for="(group, i) in groups" :key="group.title" class="nt-block-details" :open="i === 0">
          <summary>
            <span>{{ group.title }}</span>
            <span class="nt-sec-meta">{{ group.names.length }} 项</span>
          </summary>

          <div class="nt-layer-list">
            <div v-for="name in group.names" :key="name" class="nt-layer-row" :class="{ 'is-off': !values(name).enabled, 'is-lokr': lokr }">
              <div class="nt-layer-name-col">
                <span class="nt-layer-label" :class="{ mono: draft.mode !== 'type' }">
                  {{ draft.mode === 'type' ? LayerRank.types[name] : name }}
                </span>
                <span v-if="draft.mode === 'type'" class="nt-layer-type-tag mono">{{ name }}</span>
              </div>

              <label class="nt-layer-check">
                <input type="checkbox" :checked="values(name).enabled" :disabled="disabled" @change="edit(name, 'enabled', $event)" />
                <span>训练</span>
                <FieldHelp field="layer_enabled" :label="`${name} 训练`" />
              </label>

              <label v-for="key in (lokr ? ['rank', 'alpha', 'factor'] : ['rank', 'alpha'])" :key="key" class="nt-layer-num">
                <span class="field-label-row">
                  {{ key }}
                  <FieldHelp :field="`layer_${key}`" :label="`${name} ${key}`" />
                </span>
                <div class="nt-alpha-wrap">
                  <input
                    class="nt-input mono"
                    type="number"
                    :aria-label="`${name} ${key}`"
                    :value="values(name)[key]"
                    :min="key === 'factor' ? -1 : key === 'alpha' ? 0.000001 : 1"
                    :step="key === 'alpha' ? 'any' : 1"
                    :disabled="disabled || !values(name).enabled || (full && key !== 'factor')"
                    @input="edit(name, key, $event)"
                  />
                  <span v-if="key === 'alpha' && !isAlphaExplicit(name)" class="nt-alpha-auto">随R</span>
                </div>
              </label>

              <div class="nt-budget-col" aria-hidden="true">
                <div class="nt-budget-track">
                  <div class="nt-budget-fill" :style="{ width: `${budgetPct(name).toFixed(1)}%` }" />
                </div>
                <span class="nt-budget-val">{{ budgetLabel(name) }}</span>
              </div>
            </div>
          </div>
        </details>
      </template>
    </div>
  </section>
</template>

<style scoped>
.nt-layer-sec {
  --nt-mono: "Cascadia Mono", Consolas, "JetBrains Mono", ui-monospace, monospace;
  --nt-hairline: color-mix(in srgb, var(--border) 82%, transparent);
  --nt-hairline-soft: color-mix(in srgb, var(--border) 48%, transparent);
  --nt-surface: color-mix(in srgb, var(--foreground) 2.5%, transparent);
  --nt-surface-strong: color-mix(in srgb, var(--foreground) 4.5%, transparent);
  --nt-ok: #26895a;
  --nt-warn: #b87114;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--nt-hairline);
  margin-bottom: 18px;
}
:global(.dark) .nt-layer-sec {
  --nt-ok: #5ace9d;
  --nt-warn: #f0b254;
}
.mono {
  font-family: var(--nt-mono);
  font-variant-numeric: tabular-nums;
}

.nt-layer-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--nt-hairline-soft);
}
.nt-layer-toggle {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 14px;
  font-weight: 600;
  color: var(--foreground);
  cursor: pointer;
}
.nt-layer-toggle input[type="checkbox"] {
  width: 15px;
  height: 15px;
  accent-color: var(--primary);
  margin: 0;
}
.nt-code-tag {
  font-family: var(--nt-mono);
  font-size: 11.5px;
  font-weight: 500;
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--nt-surface-strong);
  border: 1px solid var(--nt-hairline-soft);
  color: var(--muted-foreground);
}

.nt-layer-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.nt-mode-select-label {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: var(--muted-foreground);
}
.nt-select {
  min-height: 30px;
  height: 30px;
  width: auto;
  padding: 0 8px;
  border: 1px solid var(--nt-hairline);
  border-radius: 4px;
  background: color-mix(in srgb, var(--card) 82%, transparent);
  color: var(--foreground);
  font-size: 13px;
}
.nt-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 11px;
  border: 1px solid var(--nt-hairline);
  border-radius: 4px;
  font-size: 12.5px;
  font-weight: 500;
  background: color-mix(in srgb, var(--card) 85%, transparent);
  color: var(--foreground);
  cursor: pointer;
  transition: border-color .15s, color .15s;
}
.nt-btn:hover:not(:disabled) {
  border-color: var(--primary);
  color: var(--primary);
}
.nt-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 3px;
  font-family: var(--nt-mono);
  font-size: 11.5px;
  font-weight: 600;
  border: 1px solid var(--nt-hairline);
}
.nt-badge.is-ok {
  color: var(--nt-ok);
  border-color: color-mix(in srgb, var(--nt-ok) 40%, transparent);
  background: color-mix(in srgb, var(--nt-ok) 12%, transparent);
}

.nt-layer-meta-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px 18px;
  flex-wrap: wrap;
  padding: 10px 0;
  border-bottom: 1px solid var(--nt-hairline-soft);
}
.nt-layer-defaults {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.nt-inline-field {
  display: inline-flex;
  flex-direction: row;
  align-items: center;
  gap: 7px;
  margin: 0;
  font-size: 12px;
  color: var(--muted-foreground);
}
.nt-inline-field .nt-input {
  width: 82px;
}
.nt-input {
  min-height: 28px;
  height: 28px;
  padding: 0 7px;
  border: 1px solid var(--nt-hairline);
  border-radius: 4px;
  background: color-mix(in srgb, var(--card) 82%, transparent);
  color: var(--foreground);
  font-size: 13px;
}
.nt-input:focus {
  outline: none;
  border-color: var(--primary);
}
.nt-input:disabled {
  opacity: .55;
  cursor: not-allowed;
  background: var(--nt-surface);
}
.nt-layer-hints {
  flex: 1;
  min-width: 240px;
}
.nt-hint {
  margin: 0;
  font-size: 12px;
  color: var(--muted-foreground);
  line-height: 1.45;
}
.nt-hint.is-warn {
  color: var(--nt-warn);
  margin-top: 3px;
}
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

.nt-block-details {
  border: 1px solid var(--nt-hairline-soft);
  border-radius: 4px;
  margin-top: 10px;
  background: color-mix(in srgb, var(--card) 50%, transparent);
}
.nt-block-details summary {
  cursor: pointer;
  padding: 7px 12px;
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--nt-surface);
  user-select: none;
}
.nt-block-details[open] summary {
  border-bottom: 1px solid var(--nt-hairline-soft);
}
.nt-sec-meta {
  font-family: var(--nt-mono);
  font-size: 12px;
  font-weight: 400;
  color: var(--muted-foreground);
}

.nt-layer-row {
  display: grid;
  grid-template-columns: minmax(14rem, 1.8fr) 74px minmax(5.5rem, 7.5rem) minmax(6.5rem, 8.5rem) minmax(8.5rem, 11rem);
  gap: 8px 12px;
  align-items: center;
  padding: 7px 12px;
  border-bottom: 1px solid var(--nt-hairline-soft);
}
.nt-layer-row.is-lokr {
  grid-template-columns: minmax(12rem, 1.6fr) 74px minmax(5rem, 6.5rem) minmax(6rem, 7.5rem) minmax(5rem, 6.5rem) minmax(7.5rem, 9.5rem);
}
.nt-layer-row:last-child {
  border-bottom: 0;
}
.nt-layer-row:hover {
  background: var(--nt-surface);
}
.nt-layer-row.is-off {
  opacity: .55;
}
.nt-layer-name-col {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  min-width: 0;
}
.nt-layer-label {
  font-size: 13px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.nt-layer-type-tag {
  padding: 0 5px;
  border-radius: 3px;
  font-size: 11px;
  color: var(--muted-foreground);
  background: var(--nt-surface-strong);
  border: 1px solid var(--nt-hairline-soft);
}
.nt-layer-check {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12.5px;
  white-space: nowrap;
  cursor: pointer;
}
.nt-layer-check input[type="checkbox"] {
  width: 14px;
  height: 14px;
  accent-color: var(--primary);
  margin: 0;
}
.nt-layer-num {
  display: grid;
  gap: 3px;
  font-size: 11.5px;
  color: var(--muted-foreground);
}
.nt-alpha-wrap {
  display: flex;
  align-items: center;
  gap: 5px;
}
.nt-alpha-wrap .nt-input {
  width: 100%;
  min-width: 0;
}
.nt-alpha-auto {
  font-family: var(--nt-mono);
  font-size: 11px;
  color: var(--muted-foreground);
  white-space: nowrap;
}
.nt-budget-col {
  display: flex;
  align-items: center;
  gap: 8px;
}
.nt-budget-track {
  flex: 1;
  min-width: 56px;
  height: 7px;
  border-radius: 2px;
  background: var(--nt-surface-strong);
  border: 1px solid var(--nt-hairline-soft);
  overflow: hidden;
}
.nt-budget-fill {
  height: 100%;
  background: var(--primary);
  border-radius: 1px;
  transition: width .2s ease;
}
.nt-budget-val {
  font-family: var(--nt-mono);
  font-size: 12px;
  color: var(--muted-foreground);
  min-width: 44px;
  text-align: right;
}

@media (min-width: 1800px) {
  .nt-layer-list {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .nt-layer-row:nth-child(odd) {
    border-right: 1px solid var(--nt-hairline-soft);
  }
  .nt-layer-row:last-child {
    border-bottom: 1px solid var(--nt-hairline-soft);
  }
  .nt-layer-row:nth-last-child(1),
  .nt-layer-row:nth-last-child(2):nth-child(odd) {
    border-bottom: 0;
  }
}
@media (max-width: 960px) {
  .nt-layer-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .nt-layer-name-col,
  .nt-budget-col {
    grid-column: 1 / -1;
  }
}
</style>
