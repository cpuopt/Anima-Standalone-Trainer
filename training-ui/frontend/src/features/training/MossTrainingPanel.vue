<script setup lang="ts">
import { computed } from 'vue'
import Field from '@/components/forms/ConfigField.vue'
import { useEditorStore } from '@/stores/editor'
import { Moss } from '@/domain/legacy'
import { section, selectDuration } from './rules'
const store = useEditorStore()
const t = computed(() => section(store.config, 'training_arguments'))
const m = computed(() => section(store.config, 'moss_arguments'))
const duration = computed({get:()=>t.value.max_train_steps ? 'steps':'epochs',set:value=>selectDuration(t.value,value)})
</script>
<template>
  <fieldset class="panel" :disabled="store.locked">
    <h2>MOSS-Image · 隔离 sd-scripts 后端</h2>
    <p class="muted">单卡、BF16、仅训练 DiT。默认 512 / batch 1；实际显存取决于模型、caption 长度及适配器。冻结 Qwen3.5-9B。训练中采样在提示词页设置。</p>
    <div class="fields">
      <Field :object="m" field="flavour" label="底模" type="select" :options="['base','sft']"/>
      <Field :object="t" field="output_name" label="Output Name"/>
      <Field :object="t" field="learning_rate" label="Learning Rate" type="number" step="any" :min="0"/>
      <Field :object="t" field="optimizer_type" label="Optimizer" type="select" :options="Moss.OPTIMIZERS"/>
      <Field :object="t" field="lr_scheduler" label="LR Scheduler" type="select" :options="Moss.SCHEDULERS"/>
      <Field :object="t" field="lr_warmup_steps" label="Warmup Steps" type="number" :min="0"/>
      <Field :object="t" field="lr_scheduler_num_cycles" label="Scheduler Cycles" type="number" :min="1"/>
      <Field :object="t" field="lr_scheduler_min_lr_ratio" label="Min LR Ratio" type="number" :min="0" :max="1" step="any"/>
      <label class="field">Duration<select v-model="duration"><option value="epochs">Epochs</option><option value="steps">Steps</option></select></label>
      <Field :object="t" :field="duration==='steps'?'max_train_steps':'max_train_epochs'" label="Training Duration" type="number" :min="1"/>
      <Field :object="t" :field="duration==='steps'?'save_every_n_steps':'save_every_n_epochs'" label="Save Every N" type="number" :min="1"/>
      <Field v-for="[key,label] in [['seed','Seed'],['gradient_accumulation_steps','Gradient Accumulation'],['max_grad_norm','Max Grad Norm'],['max_data_loader_n_workers','DataLoader Workers'],['vae_batch_size','VAE Cache Batch']]" :key="key" :object="t" :field="key!" :label="label!" type="number" :min="0"/>
      <Field :object="t" field="save_precision" label="Save Precision" type="select" :options="['bf16','fp16','float']"/>
      <Field :object="m" field="timestep_sampling" label="Timestep Sampling" type="select" :options="Moss.TIMESTEPS"/>
      <Field :object="m" field="discrete_flow_shift" label="Training Flow Shift" type="number" step="any" :min="0.01"/>
      <Field :object="m" field="weighting_scheme" label="Loss Weighting" type="select" :options="['uniform','none','sigma_sqrt','cosmap']"/>
      <Field :object="m" field="moss_max_token_length" label="Max Token Length" type="number" :min="1" :max="4096"/>
      <Field :object="m" field="text_encoder_batch_size" label="TE Cache Batch" type="number" :min="1"/>
    </div>
    <Field :object="t" field="optimizer_args" label="Optimizer Args (JSON array)" type="json" help="更换优化器时移除上一优化器的专有参数。"/>
    <h2>显存与缓存</h2>
    <div class="fields">
      <Field v-for="[key,label] in [['convrot_int8','DiT ConvRot INT8'],['convrot_int8_text_encoder','Text Encoder ConvRot INT8']]" :key="key" :object="m" :field="key!" :label="label!" type="boolean"/>
      <Field :object="t" field="blocks_to_swap" label="Blocks to Swap" type="number" :min="0" :max="40"/>
      <Field :object="t" field="block_swap_ring_size" label="Block Swap Ring Size" type="number" :min="1"/>
      <Field v-for="[key,label] in [['gradient_checkpointing','Gradient Checkpointing'],['block_swap_h2d_only','H2D-only Block Swap'],['use_pinned_memory_for_block_swap','Pinned Block Swap Memory'],['cache_latents_to_disk','Cache Latents to Disk'],['cache_text_encoder_outputs_to_disk','Cache Text Outputs to Disk'],['cpu_offload_checkpointing','CPU Activation Offload'],['unsloth_offload_checkpointing','Unsloth Activation Offload']]" :key="key" :object="t" :field="key!" :label="label!" type="boolean"/>
    </div>
    <p class="muted">Activation Offload 与 Block Swap 互斥；H2D-only 需要 Gradient Checkpointing。ConvRot 使用锁定环境的 Triton。不会修改已有 Anima / Krea 环境。</p>
  </fieldset>
</template>
