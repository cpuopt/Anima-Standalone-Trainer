import { beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import AccessPanel from './AccessPanel.vue'
const mocks = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock('@/services/api', () => ({ api: mocks.api }))
beforeEach(() => { mocks.api.mockReset() })
it('localhost manages directory grants without password reveal or reset controls', async () => {
  mocks.api.mockImplementation((url: string) => Promise.resolve(url.endsWith('/status') ? {local:true} : {roots:['/safe']}))
  const wrapper = mount(AccessPanel); await flushPromises()
  expect(wrapper.text()).toContain('/safe')
  expect(wrapper.text()).toContain('登录不会自动过期')
  expect(wrapper.text()).not.toContain('显示访问码')
  expect(wrapper.text()).not.toContain('重置访问码')
  expect(wrapper.text()).toContain('退出登录')
  expect(mocks.api).not.toHaveBeenCalledWith('/api/access/code')
  wrapper.unmount()
})
it('remote UI can load and manage directory grants', async () => {
  mocks.api.mockImplementation((_url: string, options?: any) => Promise.resolve({ roots: options?.method === 'POST' ? ['/remote'] : ['/safe'] }))
  const wrapper = mount(AccessPanel); await flushPromises()
  expect(wrapper.text()).toContain('/safe')
  await wrapper.find('input[aria-label="授权根目录"]').setValue('/remote')
  await wrapper.findAll('button').find(button => button.text() === '授权目录')!.trigger('click'); await flushPromises()
  expect(mocks.api).toHaveBeenCalledWith('/api/datasets/authorized-roots', { method: 'POST', body: { path: '/remote', remove: false } })
  expect(wrapper.text()).toContain('/remote')
  expect(wrapper.text()).not.toContain('仅限 localhost')
  wrapper.unmount()
})
