<script setup lang="ts">
import { computed, ref } from 'vue'
import Field from '@/components/forms/ConfigField.vue'
import FieldHelp from '@/components/forms/FieldHelp.vue'
import { provideFieldHelp } from '@/components/forms/help-context'
import { useEditorStore } from '@/stores/editor'
import { Moss } from '@/domain/training'
import { section, selectDuration } from './rules'
import RunTimeline from './RunTimeline.vue'
import LearningRateControl from './LearningRateControl.vue'
import TimestepSparkline from './TimestepSparkline.vue'
import type { TimelineParams } from './timeline'

const store = useEditorStore()
provideFieldHelp('training')
const rootEl = ref<HTMLElement | null>(null)
const t = computed(() => section(store.config, 'training_arguments'))
const m = computed(() => section(store.config, 'moss_arguments'))
const duration = computed({ get: () => t.value.max_train_steps ? 'steps' : 'epochs', set: value => selectDuration(t.value, value) })

const timelineParams = computed<TimelineParams>(() => ({
  architecture: 'moss_image',
  learningRate: Number(t.value.learning_rate ?? 0.0001),
  optimizerType: String(t.value.optimizer_type ?? 'AdamW8bit'),
  scheduler: String(t.value.lr_scheduler ?? 'constant'),
  warmupUnit: 'steps',
  warmupSteps: Number(t.value.lr_warmup_steps ?? 0),
  warmupEpochs: 0,
  numCycles: Number(t.value.lr_scheduler_num_cycles ?? 1),
  minLrRatio: Number(t.value.lr_scheduler_min_lr_ratio ?? 0),
  durationUnit: duration.value === 'steps' ? 'steps' : 'epochs',
  maxEpochs: Number(t.value.max_train_epochs ?? 10),
  saveEveryNEpochs: Number(t.value.save_every_n_epochs ?? 1),
  maxSteps: Number(t.value.max_train_steps ?? 1000),
  saveEveryNSteps: Number(t.value.save_every_n_steps ?? 500),
  outputName: String(t.value.output_name ?? 'moss_lora'),
  savePrecision: String(t.value.save_precision ?? 'bf16'),
  mixedPrecision: 'bf16',
}))

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
  <fieldset ref="rootEl" class="tt-panel" :disabled="store.locked">
    <RunTimeline :params="timelineParams" @focus-field="focusField" />

    <div class="tt-columns tt-columns-3">
      <section class="tt-col" aria-label="MOSS-Image 优化与调度">
        <div class="tt-col-head">
          <h2>MOSS-Image · 隔离 sd-scripts 后端</h2>
          <span class="tt-col-meta">{{ m.flavour || 'base' }}</span>
        </div>
        <p class="muted tt-col-note">单卡、BF16、仅训练 DiT。默认 512 / batch 1；实际显存取决于模型、caption 长度及适配器。冻结 Qwen3.5-9B。训练中采样在提示词页设置。</p>
        <div class="tt-fields">
          <Field :object="m" field="flavour" label="底模" type="select" :options="['base','sft']" data-tt-field="flavour" />
          <Field :object="t" field="output_name" label="Output Name" data-tt-field="output_name" />
          <LearningRateControl :object="t" field="learning_rate" label="Learning Rate" :fallback="0.0001" />
          <Field :object="t" field="optimizer_type" label="Optimizer" type="select" :options="Moss.OPTIMIZERS" data-tt-field="optimizer_type" />
          <Field :object="t" field="lr_scheduler" label="LR Scheduler" type="select" :options="Moss.SCHEDULERS" data-tt-field="lr_scheduler" />
          <Field :object="t" field="lr_warmup_steps" label="Warmup Steps" type="number" :min="0" data-tt-field="lr_warmup_steps" />
          <Field :object="t" field="lr_scheduler_num_cycles" label="Scheduler Cycles" type="number" :min="1" data-tt-field="lr_scheduler_num_cycles" />
          <Field :object="t" field="lr_scheduler_min_lr_ratio" label="Min LR Ratio" type="number" :min="0" :max="1" step="any" data-tt-field="lr_scheduler_min_lr_ratio" />
          <label class="field" data-tt-field="duration_unit"><span class="field-label-row">Duration<FieldHelp field="duration_unit" label="Duration" /></span><select v-model="duration"><option value="epochs">Epochs</option><option value="steps">Steps</option></select></label>
          <Field :object="t" :field="duration==='steps'?'max_train_steps':'max_train_epochs'" label="Training Duration" type="number" :min="1" :data-tt-field="duration==='steps'?'max_train_steps':'max_train_epochs'" />
          <Field :object="t" :field="duration==='steps'?'save_every_n_steps':'save_every_n_epochs'" label="Save Every N" type="number" :min="1" :data-tt-field="duration==='steps'?'save_every_n_steps':'save_every_n_epochs'" />
          <Field v-for="[key,label] in [['seed','Seed'],['gradient_accumulation_steps','Gradient Accumulation'],['max_grad_norm','Max Grad Norm'],['max_data_loader_n_workers','DataLoader Workers'],['vae_batch_size','VAE Cache Batch']]" :key="key" :object="t" :field="key!" :label="label!" type="number" :min="0" :data-tt-field="key" />
          <Field :object="t" field="save_precision" label="Save Precision" type="select" :options="['bf16','fp16','float']" data-tt-field="save_precision" />
        </div>
        <details class="tt-details"><summary>Optimizer Args</summary><Field :object="t" field="optimizer_args" label="Optimizer Args (JSON array)" type="json" help="更换优化器时移除上一优化器的专有参数。" /></details>
      </section>

      <section class="tt-col" aria-label="显存与缓存">
        <div class="tt-col-head">
          <h2>显存与缓存</h2>
          <span class="tt-col-meta">BF16</span>
        </div>
        <div class="tt-fields">
          <Field v-for="[key,label] in [['convrot_int8','DiT ConvRot INT8'],['convrot_int8_text_encoder','Text Encoder ConvRot INT8']]" :key="key" :object="m" :field="key!" :label="label!" type="boolean" :data-tt-field="key" />
          <Field :object="t" field="blocks_to_swap" label="Blocks to Swap" type="number" :min="0" :max="40" data-tt-field="blocks_to_swap" />
          <Field :object="t" field="block_swap_ring_size" label="Block Swap Ring Size" type="number" :min="1" data-tt-field="block_swap_ring_size" />
          <Field v-for="[key,label] in [['gradient_checkpointing','Gradient Checkpointing'],['block_swap_h2d_only','H2D-only Block Swap'],['use_pinned_memory_for_block_swap','Pinned Block Swap Memory'],['cache_latents_to_disk','Cache Latents to Disk'],['cache_text_encoder_outputs_to_disk','Cache Text Outputs to Disk'],['cpu_offload_checkpointing','CPU Activation Offload'],['unsloth_offload_checkpointing','Unsloth Activation Offload']]" :key="key" :object="t" :field="key!" :label="label!" type="boolean" :data-tt-field="key" />
        </div>
        <p class="muted tt-col-note">Activation Offload 与 Block Swap 互斥；H2D-only 需要 Gradient Checkpointing。ConvRot 使用锁定环境的 Triton。不会修改已有 Anima / Krea 环境。</p>
      </section>

      <section class="tt-col" aria-label="时间步与编译加速">
        <div class="tt-col-head">
          <h2>时间步与编译加速</h2>
          <span class="tt-col-meta">shift {{ m.discrete_flow_shift ?? 3 }}</span>
        </div>
        <div class="tt-fields">
          <Field :object="m" field="timestep_sampling" label="Timestep Sampling" type="select" :options="Moss.TIMESTEPS" data-tt-field="timestep_sampling" />
          <Field :object="m" field="discrete_flow_shift" label="Training Flow Shift" type="number" step="any" :min="0.01" data-tt-field="discrete_flow_shift" />
          <Field :object="m" field="weighting_scheme" label="Loss Weighting" type="select" :options="['uniform','none','sigma_sqrt','cosmap']" data-tt-field="weighting_scheme" />
          <Field :object="m" field="moss_max_token_length" label="Max Token Length" type="number" :min="1" :max="4096" data-tt-field="moss_max_token_length" />
          <Field :object="m" field="text_encoder_batch_size" label="TE Cache Batch" type="number" :min="1" data-tt-field="text_encoder_batch_size" />
        </div>
        <TimestepSparkline :method="String(m.timestep_sampling ?? 'logit_normal')" :shift="Number(m.discrete_flow_shift ?? 3)" />

        <div class="tt-col-head tt-subhead">
          <h2>编译与 CUDA 加速</h2>
          <span class="tt-col-meta">{{ t.compile ? 'compile on' : 'off' }}</span>
        </div>
        <div class="tt-fields">
          <Field :object="t" field="compile" label="启用 torch.compile（按 DiT Block）" type="boolean" data-tt-field="compile" />
          <template v-if="t.compile">
            <Field :object="t" field="compile_backend" label="Compile Backend" type="select" :options="Moss.COMPILE_BACKENDS" data-tt-field="compile_backend" />
            <Field :object="t" field="compile_mode" label="Compile Mode" type="select" :options="Moss.COMPILE_MODES" data-tt-field="compile_mode" />
            <Field :object="t" field="compile_dynamic" label="Compile Dynamic Shapes" type="select" :options="Moss.COMPILE_DYNAMIC" data-tt-field="compile_dynamic" />
            <Field :object="t" field="compile_cache_size_limit" label="Compile Cache Size Limit" type="number" :min="1" data-tt-field="compile_cache_size_limit" />
            <Field :object="t" field="compile_fullgraph" label="Compile Fullgraph（高级）" type="boolean" data-tt-field="compile_fullgraph" />
          </template>
          <Field :object="t" field="cuda_allow_tf32" label="CUDA Allow TF32" type="boolean" data-tt-field="cuda_allow_tf32" />
          <Field :object="t" field="cuda_cudnn_benchmark" label="CUDA cuDNN Benchmark" type="boolean" data-tt-field="cuda_cudnn_benchmark" />
        </div>
        <p class="muted tt-col-note">首次编译和新分辨率桶需要预热，可能增加显存；不保证加速。推荐 inductor / default / auto，eager 与 aot_eager 仅用于诊断（Mode 必须为 default）。ConvRot INT8 或 Block Swap 会排除对应 Linear 层。CUDA 开关独立生效。Linux 需要匹配的 Triton 和 C/C++ 编译器；Windows 需相应工具链，dynamic=true 需要 VS 2022 C++。</p>
      </section>
    </div>
  </fieldset>
</template>
