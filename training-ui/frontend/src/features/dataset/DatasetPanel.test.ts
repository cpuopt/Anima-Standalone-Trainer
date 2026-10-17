import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { flushPromises, shallowMount } from '@vue/test-utils'
import DatasetPanel from './DatasetPanel.vue'
let state: any
const mocks = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock('@/stores/editor', () => ({ useEditorStore: () => state }))
vi.mock('@/services/api', () => ({ api: mocks.api }))
describe('dataset draft preservation', () => {
  beforeEach(() => {
    state = reactive({ name: 'test', dataset: { custom: 'top', datasets: [{resolution:[1024,768],batch_size:2,custom:'first',subsets:[{image_dir:'',num_repeats:1,custom:'a'}]},{resolution:1536,batch_size:1,custom:'second',subsets:[{image_dir:'',num_repeats:2,custom:'b'}]}] }, config:{}, architecture:'anima', globalConfig:{}, locked:false, fieldErrors:{}, touch:vi.fn(), error:'' })
    mocks.api.mockReset()
  })
  afterEach(() => { vi.useRealTimers() })
  it('does not normalize or add default fields when merely viewing multiple datasets', () => {
    const before = JSON.stringify(state.dataset)
    const wrapper = shallowMount(DatasetPanel)
    expect(wrapper.findAll('.dataset-card')).toHaveLength(2)
    expect(JSON.stringify(state.dataset)).toBe(before)
    wrapper.unmount()
  })
  it('adds a subset only to the chosen dataset while preserving unknown fields', async () => {
    const wrapper = shallowMount(DatasetPanel)
    const buttons = wrapper.findAll('button').filter(button => button.text() === '添加子集')
    await buttons[1]!.trigger('click')
    expect(state.dataset.datasets[0].subsets).toHaveLength(1)
    expect(state.dataset.datasets[1].subsets).toHaveLength(2)
    expect(state.dataset.datasets[1].subsets[0].custom).toBe('b')
    expect(state.dataset.custom).toBe('top')
    wrapper.unmount()
  })
  it('preserves progressive schedule on view and updates only its training field', async () => {
    state.config = { training_arguments: { resolution_schedule:'512:0.4,1024:0.6', disable_bucket_shuffle:true, custom:'keep' } }
    state.dataset.datasets[0].subsets[0].alpha_mask = true
    const before = JSON.stringify(state.config), datasetBefore = JSON.stringify(state.dataset)
    const wrapper = shallowMount(DatasetPanel)
    expect(JSON.stringify(state.config)).toBe(before)
    const schedule = wrapper.findAllComponents({name:'ConfigField'}).find(field => field.props('field') === 'resolution_schedule')!
    expect(schedule.props('object').resolution_schedule).toBe('512:0.4,1024:0.6')
    schedule.vm.$emit('change','512:0.25,1024:0.75')
    await flushPromises()
    expect(state.config.training_arguments).toEqual({resolution_schedule:'512:0.25,1024:0.75',disable_bucket_shuffle:true,custom:'keep'})
    expect(JSON.stringify(state.dataset)).toBe(datasetBefore)
    wrapper.unmount()
  })
  it('discards old task image-count results after task switching', async () => {
    vi.useFakeTimers()
    let finish: (value: any) => void = () => {}
    mocks.api.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    state.dataset.datasets[0].subsets[0].image_dir = '/old'
    const wrapper = shallowMount(DatasetPanel)
    await vi.advanceTimersByTimeAsync(400)
    state.name = 'next'
    state.dataset = {datasets:[{subsets:[{image_dir:'/new'}]}]}
    await flushPromises()
    finish({exists:true,readable:true,count:999})
    await flushPromises()
    expect(wrapper.text()).not.toContain('999')
    wrapper.unmount(); vi.useRealTimers()
  })
  it('uses UI settings targets and keeps target selection available while editing is locked', () => {
    state.locked = true
    state.globalConfig = {ui:{lbai_targets:[{name:'Shared custom target',type:'range',min:0.01,max:0.02,color:'#ff0000'}]}}
    const wrapper = shallowMount(DatasetPanel)
    expect(wrapper.find('fieldset').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.total-lbai select').element.matches(':disabled')).toBe(false)
    expect(wrapper.find('.total-lbai select').text()).toContain('Shared custom target')
    wrapper.unmount()
  })
  it('sums all Dataset contributions using their independent batch sizes', async () => {
    vi.useFakeTimers()
    state.config = {training_arguments:{max_train_epochs:2,learning_rate:0.0001,lr_scheduler:'constant',gradient_accumulation_steps:1},network_arguments:{network_dim:32}}
    state.dataset.datasets[0].subsets[0].image_dir = '/first'
    state.dataset.datasets[1].subsets[0].image_dir = '/second'
    mocks.api.mockImplementation((_url, options) => Promise.resolve({exists:true,readable:true,count:options.body.path === '/first' ? 10 : 20}))
    const wrapper = shallowMount(DatasetPanel)
    await vi.advanceTimersByTimeAsync(400)
    await flushPromises()
    // First: 10 * 1 * 2 * .0001 / 2 = .001; second: 20 * 2 * 2 * .0001 / 1 = .008.
    expect(wrapper.find('.total-lbai').text()).toContain('总 LBAI 0.009')
    wrapper.unmount()
  })
})
