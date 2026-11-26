import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory } from 'vue-router'
import App from './App.vue'
import { createAppRouter } from '@/router'
import { useEditorStore } from '@/stores/editor'
import { api } from '@/services/api'

vi.mock('@/services/api', () => ({
  api: vi.fn(),
  jobUrl: (name: string, suffix = '') => `/api/jobs/${encodeURIComponent(name)}${suffix}`,
}))

const mockApi = vi.mocked(api)
const wrappers: VueWrapper[] = []

function makeJobDoc(name: string) {
  return {
    name,
    architecture: 'anima',
    config: {
      architecture: 'anima',
      training_arguments: { output_name: name, learning_rate: 0.00005, lr_scheduler: 'cosine' },
      network_arguments: { network_module: 'networks.lora_anima', network_dim: 16, network_alpha: 16 },
    },
    dataset: {
      general: { enable_bucket: true },
      datasets: [{ resolution: 1024, batch_size: 1, subsets: [{ image_dir: 'images', num_repeats: 1 }] }],
    },
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  mockApi.mockReset()
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('WebSocket', class {
    static OPEN = 1
    static CLOSING = 2
    readyState = 1
    onopen: (() => void) | null = null
    onmessage: ((e: any) => void) | null = null
    onclose: (() => void) | null = null
    onerror: (() => void) | null = null
    send() {}
    close() {}
  })
  mockApi.mockImplementation(async (url: string) => {
    if (url === '/api/architectures') return { architectures: { anima: { display_name: 'Anima', training_section: 'anima_arguments', global_paths: {} } } }
    if (url === '/api/global-config') return { ui: { theme: 'github-dark' }, model_paths: {} }
    if (url === '/api/system/gpus') return [{ index: 0, name: 'RTX 4090' }]
    if (url === '/api/jobs') return [{ name: 'task #1', architecture: 'anima', running: false }, { name: 'job2', architecture: 'anima', running: false }]
    if (url === '/api/training-queue') return { active: null, pending: [], lastFailure: null }
    if (url === '/api/jobs/task%20%231') return makeJobDoc('task #1')
    if (url === '/api/jobs/job2') return makeJobDoc('job2')
    if (url.endsWith('/prompts')) return { prompts: ['a fox --w 1024 --h 1024 --s 20 --l 3.5 --d 42'] }
    if (url.endsWith('/train/status')) return { running: false, phase: null, operation: null }
    if (url.endsWith('/samples')) return [{ name: 'img.png', dir: 'output', mtime: 1, path: '/samples/img.png' }]
    if (url.endsWith('/tensorboard/status')) return { running: true, url: `/tensorboard/demo/` }
    if (url.includes('/artifacts')) return { items: [], total: 0, pageSize: 40, models: 0, samples: 0, running: false, truncated: false }
    if (url.endsWith('/backends/krea2/status')) return { installed: true }
    if (url.endsWith('/backends/moss_image/status')) return { dependencies: true, cuda: '12.4' }
    return {}
  })
})

