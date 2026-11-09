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
  async function browse(items: any[]) {
    mocks.api.mockImplementation((url: string) => Promise.resolve(url.endsWith('/bind') ? { id: 'root', path: '/data' } : { folders: [], items, total: items.length, pageSize: 60, images: items.length, missing: 0, orphan: 0 }))
    const wrapper = mount(DatasetAssetManager, { props: { directory: '/data', mode: 'browse' }, global })
    await flushPromises()
    return wrapper
  }
  const image = (name: string, caption: string | null = `${name}.txt`) => ({ name, path: name, caption, kind: 'image' })
  it('shows original, tags and verbatim multiline prose as safe text', async () => {
    const text = 'solo, red hair\r\n  <script>alert(1)</script>\r\n\r\nLast line.\r\n'
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(text))))
    const wrapper = await browse([image('a.png')])
    await wrapper.find('.image-card').trigger('click'); await flushPromises()
    expect(wrapper.findAll('.caption-text')).toHaveLength(4)
    expect(wrapper.findAll('.caption-text')[0]!.element.textContent).toBe(text)
    expect(wrapper.find('.caption-tags').text()).toBe('solo, red hair')
    expect(wrapper.find('.caption-natural-language').element.textContent).toBe('  <script>alert(1)</script>\r\n\r\nLast line.')
    expect(wrapper.find('.caption-natural-language script').exists()).toBe(false)
    await wrapper.setProps({ captionConfig: { caption_prefix: '<b>trigger</b>', caption_suffix: 'end', tags_suffix: 'tags end', natural_language_prefix: 'Describe:' } })
    expect(wrapper.find('.caption-processed').element.textContent).toBe('<b>trigger</b> solo, red hair tags end\r\nDescribe:   <script>alert(1)</script>\r\n\r\nLast line. end')
    expect(wrapper.find('.caption-processed .prompt-prefix').text()).toBe('<b>trigger</b>')
    expect(wrapper.find('.caption-processed .prompt-tags-suffix').text()).toBe('tags end')
    expect(wrapper.find('.caption-processed .prompt-natural-prefix').text()).toBe('Describe:')
    expect(wrapper.find('.caption-processed .prompt-suffix').text()).toBe('end')
    expect(wrapper.find('.caption-processed b, .caption-processed script').exists()).toBe(false)
    expect(wrapper.text()).toContain('多行：首行 Tags')
    wrapper.unmount()
  })
  it('shows split for orphan TXT and empty parts', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(''))))
    const wrapper = await browse([{ name: 'orphan.txt', path: 'orphan.txt', caption: 'orphan.txt', kind: 'text' }])
    await wrapper.find('.image-card').trigger('click'); await flushPromises()
    expect(wrapper.find('.caption-tags').text()).toBe('（无 Tags）')
    expect(wrapper.find('.caption-natural-language').text()).toBe('（无自然语言）')
    expect(wrapper.find('.large-preview').exists()).toBe(false)
    wrapper.unmount()
  })
  it('clears split during loading, ignores stale replies, and clears missing/error selections', async () => {
    let finishOld!: (value: Response) => void
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { finishOld = resolve }))
      .mockResolvedValueOnce(new Response('solo\nNew description.'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'unreadable' }), { status: 500 }))
    vi.stubGlobal('fetch', fetcher)
    const wrapper = await browse([image('old'), image('new'), image('missing', null), image('error')])
    const cards = wrapper.findAll('.image-card')
    await cards[0]!.trigger('click'); await flushPromises()
    expect(wrapper.find('.caption-tags').exists()).toBe(false)
    await cards[1]!.trigger('click'); await flushPromises()
    expect(wrapper.find('.caption-natural-language').text()).toBe('New description.')
    finishOld(new Response('wrong\nOld description.')); await flushPromises()
    expect(wrapper.find('.caption-natural-language').text()).toBe('New description.')
    await cards[2]!.trigger('click'); await flushPromises()
    expect(wrapper.find('.caption-tags').exists()).toBe(false)
    expect(wrapper.text()).toContain('未找到同名')
    await cards[3]!.trigger('click'); await flushPromises()
    expect(wrapper.text()).toContain('unreadable')
    expect(wrapper.find('.caption-tags').exists()).toBe(false)
    wrapper.unmount()
  })
})
