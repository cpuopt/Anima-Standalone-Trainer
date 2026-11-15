import { flushPromises, mount } from '@vue/test-utils'
import { reactive } from 'vue'
import { beforeEach, expect, it, vi } from 'vitest'
const state=vi.hoisted(()=>({store:null as any,api:vi.fn()}))
vi.mock('@/stores/editor',()=>({useEditorStore:()=>state.store}))
vi.mock('@/services/api',()=>({api:state.api,jobUrl:(name:string,suffix='')=>`/api/jobs/${name}${suffix}`}))
import TensorBoardPanel from './TensorBoardPanel.vue'
beforeEach(() => {
  state.api.mockReset()
  state.store = reactive({ name: 'current', architecture: 'anima', running: true, phase: '训练中' })
})
function button(wrapper: ReturnType<typeof mount>, label: string) {
  return wrapper.findAll('button').find(b => b.text() === label)!
}
it('ignores a previous job response after switching jobs',async()=>{
  let resolveFirst!:(v:any)=>void
  state.store=reactive({name:'first'})
  state.api.mockImplementation((url:string)=>url.includes('/first/')?new Promise(resolve=>{resolveFirst=resolve}):Promise.resolve({running:false}))
  const wrapper=mount(TensorBoardPanel)
  state.store.name='second';await flushPromises()
  resolveFirst({running:true,url:'/tensorboard/first/'});await flushPromises()
  expect(wrapper.find('iframe').exists()).toBe(false)
  expect(wrapper.text()).toContain('未运行');wrapper.unmount()
})

it('keeps the native iframe mounted when collapsing, expanding, or refreshing status', async () => {
  state.api.mockResolvedValue({ running: true, url: '/tensorboard/current/' })
  const wrapper = mount(TensorBoardPanel); await flushPromises()
  const frame = wrapper.get('iframe').element
  expect(wrapper.get('iframe').attributes('src')).toBe(new URL('/tensorboard/current/', location.href).href)
  await button(wrapper, '收起辅助栏').trigger('click')
  expect(wrapper.get('#tb-assistance').isVisible()).toBe(false)
  expect(wrapper.get('iframe').element).toBe(frame)
  expect(wrapper.findAll('a').filter(a => a.isVisible())[0]!.attributes('href')).toBe(wrapper.get('iframe').attributes('src'))
  await wrapper.get('.tb-viewer-actions').findAll('button').find(b => b.text() === '刷新状态')!.trigger('click'); await flushPromises()
  expect(wrapper.get('iframe').element).toBe(frame)
  await button(wrapper, '展开辅助栏').trigger('click')
  expect(wrapper.get('#tb-assistance').attributes('style') || '').not.toContain('display: none')
  expect(button(wrapper, '收起辅助栏').attributes('aria-expanded')).toBe('true')
  await button(wrapper, '重新加载页面').trigger('click')
  expect(wrapper.get('iframe').element).not.toBe(frame)
  wrapper.unmount()
})

it('launches and stops only the TensorBoard service, with accurate busy labels', async () => {
  state.api.mockResolvedValueOnce({ running: false })
  const wrapper = mount(TensorBoardPanel); await flushPromises()
  let complete!: (value: any) => void
  state.api.mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
  await button(wrapper, '启动 TensorBoard').trigger('click')
  expect(button(wrapper, '正在启动…').attributes('disabled')).toBeDefined()
  expect(state.api).toHaveBeenLastCalledWith('/api/jobs/current/tensorboard', expect.objectContaining({ method: 'POST' }))
  complete({ url: '/tensorboard/current/' }); await flushPromises()
  expect(wrapper.find('iframe').exists()).toBe(true)
  state.api.mockResolvedValueOnce({ success: true })
  await button(wrapper, '停止服务').trigger('click'); await flushPromises()
  expect(state.api).toHaveBeenLastCalledWith('/api/jobs/current/tensorboard/stop', expect.objectContaining({ method: 'POST' }))
  expect(wrapper.find('iframe').exists()).toBe(false)
  expect(state.store.running).toBe(true)
  wrapper.unmount()
})

it('retains the loaded iframe and shows an error if stopping fails', async () => {
  state.api.mockResolvedValueOnce({ running: true, url: '/tensorboard/current/' })
  const wrapper = mount(TensorBoardPanel); await flushPromises()
  const frame = wrapper.get('iframe').element
  state.api.mockRejectedValueOnce(new Error('停止失败'))
  await button(wrapper, '停止服务').trigger('click'); await flushPromises()
  expect(wrapper.get('[role=alert]').text()).toBe('停止失败')
  expect(wrapper.get('iframe').element).toBe(frame)
  expect(button(wrapper, '停止服务').attributes('disabled')).toBeUndefined()
  wrapper.unmount()
})

it.each(['anima', 'krea2', 'moss_image'])('shows the architecture-specific relative log path for %s', async architecture => {
  state.store.architecture = architecture
  state.api.mockResolvedValue({ running: false })
  const wrapper = mount(TensorBoardPanel); await flushPromises()
  expect(wrapper.get('.tb-path').text()).toBe(`current/${architecture === 'anima' ? 'logs/' : 'output/tensorboard/'}`)
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  await button(wrapper, '复制相对路径').trigger('click'); await flushPromises()
  expect(writeText).toHaveBeenCalledWith(wrapper.get('.tb-path').text())
  expect(wrapper.text()).toContain('已复制任务相对路径')
  wrapper.unmount()
})

it('offers a status refresh when the backend reports startup in progress', async () => {
  state.api.mockResolvedValue({ starting: true, running: false, url: '/tensorboard/current/' })
  const wrapper = mount(TensorBoardPanel); await flushPromises()
  expect(wrapper.get('.tb-empty h3').text()).toBe('TensorBoard 正在启动')
  await wrapper.get('.tb-empty button').trigger('click'); await flushPromises()
  expect(state.api).toHaveBeenLastCalledWith('/api/jobs/current/tensorboard/status', expect.objectContaining({ method: 'GET' }))
  expect(wrapper.find('iframe').exists()).toBe(false)
  wrapper.unmount()
})
