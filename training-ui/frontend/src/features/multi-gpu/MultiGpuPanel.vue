<script setup lang="ts">
import { computed } from 'vue'
import Field from '@/components/forms/ConfigField.vue'
import { useEditorStore } from '@/stores/editor'
import { parallelMode, section, selectParallelMode, setCudaDirect } from '../training/rules'
const store = useEditorStore()
const t = computed(() => section(store.config, 'training_arguments'))
const krea = computed(() => ['krea2','moss_image'].includes(store.architecture))
const selected = computed(() => String(store.config.gpu_ids || '').split(',').map(x => x.trim()).filter(Boolean))
// An empty GPU selection means automatic allocation; display all detected GPUs as in the original UI.
const ids = computed(() => selected.value.length ? selected.value : store.gpus.map((gpu: any) => String(gpu.index)))
const count = computed(() => ids.value.length)
const gpuIds = computed({ get: () => store.config.gpu_ids || '', set: value => {
  store.config.gpu_ids = value
  if (!krea.value) selectParallelMode(t.value, mode.value, value.trim() ? value.split(',').filter(Boolean).length : store.gpus.length)
} })
const mode = computed({ get: () => parallelMode(t.value), set: value => selectParallelMode(t.value, value, count.value) })
const cudaDirect = computed({ get: () => !!t.value.use_cuda_direct, set: value => setCudaDirect(t.value, value) })
const cudaLocked = computed(() => count.value < 2 || ['tp_sp','deepspeed'].includes(mode.value))
const wrapPolicies = ['NO_WRAP','TRANSFORMER_BASED_WRAP','SIZE_BASED_WRAP']
const strategies = computed(() => ['1','2','3', ...(!cudaDirect.value ? ['4','5'] : [])].map(value => ({value, label: ({ '1':'FULL_SHARD (1)', '2':'SHARD_GRAD_OP (2)', '3':'NO_SHARD (3)', '4':'HYBRID_SHARD (4)', '5':'HYBRID_SHARD_ZERO2 (5)' } as Record<string,string>)[value]!})))
function toggleGpu(id: string) {
  if (krea.value) { store.config.gpu_ids = selected.value.includes(id) ? '' : id; return }
  const next = ids.value.includes(id) ? ids.value.filter((value: string) => value !== id) : [...ids.value, id]
  store.config.gpu_ids = next.join(',')
  selectParallelMode(t.value, mode.value, next.length)
}
function isChecked(id: string) { return krea.value && !selected.value.length ? false : ids.value.includes(id) }
function setProfile(event: Event) {
  t.value.step_profile = (event.target as HTMLInputElement).checked
  if (!t.value.step_profile) t.value.profile_microbatch = false
}
</script>
<template>
  <fieldset class="panel" :disabled="store.locked">
    <h2>Hardware Allocation</h2>
    <p class="muted">{{ krea ? 'Krea 2 / MOSS 支持单卡。未显式选择时使用自动设备分配。' : '选择训练 GPU；未显式指定时由启动器自动分配。' }}</p>
    <p v-if="!store.gpus.length" class="muted">未检测到 NVIDIA GPU（CPU only），或硬件信息尚未返回。</p>
    <div class="gpu-grid">
      <label v-for="gpu in store.gpus" :key="gpu.index" class="gpu-card" :class="{ selected: isChecked(String(gpu.index)) }"><input type="checkbox" :checked="isChecked(String(gpu.index))" @change="toggleGpu(String(gpu.index))" /><strong>GPU {{ gpu.index }}</strong><span>{{ gpu.name }}</span><small>{{ gpu.memory }}</small></label>
    </div>
    <label class="field">GPU IDs<input v-model="gpuIds" /><small class="muted">逗号分隔物理 GPU 编号；Krea 2 / MOSS 仅可指定一个编号。空值使用自动分配。</small></label>
    <template v-if="!krea">
      <h2>Multi-GPU Optimization</h2>
      <label class="field">Parallelism Mode<select v-model="mode" :disabled="count < 2"><option value="ddp">DDP — Data Parallel</option><option value="fsdp">FSDP1</option><option value="fsdp2">FSDP2 (Linux only)</option><option value="deepspeed">DeepSpeed — ZeRO</option><option value="tp_sp">Tensor + Sequence Parallel</option></select></label>
      <label class="field"><span><input v-model="cudaDirect" type="checkbox" :disabled="cudaLocked" /> Use CUDA Direct Backend</span><small class="muted">Windows 自定义多卡后端，与 Torch Compile 互斥；TP/SP 自动选择自己的后端。</small></label>
      <p v-if="count < 2" class="muted">选择至少两个 GPU 后配置并行模式。</p>
      <template v-if="count > 1">
        <div v-if="mode === 'ddp'" class="fields"><Field :object="t" field="ddp_gradient_as_bucket_view" label="Gradient as Bucket View" type="boolean" :fallback="false" /><Field :object="t" field="ddp_static_graph" label="Static Graph" type="boolean" :fallback="false" /></div>
        <template v-if="mode === 'fsdp'">
          <h3>FSDP1</h3>
          <div class="fields">
            <Field :object="t" field="fsdp_sharding_strategy" label="Sharding Strategy" type="select" :options="strategies" fallback="1" help="FULL_SHARD 节省最多显存；SHARD_GRAD_OP 分片梯度与优化器。Hybrid 仅用于非 Windows 多节点。" />
            <Field :object="t" field="fsdp_offload_params" label="CPU Offloading" type="boolean" :fallback="false" />
            <Field :object="t" field="fsdp_reshard_after_forward" label="Reshard After Forward" type="boolean" :fallback="false" />
            <Field :object="t" field="fsdp_activation_checkpointing" label="FSDP Activation Checkpointing" type="boolean" :fallback="false" />
            <Field :object="t" field="fsdp_cpu_ram_efficient_loading" label="CPU RAM Efficient Loading" type="boolean" :fallback="false" />
            <Field :object="t" field="fsdp_backward_prefetch" label="Backward Prefetch" type="select" :options="[{value:'',label:'None'},'BACKWARD_PRE','BACKWARD_POST']" fallback="" />
            <Field :object="t" field="fsdp_forward_prefetch" label="Forward Prefetch" type="boolean" :fallback="false" />
            <Field :object="t" field="fsdp_use_orig_params" label="Use Original Parameters" type="boolean" :fallback="true" help="混合冻结底模与可训练 LoRA 参数时需要。" />
            <Field :object="t" field="fsdp_limit_all_gathers" label="Limit All-Gathers" type="boolean" :fallback="true" />
          </div>
        </template>
        <template v-if="mode === 'fsdp2'">
          <h3>FSDP2</h3><p class="muted">仅 Linux。始终使用原始参数，无 FlatParameter；prefetch / all-gather 限流自动处理。</p>
          <div class="fields"><Field v-for="[field,label,fallback] in [['fsdp2_reshard_after_forward','Reshard After Forward',true],['fsdp2_offload_params','CPU Offloading',false],['fsdp2_activation_checkpointing','Activation Checkpointing',false],['fsdp2_cpu_ram_efficient_loading','CPU RAM Efficient Loading',false]]" :key="String(field)" :object="t" :field="String(field)" :label="String(label)" type="boolean" :fallback="fallback" /></div>
        </template>
        <template v-if="mode === 'fsdp' || mode === 'fsdp2'">
          <p class="muted">FSDP 接管参数/激活卸载，手动 Blocks to Swap 与 Activation Offload 已关闭。</p>
          <div class="fields"><Field :object="t" :field="`${mode}_auto_wrap_policy`" label="Auto Wrap Policy" type="select" :options="wrapPolicies" fallback="NO_WRAP" /><Field v-if="t[`${mode}_auto_wrap_policy`] === 'SIZE_BASED_WRAP'" :object="t" :field="`${mode}_min_num_params`" label="Parameters Threshold" type="number" :min="1" :fallback="100000000" /><Field v-if="t[`${mode}_auto_wrap_policy`] === 'TRANSFORMER_BASED_WRAP'" :object="t" :field="`${mode}_transformer_layer_cls_to_wrap`" label="Transformer Layer to Wrap" help="准确的模型 Block 类名，例如 Block。" /></div>
        </template>
        <template v-if="mode === 'deepspeed'">
          <h3>DeepSpeed</h3><div class="fields">
            <Field :object="t" field="zero_stage" label="ZeRO Stage" type="select" :options="[{value:0,label:'Stage 0'}, {value:1,label:'Stage 1 — Optimizer'}, {value:2,label:'Stage 2 — Optimizer + Gradient'}, {value:3,label:'Stage 3 — Full Parameter'}]" :fallback="2" />
            <template v-for="kind in ['optimizer','param']" :key="kind"><Field :object="t" :field="`offload_${kind}_device`" :label="`${kind} Offload Device`" type="select" :options="['none','cpu','nvme']" fallback="none" /><Field v-if="t[`offload_${kind}_device`] === 'nvme'" :object="t" :field="`offload_${kind}_nvme_path`" :label="`${kind} NVMe Path`" /></template>
            <Field :object="t" field="zero3_init_flag" label="ZeRO-3 Init" type="boolean" :fallback="false" /><Field :object="t" field="zero3_save_16bit_model" label="Save 16-bit Model with ZeRO-3" type="boolean" :fallback="false" /><Field :object="t" field="fp16_master_weights_and_gradients" label="FP16 Master Weights and Gradients" type="boolean" :fallback="false" />
          </div>
        </template>
        <template v-if="mode === 'tp_sp'">
          <h3>TP/SP</h3><p class="muted">TP Degree 等于已选 GPU 数：{{ count }}；Sequence Parallel 始终启用。训练中采样与 Torch Compile 禁用。</p>
          <div class="fields"><Field :object="t" field="tp_backend" label="Backend" type="select" :options="['auto','gloo','nccl']" fallback="auto" help="原生 Windows 使用 Gloo，WSL / Linux 使用 NCCL。" /><Field :object="t" field="no_fuse_qkv" label="Disable Fused QKV" type="boolean" :fallback="false" /></div>
        </template>
      </template>
      <h2>Diagnostics</h2><label class="field"><span><input :checked="t.step_profile ?? false" type="checkbox" @change="setProfile" /> Enable Step Profiling</span></label><Field v-if="t.step_profile" :object="t" field="profile_microbatch" label="Track Microbatches" type="boolean" :fallback="false" />
    </template>
  </fieldset>
</template>
<style scoped>
.gpu-grid { display: grid; grid-template-columns: repeat(auto-fit,minmax(12rem,1fr)); gap: .75rem; margin: 1rem 0; }.gpu-card { display: grid; gap: .25rem; padding: 1rem; border: 1px solid var(--border); border-radius: .5rem; cursor: pointer; }.gpu-card.selected { border-color: var(--primary); background: color-mix(in srgb, var(--primary) 8%, transparent); }
</style>
