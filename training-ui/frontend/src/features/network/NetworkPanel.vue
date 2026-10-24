<script setup lang="ts">
import { computed } from 'vue'
import Field from '@/components/forms/ConfigField.vue'
import { useEditorStore } from '@/stores/editor'
import { AdapterMatrix, Krea2, LayerRank, Moss } from '@/domain/legacy'
import { argumentValue, replaceArgument, section } from '../training/rules'
import Arg from './NetworkArgument.vue'
import LayerRankEditor from './LayerRankEditor.vue'
import { adapterDrafts, resumeDrafts } from './drafts'
const store = useEditorStore()
const n = computed(() => section(store.config, 'network_arguments'))
const t = computed(() => section(store.config, 'training_arguments'))
const moss = computed(() => store.architecture === 'moss_image')
const isolated = computed(() => moss.value || krea.value)
const krea = computed(() => store.architecture === 'krea2')
const moduleName = computed(() => n.value.network_module || '')
const lokr = computed(() => moduleName.value.endsWith('.lokr'))
const lycoris = computed(() => !isolated.value && ['networks.loha','networks.lokr'].includes(moduleName.value))
const dora = computed(() => !isolated.value && ['networks.lora_anima','networks.lokr'].includes(moduleName.value))
const full = computed(() => lokr.value && enabledArg('full_matrix'))
function enabledArg(key: string) { return /^(true|1|yes|y|on)$/i.test((argumentValue(n.value.network_args, key) || '').trim()) }
const layered = computed(() => !isolated.value && ['networks.lora_anima','networks.loha','networks.lokr'].includes(moduleName.value))
const rankDisabled = computed(() => full.value || (layered.value && argumentValue(n.value.network_args, 'layer_configs') !== undefined))
const adapterKeys = ['network_module','network_dim','network_alpha','network_train_unet_only','network_dropout','network_args','network_weights']
const trainingType = computed({ get: () => moduleName.value ? 'lora' : 'full_finetune', set: value => {
  if (value === 'full_finetune') {
    adapterDrafts.set(n.value, Object.fromEntries(adapterKeys.filter(key => Object.hasOwn(n.value, key)).map(key => [key, n.value[key]])))
    for (const key of adapterKeys) delete n.value[key]
    t.value.freeze_llm_adapter ??= true
  } else {
    Object.assign(n.value, adapterDrafts.get(n.value) || { network_module: 'networks.lora_anima', network_dim: 16, network_alpha: 16, network_train_unet_only: true })
    delete t.value.freeze_llm_adapter
  }
} })
function autoResume(value: boolean) {
  if (value) {
    if (n.value.resume) resumeDrafts.set(n.value, n.value.resume)
    delete n.value.resume
  } else if (resumeDrafts.has(n.value)) n.value.resume = resumeDrafts.get(n.value)
}
const selectedModule = computed({ get: () => moduleName.value, set: value => {
  n.value.network_module = value
  if (isolated.value) {
    const incompatible = value.endsWith('.lokr') ? ['loraplus_lr_ratio'] : value === 'networks.loha' ? ['factor','full_matrix','loraplus_lr_ratio'] : ['factor','full_matrix']
    for (const key of incompatible) n.value.network_args = replaceArgument(n.value.network_args, key, undefined)
  }
  if (!['networks.lora_anima','networks.lokr'].includes(value) && !krea.value) {
    for (const key of ['use_dora','dora_scale_fp32']) n.value.network_args = replaceArgument(n.value.network_args, key, undefined)
  }
} })
const dedicated = computed(() => [
  ...(lokr.value ? ['factor','full_matrix'] : []),
  ...(lycoris.value || isolated.value ? ['rank_dropout','module_dropout'] : []),
  ...(lycoris.value ? ['mod_dim','use_tucker'] : []),
  ...(dora.value ? ['use_dora','dora_scale_fp32'] : []),
  ...(krea.value && !lokr.value || moss.value && moduleName.value === Moss.MODULES[0] ? ['loraplus_lr_ratio'] : []),
  ...(layered.value ? ['layer_configs'] : []),
])
const freeArgs = computed({ get: () => (n.value.network_args || []).filter((token: string) => !dedicated.value.includes(token.split('=')[0].trim())).join(' '), set: value => {
  const tokens = LayerRank.tokenize(value)
  // Dedicated controls remain authoritative, as in the legacy form.
  const preserved = (n.value.network_args || []).filter((token: string) => dedicated.value.includes(token.split('=')[0].trim()))
  n.value.network_args = [...preserved, ...tokens.filter((token: string) => !dedicated.value.includes(token.split('=')[0].trim()))]
} })
const modules = computed(() => moss.value ? Moss.MODULES : krea.value ? [Krea2.MODULE,Krea2.LOKR_MODULE] : ['networks.lora_anima','networks.loha','networks.lokr','networks.lora_lumina','networks.lora'])
const preview = computed(() => {
  try { return { rows: AdapterMatrix.preview({ architecture: store.architecture, networkModule: moduleName.value, rank: Number(n.value.network_dim ?? 16), args: n.value.network_args || [] }), error: '' } }
  catch (err) { return { rows: [], error: (err as Error).message } }
})
const previewSupported = computed(() => (krea.value ? modules.value.includes(moduleName.value) : store.architecture === 'anima' && layered.value))
</script>
<template>
  <fieldset class="panel" :disabled="store.locked">
    <h2>Training Type</h2>
    <label class="field">Training Type<select v-model="trainingType" :disabled="isolated"><option value="lora">Adapter (LoRA / LoHa / LoKR)</option><option v-if="!isolated" value="full_finetune">Full Finetune</option></select></label>
    <template v-if="trainingType === 'lora'">
      <h2>Adapter Configuration</h2>
      <div class="fields">
        <label class="field">Network Module<select v-model="selectedModule"><option v-for="name in modules" :key="name">{{ name }}</option><option v-if="moduleName && !modules.includes(moduleName)" :value="moduleName">{{ moduleName }}</option></select></label>
        <Field :object="n" field="network_dim" label="Network Dim (Rank)" type="number" :min="1" :fallback="16" :disabled="rankDisabled" :help="full ? 'Full Matrix 下 Rank 不生效。' : rankDisabled ? 'Block 层采用高级分层设置；此 Rank 值保留。' : '更高 Rank 增加容量与显存。'" />
        <Field :object="n" field="network_alpha" label="Network Alpha" type="number" :min="0.000001" step="any" :fallback="16" help="通常与 Rank 相同；Full Matrix 下缩放固定为 1。" />
        <Arg v-if="lokr" :network="n" name="factor" label="LoKR Factor" type="number" :min="-1" :step="1" help="空值 / -1 自动平衡分解；否则为正整数。" />
        <Arg v-if="lokr" :network="n" name="full_matrix" label="Full Matrix" type="boolean" :fallback="false" help="直接训练完整 Kronecker 因子，忽略 Rank 与 Alpha 缩放；恢复结构由保存矩阵决定。" />
        <Field v-if="!isolated" :object="n" field="network_train_unet_only" label="Train UNet Only" type="boolean" :fallback="true" />
        <Field :object="n" field="network_dropout" label="Network Dropout" type="number" :min="0" :max="isolated ? 0.999 : 1" :step="0.05" :fallback="0" />
        <Arg v-if="dora" :network="n" name="use_dora" :label="lokr ? 'Use DoKr' : 'Use DoRA'" type="boolean" :fallback="false" help="保存 ComfyUI 兼容的 dora_scale 权重。" @change="value => { if (!value) n.network_args = replaceArgument(n.network_args, 'dora_scale_fp32', undefined) }" />
        <Arg v-if="dora && enabledArg('use_dora')" :network="n" name="dora_scale_fp32" label="Save Magnitude Scale in FP32" type="boolean" :fallback="false" />
        <Arg v-if="lycoris" :network="n" name="mod_dim" label="Mod Dim" type="number" :min="0" :step="1" help="AdaLN modulation rank；空值排除。" />
        <Arg v-if="lycoris || isolated" :network="n" name="rank_dropout" label="Rank Dropout" type="number" :min="0" :max="isolated ? 0.999 : 1" :step="0.05" help="LyCORIS 为输出通道 dropout，不是 Rank 维度。" />
        <Arg v-if="lycoris || isolated" :network="n" name="module_dropout" label="Module Dropout" type="number" :min="0" :max="isolated ? 0.999 : 1" :step="0.05" />
        <Arg v-if="lycoris" :network="n" name="use_tucker" label="Use Tucker" type="boolean" :fallback="false" help="用于 Conv2d 3×3；Anima DiT 的 Linear 层不受影响。" />
        <Arg v-if="krea && !lokr || moss && moduleName === Moss.MODULES[0]" :network="n" name="loraplus_lr_ratio" label="LoRA+ LR Ratio" type="number" :min="0.01" step="any" />
      </div>
      <LayerRankEditor v-if="layered" :network="n" :full="full" :disabled="store.locked" />
      <label class="field">Network Args<textarea v-model="freeArgs" rows="3" spellcheck="false" /><small class="muted">空格分隔 key=value；JSON 列表与对象整体保留。专用字段优先。Krea 仅支持当前 adapter 的参数白名单。</small></label>
      <details><summary>全部 Network Args（JSON）</summary><Field :object="n" field="network_args" label="Network Args JSON" type="json" help="可用于修正已有原始参数与 layer_configs；保存时校验。" /></details>
      <details v-if="previewSupported" open>
        <summary>样例层矩阵与参数量</summary>
        <p class="muted">{{ krea ? 'Krea 2 主干宽度 6144。' : 'Anima 2B 标准宽度 2048，应用 Block 0 分层覆盖；未读取实际底模尺寸。' }}</p>
        <p v-if="preview.error" class="error" role="alert">暂无法计算：{{ preview.error }}</p>
        <div class="matrix-scroll"><table><thead><tr><th>样例层</th><th>原始 [输出 × 输入]</th><th>模式</th><th>适配器矩阵</th><th>参数量</th><th>占原始层</th></tr></thead><tbody><tr v-for="row in preview.rows" :key="row.name"><td>{{ row.name }}</td><td>{{ row.output }} × {{ row.input }}</td><td>{{ row.mode }}</td><td><div v-for="matrix in row.matrices" :key="matrix[0]">{{ matrix[0] }}: {{ matrix[1].join(' × ') }}</div></td><td>{{ row.count.toLocaleString('en-US') }}</td><td>{{ row.percent.toFixed(4) }}%</td></tr></tbody></table></div>
        <p class="muted">单层结构示例，非整网统计；不计 Alpha 缓冲与底模 bias。Alpha / Dropout 不影响参数量。筛选目标层或加载已有权重可能改变实际结构。</p>
      </details>
      <Field :object="n" field="network_weights" label="Network Weights (Adapter checkpoint)" help="使用同类型 adapter 初始化；完整训练状态使用下方 Resume。" />
    </template>
    <template v-else><h2>Full Finetune Options</h2><Field :object="t" field="freeze_llm_adapter" label="Freeze LLM Adapter" type="boolean" :fallback="true" help="建议冻结预训练 LLM adapter，避免文本理解退化及 DDP graph 问题。" /></template>
    <h2>Resume Training</h2>
    <Field :object="n" field="auto_resume_last_state" label="Auto-resume from last saved state" type="boolean" :fallback="false" @change="autoResume" />
    <Field :object="n" field="resume" label="Resume State Folder" :disabled="!!n.auto_resume_last_state" help="恢复 optimizer、scheduler 与训练步数；启用自动恢复时忽略手动目录。" />
  </fieldset>
</template>
<style scoped>
.matrix-scroll { overflow-x: auto; margin: 1rem 0; }table { border-collapse: collapse; width: 100%; font-size: .82rem; }th,td { padding: .65rem; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; white-space: nowrap; }td:first-child { white-space: normal; overflow-wrap: anywhere; min-width: 12rem; }
</style>
