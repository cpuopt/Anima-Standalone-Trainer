import { mount } from '@vue/test-utils'
import { beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ name: 'example' as string | null, config: {} as Record<string,any>,
  architecture: 'anima', running: false, loading: false, saving: false, logs: '', connected: true, error: '', hardware: {
  gpus: [], memoryProcesses: [{ jobName: 'example', pid: 123, device: 'cuda:0', stage: 'sample.after_restore',
    ageMs: 20000, allocated_bytes: 1073741824, windows: { shared_bytes: 0 }, contents: {
      dit: { 'cuda:0': 536870912 }, vae: { cpu: 1048576 }, optimizer: { 'cuda:0': 1048576 },
    } }],
} }))
vi.mock('@/stores/editor', () => ({ useEditorStore: () => state }))
import ConsolePanel from './ConsolePanel.vue'
beforeEach(() => {
  Object.assign(state, { name: 'example', config: {}, architecture: 'anima', running: false, loading: false, saving: false })
})
it('renders model placement, valid zero shared memory and stale snapshot status', () => {
  localStorage.setItem('hw_monitor_collapsed', 'false')
  const wrapper = mount(ConsolePanel)
  expect(wrapper.text()).toContain('DiT 主模型')
  expect(wrapper.text()).toContain('优化器状态')
  expect(wrapper.text()).toContain('CPU 项表示模型已卸载到内存')
  expect(wrapper.text()).toContain('共享 GPU 内存 0.0 GB')
  expect(wrapper.text()).toContain('节点快照，等待更新')
  wrapper.unmount()
})
it('defaults memory recording off and edits the persisted job setting only while idle', async () => {
  const wrapper = mount(ConsolePanel)
  const checkbox = wrapper.get('input[aria-label="显存分配详细记录"]')
  expect((checkbox.element as HTMLInputElement).checked).toBe(false)
  expect(checkbox.attributes('disabled')).toBeUndefined()
  await checkbox.setValue(true)
  expect(state.config.training_arguments.memory_trace).toBe(true)
  expect(wrapper.text()).toContain('不输出到控制台')
  wrapper.unmount()
})
it.each(['running','loading','saving'])('locks recording during %s', async (field) => {
  Object.assign(state, { [field]: true, config: { training_arguments: { memory_trace: true } } })
  const wrapper = mount(ConsolePanel)
  const checkbox = wrapper.get('input[aria-label="显存分配详细记录"]')
  expect(checkbox.attributes('disabled')).toBeDefined()
  // Even a synthetic event must not bypass the guard.
  ;(checkbox.element as HTMLInputElement).checked = false
  await checkbox.trigger('change')
  expect(state.config.training_arguments.memory_trace).toBe(true)
  wrapper.unmount()
})
it('disables recording when no job is selected or the backend is unsupported', () => {
  for (const values of [{ name: null }, { name: 'example', architecture: 'moss_image' }]) {
    Object.assign(state, values)
    const wrapper = mount(ConsolePanel)
    expect(wrapper.get('input[aria-label="显存分配详细记录"]').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  }
})
