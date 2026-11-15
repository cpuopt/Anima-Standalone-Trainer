import { flushPromises, mount } from '@vue/test-utils'
import { reactive } from 'vue'
import { beforeEach, expect, it, vi } from 'vitest'
const fixture = vi.hoisted(() => ({ name: 'example' as string | null, config: {} as Record<string,any>,
  architecture: 'anima', running: false, loading: false, saving: false, logs: '', connected: true, error: '', hardware: {
  gpus: [], memoryProcesses: [{ jobName: 'example', pid: 123, device: 'cuda:0', stage: 'sample.after_restore',
    ageMs: 20000, allocated_bytes: 1073741824, windows: { shared_bytes: 0 }, contents: {
      dit: { 'cuda:0': 536870912 }, vae: { cpu: 1048576 }, optimizer: { 'cuda:0': 1048576 },
    } }],
} }))
const state = reactive(fixture)
vi.mock('@/stores/editor', () => ({ useEditorStore: () => state }))
import ConsolePanel from './ConsolePanel.vue'
beforeEach(() => {
  localStorage.clear()
  Object.assign(state, { name: 'example', config: {}, architecture: 'anima', running: false, loading: false, saving: false, logs:'', connected:true })
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
it('searches and filters actual logs and copies all matched lines, including multiline errors', async () => {
  state.logs = '12:00:00 INFO loaded\n12:00:01 WARNING low memory\n12:00:02 ERROR failed\n  File train.py\nValueError: bad value'
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator,'clipboard',{value:{writeText},configurable:true})
  const wrapper = mount(ConsolePanel)
  await wrapper.get('.console-levels button:nth-child(3)').trigger('click')
  expect(wrapper.get('.console-log-output').text()).toContain('File train.py')
  expect(wrapper.get('.console-log-output').text()).not.toContain('low memory')
  await wrapper.findAll('.console-log-toolbar button').find(b => b.text() === '复制日志')!.trigger('click')
  expect(writeText).toHaveBeenCalledWith('12:00:02 ERROR failed\n  File train.py\nValueError: bad value')
  await wrapper.get('input[type=search]').setValue('bad value')
  expect(wrapper.findAll('.console-log-line')).toHaveLength(1)
  await wrapper.findAll('.console-log-toolbar button').find(b => b.text() === '清空显示')!.trigger('click')
  expect(state.logs).toBe('')
  expect(wrapper.text()).toContain('等待训练或采样输出')
  wrapper.unmount()
})
it('bounds rendered rows but preserves the full matching log for copy', async () => {
  state.logs = Array.from({length:1600},(_,i) => `12:00:00 INFO line ${i}`).join('\n')
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator,'clipboard',{value:{writeText},configurable:true})
  const wrapper = mount(ConsolePanel)
  expect(wrapper.findAll('.console-log-line')).toHaveLength(1500)
  await wrapper.get('.console-older').trigger('click')
  await flushPromises()
  expect(wrapper.find('.console-log-line').text()).toContain('line 0')
  await wrapper.findAll('.console-log-toolbar button').find(b => b.text() === '复制日志')!.trigger('click')
  expect(writeText.mock.calls[0]![0].split('\n')).toHaveLength(1600)
  wrapper.unmount()
})
it('keeps a paused window stable as logs arrive and returns to the latest output on demand', async () => {
  state.logs = Array.from({length:1600},(_,i) => `12:00:00 INFO line ${i}`).join('\n')
  const wrapper = mount(ConsolePanel)
  await flushPromises()
  const follow = wrapper.findAll('.console-log-options input')[0]!
  await follow.setValue(false)
  const first = wrapper.find('.console-log-line').text()
  state.logs += '\n12:00:01 INFO new line'
  await flushPromises()
  expect(wrapper.find('.console-log-line').text()).toBe(first)
  expect(wrapper.find('.console-log-output').text()).not.toContain('new line')
  await wrapper.findAll('.console-log-footer button').find(button => button.text() === '回到最新')!.trigger('click')
  await flushPromises()
  expect(wrapper.find('.console-log-output').text()).toContain('new line')
  wrapper.unmount()
})
it('collapses the monitor and provides an explicit way to restore it', async () => {
  const wrapper = mount(ConsolePanel)
  await wrapper.get('.console-collapse').trigger('click')
  expect(wrapper.classes()).toContain('hardware-collapsed')
  expect(wrapper.get('.console-hardware').isVisible()).toBe(false)
  await wrapper.get('.console-expand').trigger('click')
  expect(wrapper.classes()).not.toContain('hardware-collapsed')
  wrapper.unmount()
})
