import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import DatasetAssetManager from './DatasetAssetManager.vue'
const mocks = vi.hoisted(() => ({ api: vi.fn(), upload: vi.fn() }))
vi.mock('@/services/api', () => ({ api: mocks.api }))
vi.mock('./dataset-files', async original => ({ ...(await original<typeof import('./dataset-files')>()), uploadDatasetFile: mocks.upload }))
const passthrough = { template: '<div><slot /></div>' }
const global = { stubs: Object.fromEntries(['DialogRoot','DialogPortal','DialogOverlay','DialogContent','DialogTitle','DialogDescription','DialogClose'].map(name => [name, passthrough])) }
const props = { directory: '', mode: 'import' as const }
function button(wrapper: any, text: string) { return wrapper.findAll('button').find((b: any) => b.text().includes(text))! }
async function choose(wrapper: any, name = 'a.png') {
  const input = wrapper.find('input[type=file]')
  Object.defineProperty(input.element, 'files', { value: [new File(['xx'], name)], configurable: true })
  await input.trigger('change')
}
const summary = { images: 2, captions: 1, missing: 1, orphan: 0, bytes: 100, skipped: 0, groups: [{ directory: 'a', images: 1 }, { directory: 'b', images: 1 }] }
describe('dataset asset manager', () => {
  beforeEach(() => { mocks.api.mockReset(); mocks.upload.mockReset(); mocks.upload.mockResolvedValue(undefined) })
  afterEach(() => vi.unstubAllGlobals())
  it('uploads an archive, shows inspection results, and only binds after confirmation', async () => {
    mocks.api.mockImplementation((url: string) => Promise.resolve(url.endsWith('/imports') ? { id: 'new' } : url.endsWith('/prepare') ? { phase: 'ready', summary } : url.endsWith('/commit') ? { directories: [{ path: '/data/a' }, { path: '/data/b' }] } : {}))
    const wrapper = mount(DatasetAssetManager, { props, global })
    await choose(wrapper, 'data.7z'); await button(wrapper, '上传并检查').trigger('click'); await flushPromises()
    expect(mocks.upload).toHaveBeenCalledWith('new', expect.objectContaining({ path: 'data.7z' }), expect.any(AbortSignal), expect.any(Function))
    expect(wrapper.text()).toContain('缺 Caption 1'); expect(wrapper.emitted('imported')).toBeUndefined()
    await button(wrapper, '确认导入并绑定').trigger('click'); await flushPromises()
    expect(wrapper.emitted('imported')).toEqual([[['/data/a', '/data/b']]])
    wrapper.unmount()
  })
  it('shows upload progress, aborts on unmount and discards staging', async () => {
    mocks.api.mockImplementation(() => Promise.resolve({ id: 'cancel-me' }))
    let signal: AbortSignal | undefined
    mocks.upload.mockImplementation((_id, _file, incoming, progress) => {
      signal = incoming; progress(1)
      return new Promise((_resolve, reject) => incoming.addEventListener('abort', () => reject(new DOMException('cancel', 'AbortError'))))
    })
    const wrapper = mount(DatasetAssetManager, { props, global }); await choose(wrapper)
    await button(wrapper, '上传并检查').trigger('click'); await flushPromises()
    expect(wrapper.text()).toContain('上传 50%'); wrapper.unmount(); await flushPromises()
    expect(signal?.aborted).toBe(true)
    expect(mocks.api).toHaveBeenCalledWith('/api/datasets/imports/cancel-me', { method: 'DELETE' })
  })
  it('allows retry after failure and never commits a failed upload', async () => {
    let next = 0
    mocks.api.mockImplementation((url: string) => Promise.resolve(url.endsWith('/imports') ? { id: String(++next) } : url.endsWith('/prepare') ? { phase: 'ready', summary } : {}))
    mocks.upload.mockRejectedValueOnce(Error('connection failed')).mockResolvedValue(undefined)
    const wrapper = mount(DatasetAssetManager, { props, global }); await choose(wrapper)
    await button(wrapper, '上传并检查').trigger('click'); await flushPromises()
    expect(wrapper.text()).toContain('connection failed')
    expect(mocks.api.mock.calls.some(([url]) => url.endsWith('/commit'))).toBe(false)
    await button(wrapper, '上传并检查').trigger('click'); await flushPromises()
    expect(wrapper.text()).toContain('确认导入并绑定 2 个目录')
    wrapper.unmount()
  })
  it('previews same-name TXT safely, supports orphan TXT and keeps browse available while locked', async () => {
    const image = { name: 'a.png', path: 'a.png', caption: 'a.txt', kind: 'image' }
    mocks.api.mockImplementation((url: string) => Promise.resolve(url.endsWith('/bind') ? { id: 'root', path: '/data' } : { folders: [], items: [image], total: 1, pageSize: 60, images: 1, missing: 0, orphan: 0 }))
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('<script>alert(1)</script>'))))
    const wrapper = mount(DatasetAssetManager, { props: { directory: '/data', mode: 'browse', disabled: true }, global })
    await flushPromises(); await wrapper.find('.image-card').trigger('click'); await flushPromises()
    expect(wrapper.find('.caption-text').text()).toBe('<script>alert(1)</script>'); expect(wrapper.find('.caption-text script').exists()).toBe(false)
    expect(wrapper.find('img.large-preview').attributes('src')).toContain('path=a.png')
    expect(button(wrapper, '打开预览').attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })
})
