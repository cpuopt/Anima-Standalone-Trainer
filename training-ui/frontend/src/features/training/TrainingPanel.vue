<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import MossTrainingPanel from './MossTrainingPanel.vue'
import RunTimeline from './RunTimeline.vue'
import LearningRateControl from './LearningRateControl.vue'
import TimestepSparkline from './TimestepSparkline.vue'
import { useEditorStore } from '@/stores/editor'
import Field from '@/components/forms/ConfigField.vue'
import FieldHelp from '@/components/forms/FieldHelp.vue'
import { provideFieldHelp } from '@/components/forms/help-context'
import { Krea2 } from '@/domain/training'
import { activationOffload, argumentValue, parallelMode, replaceArgument, section, selectDuration, selectOptimizer, setActivationOffload } from './rules'
import type { TimelineParams } from './timeline'

const store = useEditorStore()
provideFieldHelp('training')
const rootEl = ref<HTMLElement | null>(null)
const t = computed(() => section(store.config, 'training_arguments'))
const krea = computed(() => store.architecture === 'krea2')
const canUseMuon = computed(() => store.architecture === 'anima' && !store.config.network_arguments?.network_module)
const muonEnabled = computed(() => canUseMuon.value && t.value.use_muon === true)
watch(() => t.value.cache_text_encoder_variants, enabled => {
  if (enabled && store.architecture === 'anima') t.value.cache_text_encoder_outputs_to_disk = true
}, { immediate: true })
const model = computed(() => {
  const key = store.registry?.architectures?.[store.architecture]?.training_section || (krea.value ? 'krea2_arguments' : 'anima_arguments')
  return section(store.config, key)
})
const duration = computed({ get: () => t.value.max_train_steps > 0 ? 'steps' : 'epochs', set: value => selectDuration(t.value, value) })
const optimizer = computed({ get: () => t.value.optimizer_type || 'AdamW8bit', set: value => selectOptimizer(t.value, value, krea.value) })
const weightDecay = computed({ get: () => argumentValue(t.value.optimizer_args, 'weight_decay') ?? '0', set: value => { t.value.optimizer_args = replaceArgument(t.value.optimizer_args, 'weight_decay', value) } })
const decouple = computed({ get: () => !/^false$/i.test(argumentValue(t.value.optimizer_args, 'decouple') ?? 'true'), set: value => { t.value.optimizer_args = replaceArgument(t.value.optimizer_args, 'decouple', value ? 'True' : 'False') } })
const offload = computed({ get: () => activationOffload(t.value, krea.value), set: value => setActivationOffload(t.value, value, krea.value) })
const attention = computed({ get: () => t.value.flash_attn ? 'flash' : t.value.xformers ? 'xformers' : 'sdpa', set: value => { t.value.sdpa = value === 'sdpa'; t.value.flash_attn = value === 'flash'; t.value.xformers = value === 'xformers' } })
const fp8 = computed({ get: () => !!t.value.fp8_scaled, set: value => { t.value.fp8_base = t.value.fp8_scaled = value } })
const multi = computed(() => (String(store.config.gpu_ids || '').trim() ? String(store.config.gpu_ids).split(',').filter(Boolean).length : store.gpus.length) > 1)
const fsdp = computed(() => !krea.value && multi.value && ['fsdp','fsdp2'].includes(parallelMode(t.value)))
const compileLocked = computed(() => !krea.value && (t.value.use_cuda_direct || (multi.value && parallelMode(t.value) === 'tp_sp')))
const optimizers = ['AdamW8bit','AdamW','PagedAdamW','PagedAdamW8bit','PagedAdamW32bit','Adafactor','Lion8bit','PagedLion8bit','SGDNesterov8bit','Prodigy','AdamWScheduleFree','RAdamScheduleFree','SGDScheduleFree']
const schedulers = ['cosine','constant','linear','cosine_with_restarts','cosine_with_min_lr','polynomial']

