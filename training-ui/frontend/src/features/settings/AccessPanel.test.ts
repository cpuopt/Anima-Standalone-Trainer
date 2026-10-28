import { beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import AccessPanel from './AccessPanel.vue'
const mocks = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock('@/services/api', () => ({ api: mocks.api }))
beforeEach(() => { mocks.api.mockReset() })
it('shows code management only to localhost and does not fetch a code until explicitly requested', async () => {
  mocks.api.mockImplementation((url: string) => Promise.resolve(url.endsWith('/status') ? {local:true} : url.endsWith('/code') ? {code:'fixture-only'} : {roots:['/safe']}))
  const wrapper = mount(AccessPanel); await flushPromises()
  expect(mocks.api).not.toHaveBeenCalledWith('/api/access/code')
  await wrapper.findAll('button').find(b => b.text() === '显示访问码')!.trigger('click'); await flushPromises()
  expect((wrapper.find('input[aria-label="共享访问码"]').element as HTMLInputElement).value).toBe('fixture-only')
  await wrapper.findAll('button').find(b => b.text() === '隐藏访问码')!.trigger('click')
  expect(wrapper.find('input[aria-label="共享访问码"]').exists()).toBe(false)
  wrapper.unmount()
})
it('remote UI cannot reveal access codes or manage directory grants', async () => {
  mocks.api.mockResolvedValue({local:false})
  const wrapper = mount(AccessPanel); await flushPromises()
  expect(wrapper.text()).not.toContain('显示访问码'); expect(wrapper.text()).toContain('退出远程登录')
  expect(mocks.api).toHaveBeenCalledTimes(1); wrapper.unmount()
})