afterEach(() => {
  wrappers.splice(0).forEach(w => w.unmount())
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function mountAt(initialPath: string) {
  const router = createAppRouter(createMemoryHistory())
  await router.push(initialPath)
  await router.isReady()
  const w = mount(App, {
    attachTo: document.body,
    global: { plugins: [router] },
  })
  wrappers.push(w)
  await flushPromises()
  await flushPromises()
  return { w, router, store: useEditorStore() }
}

describe('Vue Router + KeepAlive + isolated TensorBoard', () => {
  it('offers to queue a task during another training run and shows its position in the sidebar', async () => {
    const original = mockApi.getMockImplementation()!
    let pending: string[] = []
    mockApi.mockImplementation(async (url, options) => {
      if (url === '/api/training-queue') return { active: 'job2', pending, lastFailure: null }
      if (url.endsWith('/train/start') && options?.method === 'POST') {
        pending = ['task #1']
        return { success: true, queued: true }
      }
      return original(url, options)
    })
    const { w, router } = await mountAt('/jobs/task%20%231/training')
    const train = w.get('button.train-button')
    expect(train.text()).toBe('加入训练队列')
    expect(w.get('.training-queue').text()).toContain('job2')
    await train.trigger('click')
    await flushPromises()
    expect(train.text()).toBe('已加入训练队列')
    expect(train.attributes('disabled')).toBeDefined()
    expect(w.get('.queue-list li').text()).toBe('task #1')
    expect(router.currentRoute.value.path).toBe('/jobs/task%20%231/training')
  })

  it('supports deep-link routes with encoded job names', async () => {
    const { w, router, store } = await mountAt('/jobs/task%20%231/samples')
    expect(store.name).toBe('task #1')
    expect(router.currentRoute.value.name).toBe('job-samples')
    expect(w.find('.samples-panel').exists()).toBe(true)
  })

  it('preserves KeepAlive panel state and keeps TensorBoard iframe attached across tab switches', async () => {
    const { w, router, store } = await mountAt('/jobs/task%20%231/console')
    const searchInput = w.get('.console-log-toolbar input[type="search"]')
    await searchInput.setValue('loss_spike')

    await w.findAll('.tabs button').find(b => b.text() === 'TensorBoard')!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/jobs/task%20%231/tensorboard')

    const iframe = w.get('[data-panel="tensorboard"] iframe').element
    expect(iframe.isConnected).toBe(true)

    await w.findAll('.tabs button').find(b => b.text() === '控制台')!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/jobs/task%20%231/console')
    expect((w.get('.console-log-toolbar input[type="search"]').element as HTMLInputElement).value).toBe('loss_spike')
    expect(iframe.isConnected).toBe(true)
    expect(w.find('[data-panel="tensorboard"]').isVisible()).toBe(false)

    // Switch to another job: resets KeepAlive cache and destroys previous TensorBoard iframe
    await w.findAll('.job-item').find(b => b.text().includes('job2'))!.trigger('click')
    await flushPromises()
    await flushPromises()
    expect(store.name).toBe('job2')
    expect(router.currentRoute.value.fullPath).toBe('/jobs/job2/console')
    expect((w.get('.console-log-toolbar input[type="search"]').element as HTMLInputElement).value).toBe('')
    expect(iframe.isConnected).toBe(false)
    expect(w.find('[data-panel="tensorboard"]').exists()).toBe(false)
  })

  it('preserves active job and dirty state when visiting /settings and returning', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { w, router, store } = await mountAt('/jobs/task%20%231/training')

    store.config.training_arguments.output_name = 'edited_name'
    await flushPromises()
    expect(store.dirty).toBe(true)

    await w.findAll('.tabs button').find(b => b.text() === '设置')!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('settings')
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(store.name).toBe('task #1')

    await w.findAll('.tabs button').find(b => b.text() === '训练')!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/jobs/task%20%231/training')
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(store.config.training_arguments.output_name).toBe('edited_name')
  })

  it('guards dirty job switches (including browser back/navigation) and restores route if declined', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    const { w, router, store } = await mountAt('/jobs/task%20%231/training')
    store.config.training_arguments.output_name = 'unsaved_change'
    await flushPromises()
    expect(store.dirty).toBe(true)

    confirmSpy.mockReturnValueOnce(false)
    await w.findAll('.job-item').find(b => b.text().includes('job2'))!.trigger('click')
    await flushPromises()
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(router.currentRoute.value.fullPath).toBe('/jobs/task%20%231/training')
    expect(store.name).toBe('task #1')

    confirmSpy.mockReturnValueOnce(true)
    await router.push('/jobs/job2/training')
    await flushPromises()
    await flushPromises()
    expect(confirmSpy).toHaveBeenCalledTimes(2)
    expect(router.currentRoute.value.fullPath).toBe('/jobs/job2/training')
    expect(store.name).toBe('job2')
  })

  it('redirects unknown jobs to home welcome page', async () => {
    const { w, router, store } = await mountAt('/jobs/nonexistent/training')
    expect(router.currentRoute.value.name).toBe('home')
    expect(store.name).toBeNull()
    expect(w.find('.welcome').exists()).toBe(true)
  })
})
