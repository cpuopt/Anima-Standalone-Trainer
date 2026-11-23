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
  it('filters Prompt tabs without losing the All view, and resets the filter on task changes', async () => {
    mocks.api.mockResolvedValue([
      {path:'/a.png',name:'task_e000001_00_20261115120000.png',mtime:1},
      {path:'/b.png',name:'task_e000002_00_20261115120000.png',mtime:2},
      {path:'/c.png',name:'task_e000001_01_20261115120000.png',mtime:3},
    ])
    const wrapper = mount(SamplesPanel)
    await flushPromises()
    const prompt = wrapper.findAll('.sample-filters button').find(button => button.text().startsWith('Prompt 1'))!
    await prompt.trigger('click')
    expect(wrapper.find('.gallery').classes()).toContain('single-prompt')
    expect(wrapper.findAll('.sample-card')).toHaveLength(2)
    await wrapper.find('input[type=search]').setValue('E02')
    expect(wrapper.findAll('.sample-card')).toHaveLength(1)
    expect(wrapper.find('.sample-card').attributes('data-sample-path')).toBe('/b.png')
    await wrapper.find('input[type=search]').setValue('')
    await wrapper.find('select').setValue('oldest')
    expect(wrapper.findAll('.sample-card')[0]!.attributes('data-sample-path')).toBe('/a.png')
    await wrapper.find('.sample-filters button').trigger('click')
    expect(wrapper.findAll('.sample-card')).toHaveLength(3)
    expect(wrapper.find('.gallery').classes()).not.toContain('single-prompt')
    await prompt.trigger('click')
    state.name = 'next'
    await flushPromises()
    expect(wrapper.findAll('.sample-card')).toHaveLength(3)
    wrapper.unmount()
  })
  it('supports touch-friendly multiselect without opening the viewer', async () => {
    mocks.api.mockResolvedValue([{path:'/a.png',name:'a.png',mtime:1}])
    const wrapper = mount(SamplesPanel,{attachTo:document.body})
    await flushPromises()
    await wrapper.findAll('.samples-toolbar button').find(b => b.text() === '多选')!.trigger('click')
    await wrapper.find('.sample-card').trigger('click')
    expect(wrapper.find('.sample-card').classes()).toContain('selected')
    expect(document.querySelector('.sample-lightbox')).toBeNull()
    await wrapper.find('.sample-card').trigger('click')
    expect(wrapper.find('.sample-card').classes()).not.toContain('selected')
    wrapper.unmount()
  })
  it('switches layout without replacing cards and opens the original image', async () => {
    const path = '/api/jobs/samples/samples/a.png'
    const thumbnail = `${path}?thumbnail=1-100`
    mocks.api.mockImplementation(url => Promise.resolve(url === '/api/jobs/samples/samples' ? [{ path, thumbnail, name: 'a.png', mtime: 1 }] : {}))
    const wrapper = mount(SamplesPanel, { attachTo: document.body })
    await flushPromises()
    const toggle = wrapper.get('button[aria-label="组内图片横向排布"]')
    const card = wrapper.get('.sample-card')
    expect(toggle.attributes('aria-pressed')).toBe('false')
    expect(card.get('img').attributes('src')).toBe(thumbnail)
    await toggle.trigger('click')
    expect(toggle.attributes('aria-pressed')).toBe('true')
    expect(wrapper.get('.gallery').classes()).toContain('horizontal')
    expect(wrapper.get('.sample-card').element).toBe(card.element)
    await toggle.trigger('click')
    expect(wrapper.get('.gallery').classes()).not.toContain('horizontal')
    await card.trigger('click')
    expect(document.querySelector('.sample-lightbox img')?.getAttribute('src')).toBe(path)
    await card.get('img').trigger('error')
    expect(card.get('img').attributes('src')).toBe(path)
    wrapper.unmount()
  })
  it('switches Prompt groups independently of the image layout and selection', async () => {
    mocks.api.mockResolvedValue([
      { path: '/a.png', name: 'task_e000001_00_20261115120000.png', mtime: 1 },
      { path: '/b.png', name: 'task_e000001_01_20261115120000.png', mtime: 2 },
    ])
    const wrapper = mount(SamplesPanel)
    await flushPromises()
    const gallery = wrapper.get('.gallery')
    const groupToggle = wrapper.get('button[aria-label="Prompt 分组横向排布"]')
    const imageToggle = wrapper.get('button[aria-label="组内图片横向排布"]')
    const firstCard = wrapper.get('.sample-card')
    await firstCard.trigger('click', { ctrlKey: true })
    expect(groupToggle.attributes('aria-pressed')).toBe('true')
    expect(gallery.classes()).toContain('groups-horizontal')
    await groupToggle.trigger('click')
    expect(groupToggle.attributes('aria-pressed')).toBe('false')
    expect(gallery.classes()).not.toContain('groups-horizontal')
    expect(imageToggle.attributes('aria-pressed')).toBe('false')
    await imageToggle.trigger('click')
    expect(gallery.classes()).toContain('horizontal')
    expect(gallery.classes()).not.toContain('groups-horizontal')
    await groupToggle.trigger('click')
    expect(gallery.classes()).toEqual(expect.arrayContaining(['horizontal', 'groups-horizontal']))
    expect(wrapper.get('.sample-card.selected').element).toBe(firstCard.element)
    wrapper.unmount()
  })
})
