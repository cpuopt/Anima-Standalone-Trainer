import { Krea2, LayerRank, Moss } from '@/domain/legacy'
import { api } from '@/services/api'

export type Config = Record<string, any>

/** Missing sections stay missing until an actual user edit. Reads remain reactive. */
export function section(config: Config, key: string): Config {
  if (config[key]) return config[key]
  return new Proxy({}, {
    get: (_target, field) => config[key]?.[field],
    set: (_target, field, value) => { config[key] ||= {}; config[key][field] = value; return true },
    deleteProperty: (_target, field) => { if (config[key]) delete config[key][field]; return true },
    ownKeys: () => Reflect.ownKeys(config[key] || {}),
    getOwnPropertyDescriptor: (_target, field) => config[key] && Object.hasOwn(config[key], field) ? { configurable:true, enumerable:true, value:config[key][field], writable:true } : undefined,
  })
}

export function replaceArgument(args: unknown, key: string, value: unknown): string[] {
  const source = Array.isArray(args) ? args : []
  const next = source.filter(token => typeof token !== 'string' || token.slice(0, token.indexOf('=')).trim() !== key)
  if (value !== undefined && value !== null && value !== '') next.push(`${key}=${value}`)
  return next
}

export function argumentValue(args: unknown, key: string): string | undefined {
  const token = (Array.isArray(args) ? args : []).find(token => typeof token === 'string' && token.slice(0, token.indexOf('=')).trim() === key)
  return token === undefined ? undefined : token.slice(token.indexOf('=') + 1)
}

export function selectDuration(t: Config, unit: string) {
  if (unit === 'steps') {
    t.max_train_steps ??= 1000
    t.save_every_n_steps ??= 500
    if (t.sample_every_n_epochs) t.sample_every_n_steps ??= 100
    delete t.max_train_epochs; delete t.save_every_n_epochs; delete t.sample_every_n_epochs
  } else {
    t.max_train_epochs ??= 20
    t.save_every_n_epochs ??= 1
    if (t.sample_every_n_steps) t.sample_every_n_epochs ??= 1
    delete t.max_train_steps; delete t.save_every_n_steps; delete t.sample_every_n_steps
  }
}

export function activationOffload(t: Config, krea: boolean): string {
  return krea ? (t.gradient_checkpointing_cpu_offload ? 'cpu' : 'none')
    : t.unsloth_offload_checkpointing ? 'unsloth' : t.cpu_offload_checkpointing ? 'cpu' : 'none'
}

export function setActivationOffload(t: Config, mode: string, krea: boolean) {
  if (krea) t.gradient_checkpointing_cpu_offload = mode === 'cpu'
  else {
    delete t.cpu_offload_checkpointing; delete t.unsloth_offload_checkpointing
    if (mode === 'cpu') t.cpu_offload_checkpointing = true
    if (mode === 'unsloth') t.unsloth_offload_checkpointing = true
    if (mode !== 'none') t.blocks_to_swap = 0
  }
  if (mode !== 'none') t.gradient_checkpointing = true
}

const optimizerDrafts = new WeakMap<object, Map<string, string[]>>()
export function selectOptimizer(t: Config, value: string, krea: boolean) {
  const previous = t.optimizer_type || 'AdamW8bit'
  if (previous !== value) {
    const drafts = optimizerDrafts.get(t) || new Map<string, string[]>()
    const shared = (t.optimizer_args || []).filter((arg: string) => arg.split('=')[0].trim() === 'weight_decay')
    drafts.set(previous, (t.optimizer_args || []).filter((arg: string) => arg.split('=')[0].trim() !== 'weight_decay'))
    t.optimizer_args = [...shared, ...(drafts.get(value) || [])]
    optimizerDrafts.set(t, drafts)
  }
  t.optimizer_type = value
  if (krea && value === 'Adafactor') {
    for (const arg of ['relative_step=False', 'scale_parameter=False']) {
      const key = arg.split('=')[0]
      if (argumentValue(t.optimizer_args, key) === undefined) t.optimizer_args = [...(t.optimizer_args || []), arg]
    }
  }
  if (!krea && /Prodigy|DAdapt/.test(value) && argumentValue(t.optimizer_args, 'decouple') === undefined) t.optimizer_args = [...(t.optimizer_args || []), 'decouple=True']
}

export function parallelMode(t: Config): string {
  return t.multigpu_mode || (t.deepspeed ? 'deepspeed' : t.use_fsdp ? 'fsdp' : 'ddp')
}

const offloadDrafts = new WeakMap<object, { blocks: number; mode: string }>()
const compileDrafts = new WeakMap<object, boolean>()
export function selectParallelMode(t: Config, mode: string, gpuCount: number) {
  const wasFsdp = ['fsdp','fsdp2'].includes(parallelMode(t)) && !!t.use_fsdp
  t.multigpu_mode = gpuCount > 1 ? mode : 'ddp'
  t.use_fsdp = gpuCount > 1 && ['fsdp', 'fsdp2'].includes(mode)
  t.deepspeed = gpuCount > 1 && mode === 'deepspeed'
  if (t.use_fsdp) {
    if (!wasFsdp) offloadDrafts.set(t, { blocks:t.blocks_to_swap ?? 0, mode:activationOffload(t, false) })
    t.blocks_to_swap = 0
    setActivationOffload(t, 'none', false)
  } else if (wasFsdp && offloadDrafts.has(t)) {
    const draft = offloadDrafts.get(t)!
    setActivationOffload(t, draft.mode, false)
    t.blocks_to_swap = draft.mode === 'none' ? draft.blocks : 0
    offloadDrafts.delete(t)
  }
  if (['tp_sp', 'deepspeed'].includes(mode) || gpuCount < 2) t.use_cuda_direct = false
  if (mode === 'tp_sp' && gpuCount > 1) {
    t.tp_degree = gpuCount; t.sequence_parallel = true
    t.torch_compile = false
    delete t.sample_every_n_epochs; delete t.sample_every_n_steps
  }
}

