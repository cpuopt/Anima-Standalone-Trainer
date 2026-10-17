import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import SamplesPanel from './SamplesPanel.vue'
let state: any
const mocks = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock('@/stores/editor', () => ({ useEditorStore: () => state }))
vi.mock('@/services/api', () => ({ api: mocks.api, jobUrl: (name: string, suffix = '') => `/api/jobs/${encodeURIComponent(name)}${suffix}` }))
describe('sample gallery request isolation', () => {
  beforeEach(() => { state = reactive({name:'samples',runtimeTick:0}); mocks.api.mockReset(); localStorage.clear() })
  it('loads metadata from the correct endpoint even when the task name is samples', async () => {
    const path = '/api/jobs/samples/samples/samples/example.png'
    mocks.api.mockImplementation(url => Promise.resolve(url.endsWith('/metadata/samples/example.png') ? {parameters:'test metadata'} : [{path,name:'example.png',mtime:1}]))
    const wrapper = mount(SamplesPanel, {attachTo:document.body})
    await flushPromises()
    await wrapper.find('.sample-card').trigger('click')
    await flushPromises()
    expect(mocks.api).toHaveBeenCalledWith('/api/jobs/samples/metadata/samples/example.png', expect.objectContaining({signal:expect.any(AbortSignal)}))
    expect(document.querySelector('.sample-lightbox')?.textContent).toContain('test metadata')
    wrapper.unmount()
    expect(document.querySelector('.sample-lightbox')).toBeNull()
  })
  it('ignores late sample listings from the previous task', async () => {
    let finish: (value: any) => void = () => {}
    mocks.api.mockImplementation(url => url === '/api/jobs/samples/samples' ? new Promise(resolve => { finish = resolve }) : Promise.resolve([{path:'/api/jobs/next/samples/new.png',name:'new.png',mtime:1}]))
    const wrapper = mount(SamplesPanel)
    state.name = 'next'
    await flushPromises()
    finish([{path:'/api/jobs/samples/samples/old.png',name:'old.png',mtime:1}])
    await flushPromises()
    expect(wrapper.text()).toContain('new.png')
    expect(wrapper.text()).not.toContain('old.png')
    wrapper.unmount()
  })
})
