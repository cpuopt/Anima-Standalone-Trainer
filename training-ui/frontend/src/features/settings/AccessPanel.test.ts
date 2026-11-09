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
it('remote UI cannot reveal access codes or manage directory grants', async () => {
  mocks.api.mockResolvedValue({local:false})
  const wrapper = mount(AccessPanel); await flushPromises()
  expect(wrapper.text()).not.toContain('显示访问码'); expect(wrapper.text()).toContain('退出登录')
  expect(mocks.api).toHaveBeenCalledTimes(1); wrapper.unmount()
})
