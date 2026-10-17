<script setup lang="ts">
import { computed } from 'vue'
import { useEditorStore } from '@/stores/editor'
import Field from '@/components/forms/ConfigField.vue'
import { Krea2 } from '@/domain/legacy'
import { activationOffload, argumentValue, parallelMode, replaceArgument, section, selectDuration, selectOptimizer, setActivationOffload } from './rules'

const store = useEditorStore()
const t = computed(() => section(store.config, 'training_arguments'))
const krea = computed(() => store.architecture === 'krea2')
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
</script>

<template>
  <fieldset class="panel" :disabled="store.locked">
    <h2>Optimization</h2>
    <div class="fields">
      <Field :object="t" field="learning_rate" label="Learning Rate" type="number" :step="'any'" :fallback="0.00005" />
      <Field v-if="!krea" :object="t" field="text_encoder_lr" label="Text Encoder LR" type="number" :step="'any'" :fallback="0.00005" />
      <label class="field">Optimizer<select v-model="optimizer"><option v-for="name in (krea ? Krea2.OPTIMIZERS : optimizers)" :key="name">{{ name }}</option></select></label>
      <Field :object="t" field="lr_scheduler" label="LR Scheduler" type="select" :options="schedulers" fallback="cosine" />
      <Field :object="t" field="lr_warmup_steps" label="LR Warmup Steps" type="number" :min="0" :fallback="100" />
      <label class="field">Weight Decay<input v-model="weightDecay" type="number" min="0" step="any" /></label>
      <Field :object="t" field="seed" label="Seed" type="number" :fallback="42" />
      <Field v-if="t.lr_scheduler === 'cosine_with_restarts'" :object="t" field="lr_scheduler_num_cycles" label="Restart Cycles" type="number" :min="1" :fallback="1" />
      <Field v-if="t.lr_scheduler === 'cosine_with_min_lr'" :object="t" field="lr_scheduler_min_lr_ratio" label="Min LR Ratio" type="number" :min="0" :max="1" :step="0.01" :fallback="0" />
      <label v-if="/Prodigy|DAdapt/.test(optimizer)" class="field"><span><input v-model="decouple" type="checkbox" /> Decouple Weight Decay</span></label>
    </div>
    <details><summary>Optimizer Args</summary><Field :object="t" field="optimizer_args" label="Optimizer Args (JSON array)" type="json" help="保留全部已有参数；切换优化器时仅共用 weight_decay，其他参数按优化器暂存，切回时恢复。" /></details>

    <h2>Training Schedule</h2>
    <div class="fields">
      <label class="field">Duration Unit<select v-model="duration"><option value="epochs">Epochs</option><option value="steps">Steps</option></select></label>
      <template v-if="duration === 'epochs'">
        <Field :object="t" field="max_train_epochs" label="Max Epochs" type="number" :min="1" :fallback="20" />
        <Field :object="t" field="save_every_n_epochs" label="Save Every N Epochs" type="number" :min="1" :fallback="1" />
      </template>
      <template v-else>
        <Field :object="t" field="max_train_steps" label="Max Steps" type="number" :min="1" :fallback="1000" />
        <Field :object="t" field="save_every_n_steps" label="Save Every N Steps" type="number" :min="1" :fallback="500" />
      </template>
      <Field :object="t" field="output_name" label="Output Name" fallback="my_anima_lora" />
      <Field v-if="!krea" :object="t" field="save_model_as" label="Save Format" type="select" :options="['safetensors','ckpt']" fallback="safetensors" />
    </div>

    <h2>Performance</h2>
    <div class="fields">
      <Field :object="t" field="mixed_precision" label="Mixed Precision" type="select" :options="krea ? ['bf16'] : ['bf16','fp16','no']" fallback="bf16" />
      <Field :object="t" field="save_precision" label="Save Precision" type="select" :options="['bf16','fp16','float']" fallback="bf16" />
      <Field :object="t" field="max_data_loader_n_workers" label="DataLoader Workers" type="number" :min="0" :max="16" :fallback="4" @change="value => { if (value === 0) t.persistent_data_loader_workers = false }" />
      <Field :object="t" field="gradient_accumulation_steps" label="Gradient Accumulation Steps" type="number" :min="1" :fallback="1" />
      <Field :object="t" field="persistent_data_loader_workers" label="Persistent DataLoader Workers" type="boolean" :fallback="true" :disabled="t.max_data_loader_n_workers === 0" />
      <label class="field"><span><input type="checkbox" :checked="t.gradient_checkpointing ?? true" @change="checkpointChanged" /> Gradient Checkpointing</span><small class="muted">以计算换显存；关闭时一并关闭 activation offload。</small></label>
      <Field v-if="!krea" :object="t" field="flash_attn" label="Flash Attention" type="boolean" :fallback="false" help="需要安装 flash-attn。" />
      <Field :object="t" :field="krea ? 'compile' : 'torch_compile'" label="Torch Compile" type="boolean" :fallback="false" :disabled="compileLocked" help="首次编译较慢；CUDA Direct 与 TP/SP 模式不可使用。" />
      <Field v-if="!krea" :object="t" field="lowram" label="Low RAM Optimization" type="boolean" :fallback="false" />
      <Field :object="t" field="blocks_to_swap" label="Blocks to Swap" type="number" :min="0" :max="26" :fallback="0" :disabled="fsdp || (!krea && offload !== 'none')" />
      <label class="field">Activation Offload<select v-model="offload" :disabled="fsdp"><option value="none">None</option><option value="cpu">CPU Offload</option><option v-if="!krea" value="unsloth">Unsloth Offload</option></select><small class="muted">需要 Gradient Checkpointing；Anima 与手动 Block Swap 互斥。</small></label>
    </div>
    <h2>Caching &amp; Timesteps</h2>
    <p v-if="krea" class="muted">Krea 2 自动缓存 latents 与 text embeddings。训练 RAW，训练中预览使用 RAW；独立采样可在 Prompts 选择 RAW / Turbo。</p>
    <div class="fields">
      <Field v-if="!krea" :object="t" field="cache_latents_to_disk" label="Cache Latents to Disk" type="boolean" :fallback="true" />
      <Field :object="krea ? model : t" field="vae_batch_size" label="VAE Cache Batch Size" type="number" :min="1" :max="32" :fallback="1" />
      <Field v-if="!krea" :object="t" field="cache_text_encoder_outputs_to_disk" label="Cache Text Encoder Outputs to Disk" type="boolean" :fallback="true" />
      <Field :object="model" :field="krea ? 'timestep_sampling' : 'timestep_sample_method'" label="Timestep Sample Method" type="select" :options="krea ? Krea2.TIMESTEPS : ['logit_normal','uniform']" :fallback="krea ? 'krea2_shift' : 'logit_normal'" />
      <Field :object="model" field="discrete_flow_shift" label="Flow Shift" type="number" :step="0.1" :min="0" :fallback="krea ? 2.5 : 3" :disabled="krea && model.timestep_sampling === 'krea2_shift'" />
    </div>
    <template v-if="krea">
      <h2>Krea 2</h2><div class="fields">
        <label class="field"><span><input v-model="fp8" type="checkbox" /> Dynamic Scaled FP8</span><small class="muted">使用原始 bf16 模型文件。</small></label>
        <label class="field">Attention<select v-model="attention"><option value="sdpa">SDPA</option><option value="flash">FlashAttention</option><option value="xformers">xformers</option></select></label>
        <Field :object="t" field="split_attn" label="Split Attention" type="boolean" :fallback="false" />
        <Field :object="model" field="text_encoder_batch_size" label="Text Encoder Cache Batch" type="number" :min="1" :fallback="1" />
      </div>
    </template>
  </fieldset>
</template>
