import { describe, expect, it, vi } from 'vitest'
import { activationOffload, argumentValue, replaceArgument, section, selectDuration, selectOptimizer, selectParallelMode, setActivationOffload, setCudaDirect, validateConfig } from './rules'
vi.mock('@/services/api', () => ({ api: vi.fn(async () => ({ layers: ['blocks.0.self_attn.q_proj'] })) }))

describe('configuration editing rules', () => {
  it('does not materialize omitted sections while reading defaults', () => {
    const config: any = { architecture:'lumina' }
    const missing = section(config,'lumina_arguments')
    expect(missing.discrete_flow_shift).toBeUndefined()
    expect(config).toEqual({ architecture:'lumina' })
    missing.discrete_flow_shift = 6
    expect(config).toEqual({ architecture:'lumina', lumina_arguments:{ discrete_flow_shift:6 } })
  })
  it('updates only one argument and preserves list values, unknown args and explicit false/zero', () => {
    const input = ['include_patterns=["a b", "c"]','weight_decay=0.01','custom=false','zero=0']
    const result = replaceArgument(input, 'weight_decay', '0')
    expect(result).toEqual(['include_patterns=["a b", "c"]','custom=false','zero=0','weight_decay=0'])
    expect(input[1]).toBe('weight_decay=0.01')
    expect(argumentValue(result, 'weight_decay')).toBe('0')
  })
  it('clears both old duration and sample units when explicitly switching', () => {
    const t: any = { max_train_epochs: 20, save_every_n_epochs: 2, sample_every_n_epochs: 1, custom: false }
    selectDuration(t, 'steps')
    expect(t).toEqual({ max_train_steps:1000, save_every_n_steps:500, sample_every_n_steps:100, custom:false })
    selectDuration(t, 'epochs')
    expect(t).toEqual({ max_train_epochs:20, save_every_n_epochs:1, sample_every_n_epochs:1, custom:false })
  })
  it('keeps Krea block swap with CPU offload and writes only supported Krea key', () => {
    const k: any = { blocks_to_swap:26 }
    setActivationOffload(k, 'cpu', true)
    expect(k).toEqual({ blocks_to_swap:26, gradient_checkpointing_cpu_offload:true, gradient_checkpointing:true })
    expect(activationOffload(k, true)).toBe('cpu')
    const a: any = { blocks_to_swap:20, unsloth_offload_checkpointing:true }
    setActivationOffload(a, 'cpu', false)
    expect(a).toEqual({ blocks_to_swap:0, cpu_offload_checkpointing:true, gradient_checkpointing:true })
  })
  it('keeps optimizer-specific drafts separate while sharing weight decay', () => {
    const t: any = { optimizer_type:'Adafactor', optimizer_args:['weight_decay=0','eps=(1e-30,1e-3)','relative_step=False','scale_parameter=False'] }
    selectOptimizer(t, 'AdamW', true)
    expect(t.optimizer_args).toEqual(['weight_decay=0'])
    t.optimizer_args.push('betas=(0.9,0.999)')
    selectOptimizer(t, 'Adafactor', true)
    expect(t.optimizer_args).toEqual(['weight_decay=0','eps=(1e-30,1e-3)','relative_step=False','scale_parameter=False'])
    selectOptimizer(t,'AdamW',true)
    expect(t.optimizer_args).toEqual(['weight_decay=0','betas=(0.9,0.999)'])
  })
  it('does not forward Prodigy decouple to AdamW', () => {
    const t: any = { optimizer_type:'Prodigy', optimizer_args:['weight_decay=0.01','decouple=True','d_coef=1'] }
    selectOptimizer(t,'AdamW',false)
    expect(t.optimizer_args).toEqual(['weight_decay=0.01'])
    selectOptimizer(t,'Prodigy',false)
    expect(t.optimizer_args).toEqual(['weight_decay=0.01','decouple=True','d_coef=1'])
  })
  it('clears incompatible manual offload when FSDP is selected', () => {
    const t: any = { blocks_to_swap:20, cpu_offload_checkpointing:true }
    selectParallelMode(t,'fsdp2',2)
    expect(t.use_fsdp).toBe(true)
    expect(t.blocks_to_swap).toBe(0)
    expect(t.cpu_offload_checkpointing).toBeUndefined()
    selectParallelMode(t,'ddp',2)
    expect(t.cpu_offload_checkpointing).toBe(true)
    expect(t.blocks_to_swap).toBe(0)
  })
  it('sets TP degree from selected devices and clears sample/compile/CUDA Direct', () => {
    const t: any = { torch_compile:true, use_cuda_direct:true, sample_every_n_steps:10 }
    selectParallelMode(t,'tp_sp',4)
    expect(t).toMatchObject({ multigpu_mode:'tp_sp', tp_degree:4, sequence_parallel:true, torch_compile:false, use_cuda_direct:false })
    expect(t.sample_every_n_steps).toBeUndefined()
    selectParallelMode(t,'tp_sp',1)
    expect(t.multigpu_mode).toBe('ddp')
  })
  it('CUDA Direct clears hybrid sharding and compile on explicit selection', () => {
    const t: any = { fsdp_sharding_strategy:'4', torch_compile:true }
    setCudaDirect(t,true)
    expect(t).toEqual({ fsdp_sharding_strategy:'1', torch_compile:false, use_cuda_direct:true })
    setCudaDirect(t,false)
    expect(t.torch_compile).toBe(true)
  })
  it('rejects invalid manual offload and layer settings before saving without mutating document', async () => {
    await expect(validateConfig({ training_arguments:{ cpu_offload_checkpointing:true, gradient_checkpointing:false } })).rejects.toThrow('Gradient Checkpointing')
    const config = { training_arguments:{ learning_rate:0.0001 }, network_arguments:{ network_module:'networks.lokr', network_dim:32, network_args:['layer_configs={"version":1,"mode":"layer","default_rank":32,"layers":{"blocks.9.self_attn.q_proj":{"rank":16}}}'] } }
    const original = JSON.stringify(config)
    await expect(validateConfig(config)).rejects.toThrow('模型中不存在该层')
    expect(JSON.stringify(config)).toBe(original)
  })
})