function checkpointChanged(event: Event) {
  t.value.gradient_checkpointing = (event.target as HTMLInputElement).checked
  if (!t.value.gradient_checkpointing) setActivationOffload(t.value, 'none', krea.value)
}

const timelineParams = computed<TimelineParams>(() => ({
  architecture: store.architecture,
  learningRate: Number(t.value.learning_rate ?? 0.00005),
  textEncoderLr: krea.value ? undefined : Number(t.value.text_encoder_lr ?? 0.00005),
  optimizerType: optimizer.value,
  scheduler: String(t.value.lr_scheduler ?? (krea.value ? 'constant' : 'cosine')),
  warmupUnit: !krea.value && t.value.lr_warmup_unit === 'epochs' ? 'epochs' : 'steps',
  warmupSteps: Number(t.value.lr_warmup_steps ?? (krea.value ? 0 : 100)),
  warmupEpochs: Number(t.value.lr_warmup_epochs ?? 1),
  numCycles: Number(t.value.lr_scheduler_num_cycles ?? 1),
  minLrRatio: Number(t.value.lr_scheduler_min_lr_ratio ?? 0),
  power: t.value.lr_scheduler_power !== undefined ? Number(t.value.lr_scheduler_power) : undefined,
  durationUnit: duration.value === 'steps' ? 'steps' : 'epochs',
  maxEpochs: Number(t.value.max_train_epochs ?? 20),
  saveEveryNEpochs: Number(t.value.save_every_n_epochs ?? 1),
  maxSteps: Number(t.value.max_train_steps ?? 1000),
  saveEveryNSteps: Number(t.value.save_every_n_steps ?? 500),
  outputName: String(t.value.output_name ?? 'my_anima_lora'),
  saveModelAs: krea.value ? undefined : String(t.value.save_model_as ?? 'safetensors'),
  savePrecision: String(t.value.save_precision ?? 'bf16'),
  mixedPrecision: String(t.value.mixed_precision ?? 'bf16'),
}))

const schedMeta = computed(() => duration.value === 'steps'
  ? `${t.value.max_train_steps ?? 1000} steps`
  : `${t.value.max_train_epochs ?? 20} epochs`)

const perfMeta = computed(() => {
  const mp = String(t.value.mixed_precision ?? 'bf16')
  if (offload.value !== 'none') return `${mp} · ${offload.value}`
  if (Number(t.value.blocks_to_swap ?? 0) > 0) return `${mp} · swap ${t.value.blocks_to_swap}`
  return mp
})

const timestepMethod = computed(() => String(krea.value ? (model.value.timestep_sampling ?? 'krea2_shift') : (model.value.timestep_sample_method ?? 'logit_normal')))
const flowShift = computed(() => Number(model.value.discrete_flow_shift ?? (krea.value ? 2.5 : 3)))

function focusField(field: string) {
  const host = rootEl.value
  if (!host) return
  const target = host.querySelector(`[data-tt-field="${field}"]`) as HTMLElement | null
  if (!target) return
  target.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
  if (!store.locked) {
    const control = target.querySelector('input, select, textarea, [role="combobox"]') as HTMLElement | null
    control?.focus?.({ preventScroll: true })
  }
  target.classList.remove('tt-field-flash')
  void target.offsetWidth
  target.classList.add('tt-field-flash')
  window.setTimeout(() => target.classList.remove('tt-field-flash'), 1200)
}
</script>