export function setCudaDirect(t: Config, enabled: boolean) {
  t.use_cuda_direct = enabled
  if (enabled) {
    if (t.torch_compile) compileDrafts.set(t, true)
    t.torch_compile = false
    if (['4', '5'].includes(String(t.fsdp_sharding_strategy))) t.fsdp_sharding_strategy = '1'
  } else if (compileDrafts.has(t)) {
    if (parallelMode(t) !== 'tp_sp') t.torch_compile = compileDrafts.get(t)
    compileDrafts.delete(t)
  }
}

/** Validate migrated fields without normalizing or dropping any unedited values. */
export async function validateConfig(config: Config): Promise<void> {
  if (config.architecture === 'moss_image') { Moss.validate(config); return }
  if (Krea2.architecture(config) === 'krea2') { Krea2.validate(config); return }
  const t = config.training_arguments || {}, n = config.network_arguments || {}
  const finite = (value: any, label: string, min: number, integer = false) => {
    if (value === undefined) return
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || (integer && !Number.isInteger(value))) throw Error(`${label} 必须为不小于 ${min} 的${integer ? '整数' : '数字'}`)
  }
  for (const key of ['max_train_epochs','max_train_steps','save_every_n_epochs','save_every_n_steps','sample_every_n_epochs','sample_every_n_steps','gradient_accumulation_steps']) finite(t[key], key, 1, true)
  for (const key of ['max_data_loader_n_workers','blocks_to_swap','lr_warmup_steps']) finite(t[key], key, 0, true)
  for (const key of ['learning_rate','text_encoder_lr']) finite(t[key], key, Number.EPSILON)
  if (t.persistent_data_loader_workers && t.max_data_loader_n_workers === 0) throw Error('Persistent workers 需要 DataLoader Workers > 0')
  if ((t.cpu_offload_checkpointing || t.unsloth_offload_checkpointing) && !t.gradient_checkpointing) throw Error('Activation Offload 需要 Gradient Checkpointing')
  if (t.cpu_offload_checkpointing && t.unsloth_offload_checkpointing) throw Error('CPU 与 Unsloth Offload 不能同时启用')
  if ((t.cpu_offload_checkpointing || t.unsloth_offload_checkpointing) && t.blocks_to_swap > 0) throw Error('Activation Offload 与 Blocks to Swap 互斥')
  if (t.use_cuda_direct && t.torch_compile) throw Error('CUDA Direct 与 Torch Compile 互斥')
  if (parallelMode(t) === 'tp_sp' && t.torch_compile) throw Error('TP/SP 与 Torch Compile 互斥')
  if (t.use_fsdp && (t.blocks_to_swap > 0 || t.cpu_offload_checkpointing || t.unsloth_offload_checkpointing)) throw Error('FSDP 与手动 Block / Activation Offload 互斥')
  if (n.network_module) {
    finite(n.network_dim, 'Rank', 1, true); finite(n.network_alpha, 'Alpha', Number.EPSILON)
    if (n.network_dropout !== undefined && (typeof n.network_dropout !== 'number' || n.network_dropout < 0 || n.network_dropout > 1)) throw Error('Network Dropout 必须为 0..1')
    if (n.network_args !== undefined && (!Array.isArray(n.network_args) || n.network_args.some((arg: any) => typeof arg !== 'string' || !arg.includes('=')))) throw Error('Network Args 必须为 key=value 字符串数组')
    const seen = new Set()
    for (const arg of n.network_args || []) {
      const key = arg.slice(0, arg.indexOf('=')).trim()
      if (!key || seen.has(key)) throw Error(`Network Args 无效或重复参数：${key}`)
      seen.add(key)
    }
    const factor = argumentValue(n.network_args, 'factor')
    if (factor !== undefined && (!/^[+-]?\d+$/.test(factor) || !Number.isSafeInteger(Number(factor)) || (Number(factor) !== -1 && Number(factor) < 1))) throw Error('Factor 必须为 -1 或正整数')
    for (const key of ['rank_dropout','module_dropout']) {
      const value = argumentValue(n.network_args, key)
      if (value !== undefined && (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 1)) throw Error(`${key} 必须为 0..1`)
    }
    const layerConfig = argumentValue(n.network_args, 'layer_configs')
    if (layerConfig !== undefined && ['networks.lora_anima','networks.loha','networks.lokr'].includes(n.network_module)) {
      let parsed
      try { parsed = JSON.parse(layerConfig) } catch { throw Error('layer_configs JSON 无效') }
      const data = await api<{ layers: string[] }>('/api/anima-layers')
      LayerRank.validate(parsed, data.layers)
    }
  }
}
