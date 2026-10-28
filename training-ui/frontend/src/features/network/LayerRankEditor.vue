<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { LayerRank } from '@/domain/legacy'
import { api } from '@/services/api'
import { argumentValue, replaceArgument } from '../training/rules'
import { layerDrafts } from './drafts'
import FieldHelp from '@/components/forms/FieldHelp.vue'
const props = defineProps<{ network: Record<string, any>; full: boolean; disabled?: boolean }>()
const layers = ref<string[]>([]), message = ref(''), error = ref('')
const draft = ref<any>(null)
let generation = 0, controller: AbortController | undefined, serialized = ''
const raw = computed(() => argumentValue(props.network.network_args, 'layer_configs'))
const active = computed(() => raw.value !== undefined)
const lokr = computed(() => String(props.network.network_module).endsWith('.lokr'))
const rows = computed(() => !draft.value ? [] : draft.value.mode === 'type' ? Object.keys(LayerRank.types) : layers.value)
const groups = computed(() => {
  if (draft.value?.mode !== 'layer') return [{ title: '层类型', names: rows.value }]
  const blocks = new Map<string, string[]>()
  for (const name of rows.value) { const block = name.split('.')[1] || '?'; const list = blocks.get(block) || []; list.push(name); blocks.set(block, list) }
  return [...blocks].map(([block, names]) => ({ title: `Block ${block}`, names }))
})
watch(raw, value => {
  if (value === serialized) return
  error.value = ''
  if (value === undefined) { draft.value = null; return }
  try {
    const cached = layerDrafts.get(props.network)
    draft.value = cached?.source === value ? cached.value : JSON.parse(value)
    if (!draft.value || !['type','layer'].includes(draft.value.mode)) throw Error('不支持的分层配置')
  }
  catch (err) { draft.value = null; error.value = `layer_configs JSON 无效：${(err as Error).message}。原值已保留，可在 Network Args 修正或重置。` }
}, { immediate: true })
watch(() => props.network, () => { controller?.abort(); layers.value = []; generation++; if (active.value) void refresh() }, { immediate: true })
async function refresh() {
  const id = ++generation
  controller?.abort(); controller = new AbortController()
  message.value = '正在读取模型层列表…'
  try {
    const data = await api<{ layers: string[]; block_count: number }>('/api/anima-layers', { signal: controller.signal })
    if (id !== generation) return
    layers.value = data.layers
    message.value = `已读取 ${data.block_count} 个 Block，${data.layers.length} 个可配置层。`
    validate()
  } catch (err) { if (id !== generation || (err as Error).name === 'AbortError') return; message.value = ''; error.value = (err as Error).message }
}
function validate() {
  if (!draft.value) return
  try { LayerRank.validate(LayerRank.compact(draft.value, lokr.value), layers.value); error.value = '' }
  catch (err) { error.value = (err as Error).message }
}
function commit() {
  serialized = JSON.stringify(LayerRank.compact(draft.value, lokr.value))
  layerDrafts.set(props.network, { source: serialized, value: draft.value })
  props.network.network_args = replaceArgument(props.network.network_args, 'layer_configs', serialized)
  validate()
}
function toggle(event: Event) {
  if (!(event.target as HTMLInputElement).checked) { props.network.network_args = replaceArgument(props.network.network_args, 'layer_configs', undefined); return }
  const cached = layerDrafts.get(props.network)
  if (cached) { draft.value = cached.value; commit(); void refresh() }
  else reset()
}
function reset() {
  draft.value = LayerRank.create(props.network.network_dim ?? 16, Number(argumentValue(props.network.network_args, 'factor') ?? -1))
  commit(); void refresh()
}
function values(name: string) { return LayerRank.resolve(draft.value, name, draft.value.mode === 'type') }
function edit(name: string, key: string, event: Event) {
  const group = draft.value.mode === 'type' ? 'types' : 'layers'
  draft.value[group] ||= {}; draft.value[group][name] ||= {}
  const input = event.target as HTMLInputElement
  const value = key === 'enabled' ? input.checked : input.value === '' ? null : Number(input.value)
  draft.value[group][name][key] = value
  if (key === 'alpha' && value === values(name).rank) delete draft.value[group][name].alpha
  commit()
}
onBeforeUnmount(() => { generation++; controller?.abort() })
</script>
<template>
  <section class="layer-editor">
    <label><input type="checkbox" :checked="active" :disabled="disabled" @change="toggle" /> 高级分层设置 <FieldHelp field="layer_configs" label="高级分层设置" /></label>
    <template v-if="active">
      <div class="layer-actions"><label v-if="draft"><span class="field-label-row">配置模式<FieldHelp field="layer_mode" label="配置模式" /></span><select v-model="draft.mode" :disabled="disabled" @change="commit"><option value="type">按层类型</option><option value="layer">按单个层</option></select></label><button class="button" type="button" @click="refresh">重新读取模型</button><button class="button" type="button" :disabled="disabled" @click="reset">重置为原 Rank</button></div>
      <p class="muted">仅配置 DiT Block，优先于全局 Alpha、Factor 和旧的 Block 配置。Alpha 默认随 Rank 变化；切换模式只应用当前模式，另一模式草稿暂存于此页面。</p>
      <p v-if="full" class="muted">Full Matrix 下 Rank / Alpha 不生效；训练开关和 Factor 仍生效。</p>
      <p role="status">{{ message }}</p><p v-if="error" class="error" role="alert">{{ error }}</p>
      <template v-if="draft">
        <div class="fields"><label class="field"><span class="field-label-row">默认 Rank<FieldHelp field="layer_rank" label="默认 Rank" /></span><input v-model.number="draft.default_rank" type="number" min="1" :disabled="disabled || full" @input="commit" /></label><label v-if="lokr" class="field"><span class="field-label-row">默认 Factor<FieldHelp field="layer_factor" label="默认 Factor" /></span><input v-model.number="draft.default_factor" type="number" min="-1" :disabled="disabled" @input="commit" /></label></div>
        <details v-for="(group, i) in groups" :key="group.title" :open="i === 0"><summary>{{ group.title }}</summary>
          <div v-for="name in group.names" :key="name" class="layer-row">
            <span>{{ draft.mode === 'type' ? LayerRank.types[name] : name }}</span>
            <label><input type="checkbox" :checked="values(name).enabled" :disabled="disabled" @change="edit(name, 'enabled', $event)" /> 训练 <FieldHelp field="layer_enabled" :label="`${name} 训练`" /></label>
            <label v-for="key in (lokr ? ['rank','alpha','factor'] : ['rank','alpha'])" :key="key"><span class="field-label-row">{{ key }}<FieldHelp :field="`layer_${key}`" :label="`${name} ${key}`" /></span><input type="number" :aria-label="`${name} ${key}`" :value="values(name)[key]" :min="key === 'factor' ? -1 : key === 'alpha' ? 0.000001 : 1" :step="key === 'alpha' ? 'any' : 1" :disabled="disabled || !values(name).enabled || (full && key !== 'factor')" @input="edit(name, key, $event)" /></label>
          </div>
        </details>
      </template>
    </template>
  </section>
</template>
<style scoped>
.layer-editor { margin: 1rem 0; padding: 1rem; border: 1px solid var(--border); border-radius: .5rem; }
.layer-actions { display: flex; flex-wrap: wrap; align-items: end; gap: .75rem; margin: .75rem 0; }
.layer-actions label { display: grid; gap: .25rem; }
.layer-row { display: grid; grid-template-columns: minmax(15rem, 2fr) repeat(4,minmax(5rem, 1fr)); gap: .5rem; align-items: center; padding: .5rem 0; border-bottom: 1px solid var(--border); }
.layer-row span { overflow-wrap: anywhere; }.layer-row label { display: grid; gap: .25rem; }.layer-row input[type=number] { width: 100%; min-width: 0; }
@media(max-width: 900px) { .layer-row { grid-template-columns: repeat(2,minmax(0,1fr)); }.layer-row span { grid-column: 1 / -1; } }
</style>
