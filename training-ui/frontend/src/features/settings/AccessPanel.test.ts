import { beforeEach, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import AccessPanel from './AccessPanel.vue'
const mocks = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock('@/services/api', () => ({ api: mocks.api }))
beforeEach(() => { mocks.api.mockReset() })
it('explains unrestricted authenticated previews without directory grant controls', () => {
  const wrapper = mount(AccessPanel)
  expect(wrapper.text()).toContain('登录不会自动过期')
  expect(wrapper.text()).toContain('无需目录授权')
  expect(wrapper.text()).toContain('退出登录')
  expect(wrapper.find('input[aria-label="授权根目录"]').exists()).toBe(false)
  expect(mocks.api).not.toHaveBeenCalled()
  wrapper.unmount()
})
it('shows logout failures', async () => {
  mocks.api.mockRejectedValue(Error('connection failed'))
  const wrapper = mount(AccessPanel)
  await wrapper.find('button').trigger('click')
  expect(wrapper.find('[role="alert"]').text()).toBe('connection failed')
  wrapper.unmount()
})
