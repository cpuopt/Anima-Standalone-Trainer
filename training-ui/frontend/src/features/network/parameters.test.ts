// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import Field from '@/components/forms/ConfigField.vue'
import { Krea2 } from '@/domain/legacy'
import { useEditorStore } from '@/stores/editor'
import NetworkPanel from './NetworkPanel.vue'
import TrainingPanel from '../training/TrainingPanel.vue'
import MultiGpuPanel from '../multi-gpu/MultiGpuPanel.vue'
vi.mock('@/services/api', () => ({
  api: vi.fn(async () => ({ block_count:1, layers:['blocks.0.self_attn.q_proj'] })),
  jobUrl: (name: string, suffix = '') => `/api/jobs/${encodeURIComponent(name)}${suffix}`,
}))

function field(wrapper: VueWrapper, label: string) {
  const match = wrapper.findAllComponents(Field).find(item => item.props('label') === label)
  if (!match) throw Error(`Field not found: ${label}`)
  return match
}
function select(wrapper: VueWrapper, label: string) {
  const match = wrapper.findAll('label').find(item => item.text().startsWith(label) && item.find('select').exists())
  if (!match) throw Error(`Select not found: ${label}`)
  return match.find('select')
}

describe('parameter components preserve complete documents', () => {
  beforeEach(() => { setActivePinia(createPinia()) })
  it('reading defaults does not create omitted sections or overwrite values', async () => {
    const store = useEditorStore()
    store.config = { architecture:'lumina', training_arguments:{ learning_rate:0.0001, custom:0 } }
    store.architecture = 'lumina'; store.registry = { architectures:{ lumina:{ training_section:'lumina_arguments' } } }
    const before = JSON.stringify(store.config)
    const wrapper = mount(TrainingPanel)
    expect(JSON.stringify(store.config)).toBe(before)
    await field(wrapper,'Flow Shift').find('input').setValue('6')
    expect(store.config.lumina_arguments).toEqual({ discrete_flow_shift:6 })
    expect(store.config.anima_arguments).toBeUndefined()
    wrapper.unmount()
  })
  it('clearing a dedicated LoKR factor removes that token while retaining unrelated arguments', async () => {
    const store = useEditorStore()
    store.config = { training_arguments:{}, network_arguments:{ network_module:'networks.lokr', network_dim:32, network_alpha:32, network_args:['factor=3','custom=false'] } }
    const wrapper = mount(NetworkPanel)
    expect(wrapper.text()).toContain('65,540')
    await field(wrapper,'LoKR Factor').find('input').setValue('')
    expect(store.config.network_arguments.network_args).toEqual(['custom=false'])
    wrapper.unmount()
  })
  it('Krea full mode disables rank and calculates full factors without unsupported Anima fields', async () => {
    const store = useEditorStore()
    store.architecture = 'krea2'; store.config = Krea2.defaults()
    store.config.network_arguments.network_module = Krea2.LOKR_MODULE
    store.config.network_arguments.network_args = ['factor=16']
    const wrapper = mount(NetworkPanel)
    await field(wrapper,'Full Matrix').find('input').setValue(true)
    expect(field(wrapper,'Network Dim (Rank)').find('input').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('147,712')
    expect(wrapper.text()).not.toContain('Use DoKr')
    expect(store.config.network_arguments.network_args).toEqual(['factor=16','full_matrix=true'])
    wrapper.unmount()
  })
  it('keeps adapter settings across a full-finetune tab unmount/remount', async () => {
    const store = useEditorStore()
    store.config = { training_arguments:{}, network_arguments:{ network_module:'networks.lokr', network_dim:64, network_args:['factor=3'], resume:'state' } }
    let wrapper = mount(NetworkPanel)
    await select(wrapper,'Training Type').setValue('full_finetune')
    expect(store.config.network_arguments).toEqual({ resume:'state' })
    wrapper.unmount(); wrapper = mount(NetworkPanel)
    await select(wrapper,'Training Type').setValue('lora')
    expect(store.config.network_arguments).toEqual({ network_module:'networks.lokr', network_dim:64, network_args:['factor=3'], resume:'state' })
    wrapper.unmount()
  })
  it('edits layer-type ranks and reloads their inventory through the shared API', async () => {
    const store = useEditorStore()
    store.config = { training_arguments:{}, network_arguments:{ network_module:'networks.lora_anima', network_dim:32, network_alpha:32 } }
    const wrapper = mount(NetworkPanel)
    const toggle = wrapper.findAll('label').find(item => item.text().includes('高级分层设置'))!
    await toggle.find('input').setValue(true); await flushPromises()
    await wrapper.get('input[aria-label="self_attn rank"]').setValue('16')
    const token = store.config.network_arguments.network_args.find((arg: string) => arg.startsWith('layer_configs='))
    expect(JSON.parse(token.slice(token.indexOf('=') + 1)).types.self_attn.rank).toBe(16)
    expect(wrapper.text()).toContain('1 个可配置层')
    wrapper.unmount()
  })
  it('selects exactly one Krea GPU from the automatic state', async () => {
    const store = useEditorStore()
    store.architecture = 'krea2'; store.config = Krea2.defaults()
    store.gpus = [{ index:0,name:'First',memory:'16GB' }, { index:1,name:'Second',memory:'16GB' }]
    const wrapper = mount(MultiGpuPanel)
    await wrapper.findAll('.gpu-card input')[1]!.setValue(true)
    expect(store.config.gpu_ids).toBe('1')
    await wrapper.findAll('.gpu-card input')[0]!.setValue(true)
    expect(store.config.gpu_ids).toBe('0')
    expect(store.config.training_arguments.multigpu_mode).toBeUndefined()
    wrapper.unmount()
  })
})