<template>
  <MossTrainingPanel v-if="store.architecture === 'moss_image'" />
  <fieldset v-else ref="rootEl" class="tt-panel" :disabled="store.locked">
    <RunTimeline :params="timelineParams" @focus-field="focusField" />

    <div class="tt-columns">
      <section class="tt-col" aria-label="Optimization">
        <div class="tt-col-head">
          <h2>Optimization</h2>
          <span class="tt-col-meta">{{ muonEnabled ? 'Muon + AdamW' : optimizer }}</span>
        </div>
        <div class="tt-fields">
          <LearningRateControl :object="t" field="learning_rate" label="Learning Rate" :fallback="0.00005" />
          <Field v-if="!krea" :object="t" field="text_encoder_lr" label="Text Encoder LR" type="number" :step="'any'" :fallback="0.00005" data-tt-field="text_encoder_lr" />
          <Field v-if="canUseMuon" :object="t" field="use_muon" label="Muon + AdamW（单 GPU）" type="boolean" data-tt-field="use_muon" />
          <label v-if="!muonEnabled" class="field" data-tt-field="optimizer_type"><span class="field-label-row">Optimizer<FieldHelp field="optimizer_type" label="Optimizer" /></span><select v-model="optimizer"><option v-for="name in (krea ? Krea2.OPTIMIZERS : optimizers)" :key="name">{{ name }}</option></select></label>
          <Field :object="t" field="lr_scheduler" label="LR Scheduler" type="select" :options="schedulers" fallback="cosine" data-tt-field="lr_scheduler" />
          <Field v-if="t.lr_scheduler === 'cosine_with_restarts' || t.lr_scheduler === 'cosine_with_min_lr'" :object="t" field="lr_scheduler_num_cycles" label="Restart Cycles" type="number" :min="1" :step="1" :fallback="1" data-tt-field="lr_scheduler_num_cycles" />
          <Field v-if="t.lr_scheduler === 'cosine_with_min_lr'" :object="t" field="lr_scheduler_min_lr_ratio" label="Min LR Ratio" type="number" :min="0" :max="1" :step="0.01" :fallback="0" data-tt-field="lr_scheduler_min_lr_ratio" />
          <Field v-if="!krea" :object="t" field="lr_warmup_unit" label="LR Warmup Unit" type="select" :options="[{value:'steps',label:'Steps'},{value:'epochs',label:'Epochs'}]" fallback="steps" data-tt-field="lr_warmup_unit" />
          <Field v-if="!krea && t.lr_warmup_unit === 'epochs'" :object="t" field="lr_warmup_epochs" label="LR Warmup Epochs" type="number" :min="0" step="any" :fallback="1" data-tt-field="lr_warmup_epochs" />
          <Field v-else :object="t" field="lr_warmup_steps" label="LR Warmup Steps" type="number" :min="0" :fallback="100" data-tt-field="lr_warmup_steps" />
          <label v-if="!muonEnabled" class="field" data-tt-field="weight_decay"><span class="field-label-row">Weight Decay<FieldHelp field="weight_decay" label="Weight Decay" /></span><input v-model="weightDecay" type="number" min="0" step="any" /></label>
          <label v-if="!muonEnabled && /Prodigy|DAdapt/.test(optimizer)" class="field field-check" data-tt-field="decouple"><span><input v-model="decouple" type="checkbox" /> Decouple Weight Decay <FieldHelp field="decouple" label="Decouple Weight Decay" /></span></label>
          <Field :object="t" field="seed" label="Seed" type="number" :fallback="42" data-tt-field="seed" />
        </div>
        <details v-if="muonEnabled" class="tt-details">
          <summary>Muon 参数</summary>
          <Field :object="t" field="muon_lr" label="Muon 学习率" type="number" step="any" :fallback="0.02" />
          <Field :object="t" field="muon_lr_scale" label="Muon 学习率倍率" type="number" step="any" :fallback="0.05" />
          <Field :object="t" field="muon_momentum" label="Muon 动量" type="number" step="any" :fallback="0.95" />
          <Field :object="t" field="muon_weight_decay" label="Muon 权重衰减" type="number" step="any" :fallback="0.01" />
          <Field :object="t" field="muon_ns_steps" label="Newton–Schulz 迭代步数" type="number" :min="1" :step="1" :fallback="5" />
        </details>
        <details v-else class="tt-details"><summary>Optimizer Args</summary><Field :object="t" field="optimizer_args" label="Optimizer Args (JSON array)" type="json" help="保留全部已有参数；切换优化器时仅共用 weight_decay，其他参数按优化器暂存，切回时恢复。" /></details>
      </section>

      <section class="tt-col" aria-label="Training Schedule">
        <div class="tt-col-head">
          <h2>Training Schedule</h2>
          <span class="tt-col-meta">{{ schedMeta }}</span>
        </div>
        <div class="tt-fields">
          <label class="field" data-tt-field="duration_unit"><span class="field-label-row">Duration Unit<FieldHelp field="duration_unit" label="Duration Unit" /></span><select v-model="duration"><option value="epochs">Epochs</option><option value="steps">Steps</option></select></label>
          <template v-if="duration === 'epochs'">
            <Field :object="t" field="max_train_epochs" label="Max Epochs" type="number" :min="1" :fallback="20" data-tt-field="max_train_epochs" />
            <Field :object="t" field="save_every_n_epochs" label="Save Every N Epochs" type="number" :min="1" :fallback="1" data-tt-field="save_every_n_epochs" />
          </template>
          <template v-else>
            <Field :object="t" field="max_train_steps" label="Max Steps" type="number" :min="1" :fallback="1000" data-tt-field="max_train_steps" />
            <Field :object="t" field="save_every_n_steps" label="Save Every N Steps" type="number" :min="1" :fallback="500" data-tt-field="save_every_n_steps" />
          </template>
          <Field :object="t" field="output_name" label="Output Name" fallback="my_anima_lora" data-tt-field="output_name" />
          <Field v-if="!krea" :object="t" field="save_model_as" label="Save Format" type="select" :options="['safetensors','ckpt']" fallback="safetensors" data-tt-field="save_model_as" />
        </div>

        <template v-if="krea">
          <div class="tt-col-head tt-subhead">
            <h2>Krea 2</h2>
            <span class="tt-col-meta">RAW</span>
          </div>
          <div class="tt-fields">
            <label class="field field-check" data-tt-field="fp8_scaled"><span><input v-model="fp8" type="checkbox" /> Dynamic Scaled FP8 <FieldHelp field="fp8_scaled" label="Dynamic Scaled FP8" /></span><small class="muted">使用原始 bf16 模型文件。</small></label>
            <label class="field" data-tt-field="attention"><span class="field-label-row">Attention<FieldHelp field="attention" label="Attention" /></span><select v-model="attention"><option value="sdpa">SDPA</option><option value="flash">FlashAttention</option><option value="xformers">xformers</option></select></label>
            <Field :object="t" field="split_attn" label="Split Attention" type="boolean" :fallback="false" data-tt-field="split_attn" />
            <Field :object="model" field="text_encoder_batch_size" label="Text Encoder Cache Batch" type="number" :min="1" :fallback="1" data-tt-field="text_encoder_batch_size" />
          </div>
        </template>
      </section>

      <section class="tt-col" aria-label="Performance">
        <div class="tt-col-head">
          <h2>Performance</h2>
          <span class="tt-col-meta">{{ perfMeta }}</span>
        </div>
        <div class="tt-fields">
          <Field :object="t" field="mixed_precision" label="Mixed Precision" type="select" :options="krea ? ['bf16'] : ['bf16','fp16','no']" fallback="bf16" data-tt-field="mixed_precision" />
          <Field :object="t" field="save_precision" label="Save Precision" type="select" :options="['bf16','fp16','float']" fallback="bf16" data-tt-field="save_precision" />
          <Field :object="t" field="gradient_accumulation_steps" label="Gradient Accumulation Steps" type="number" :min="1" :fallback="1" data-tt-field="gradient_accumulation_steps" />
          <Field :object="t" field="max_data_loader_n_workers" label="DataLoader Workers" type="number" :min="0" :max="16" :fallback="4" data-tt-field="max_data_loader_n_workers" @change="value => { if (value === 0) t.persistent_data_loader_workers = false }" />
          <Field :object="t" field="persistent_data_loader_workers" label="Persistent DataLoader Workers" type="boolean" :fallback="true" :disabled="t.max_data_loader_n_workers === 0" data-tt-field="persistent_data_loader_workers" />
          <label class="field field-check" data-tt-field="gradient_checkpointing"><span><input type="checkbox" :checked="t.gradient_checkpointing ?? true" @change="checkpointChanged" /> Gradient Checkpointing <FieldHelp field="gradient_checkpointing" label="Gradient Checkpointing" /></span><small class="muted">以计算换显存；关闭时一并关闭 activation offload。</small></label>
          <Field v-if="!krea" :object="t" field="flash_attn" label="Flash Attention" type="boolean" :fallback="false" help="需要安装 flash-attn。" data-tt-field="flash_attn" />
          <Field :object="t" :field="krea ? 'compile' : 'torch_compile'" label="Torch Compile" type="boolean" :fallback="false" :disabled="compileLocked" :help="krea ? '首次编译较慢；需匹配的编译依赖，与卸载、FP8 组合请实测。' : '首次编译较慢；CUDA Direct 与 TP/SP 模式不可使用。'" :data-tt-field="krea ? 'compile' : 'torch_compile'" />
          <Field v-if="!krea" :object="t" field="lowram" label="Low RAM Optimization" type="boolean" :fallback="false" data-tt-field="lowram" />
          <Field :object="t" field="blocks_to_swap" label="Blocks to Swap" type="number" :min="0" :max="26" :fallback="0" :disabled="fsdp || (!krea && offload !== 'none')" data-tt-field="blocks_to_swap" />
          <label class="field" data-tt-field="activation_offload"><span class="field-label-row">Activation Offload<FieldHelp field="activation_offload" label="Activation Offload" /></span><select v-model="offload" :disabled="fsdp"><option value="none">None</option><option value="cpu">CPU Offload</option><option v-if="!krea" value="unsloth">Unsloth Offload</option></select><small class="muted">需要 Gradient Checkpointing；Anima 与手动 Block Swap 互斥。</small></label>
        </div>
      </section>

      <section class="tt-col" aria-label="Caching & Timesteps">
        <div class="tt-col-head">
          <h2>Caching &amp; Timesteps</h2>
          <span class="tt-col-meta">shift {{ flowShift }}</span>
        </div>
        <p v-if="krea" class="muted tt-col-note">Krea 2 自动缓存 latents 与 text embeddings。训练 RAW，训练中预览使用 RAW；独立采样可在 Prompts 选择 RAW / Turbo。</p>
        <div class="tt-fields">
          <Field v-if="!krea" :object="t" field="cache_latents_to_disk" label="Cache Latents to Disk" type="boolean" :fallback="true" data-tt-field="cache_latents_to_disk" />
          <Field :object="krea ? model : t" field="vae_batch_size" label="VAE Cache Batch Size" type="number" :min="1" :max="32" :fallback="1" data-tt-field="vae_batch_size" />
          <Field v-if="!krea" :object="t" field="cache_text_encoder_outputs_to_disk" label="Cache Text Encoder Outputs to Disk" type="boolean" :fallback="true" data-tt-field="cache_text_encoder_outputs_to_disk" />
          <Field v-if="store.architecture === 'anima'" :object="t" field="cache_text_encoder_variants" label="按图片 / 轮次 / 重复次数缓存文本变体" type="boolean" data-tt-field="cache_text_encoder_variants" />
          <Field :object="model" :field="krea ? 'timestep_sampling' : 'timestep_sample_method'" label="Timestep Sample Method" type="select" :options="krea ? Krea2.TIMESTEPS : ['logit_normal','uniform']" :fallback="krea ? 'krea2_shift' : 'logit_normal'" data-tt-field="timestep_sample_method" />
          <Field :object="model" field="discrete_flow_shift" label="Flow Shift" type="number" :step="0.1" :min="0" :fallback="krea ? 2.5 : 3" :disabled="krea && model.timestep_sampling === 'krea2_shift'" data-tt-field="discrete_flow_shift" />
        </div>
        <TimestepSparkline :method="timestepMethod" :shift="flowShift" />
      </section>
    </div>
  </fieldset>
</template>
