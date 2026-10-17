import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { api } from '@/services/api'
import { useEditorStore } from '@/stores/editor'
import { Krea2 } from '@/domain/legacy'
vi.mock('@/services/api', () => ({ api: vi.fn(), jobUrl: (name: string, suffix = '') => `/api/jobs/${encodeURIComponent(name)}${suffix}` }))
const request = vi.mocked(api)
const anima = (name = 'anima') => ({ name, architecture: 'anima', config: {
  training_arguments: { output_name: name, learning_rate: .0001, seed: 0, gradient_checkpointing: false, optimizer_args: ['custom=0'] },
  network_arguments: { network_module: 'networks.lora_anima', network_dim: 32, network_alpha: 32 },
  advanced_extension: { enabled: false, text: '', zero: 0 },
}, dataset: { general: { enable_bucket: true }, datasets: [{ resolution: 1024, batch_size: 1, subsets: [{ image_dir: 'images' }] }] } })
function setup(doc = anima()) {
  request.mockImplementation(async (url: string, opts?: any) => {
    if (opts?.method === 'PUT') return { success: true }
    if (url.endsWith('/prompts')) return { prompts: ['a fox --w 1024 --h 1024 --s 20 --l 3.5 --d 0 --unknown keep'] }
    if (url.endsWith('/train/status')) return { running: false, phase: null, operation: null }
    if (url === '/api/jobs') return []
    return JSON.parse(JSON.stringify(doc))
  })
  return useEditorStore()
}
beforeEach(() => { setActivePinia(createPinia()); request.mockReset(); localStorage.clear() })
describe('complete document drafts', () => {
  it('keeps unknown fields, false, empty strings and zero when editing one field', async () => {
    const doc = anima(), store = setup(doc)
    await store.selectJob('anima')
    store.config.training_arguments.output_name = 'changed'
    await store.save()
    const put = request.mock.calls.find(([, options]) => options?.method === 'PUT')!
    expect(put[1]?.body.config).toEqual({ ...doc.config, training_arguments: { ...doc.config.training_arguments, output_name: 'changed' } })
    expect(put[1]?.body).not.toHaveProperty('dataset')
    expect(request.mock.calls.some(([url, opts]) => url.endsWith('/prompts') && opts?.method === 'PUT')).toBe(false)
    expect(store.dirty).toBe(false)
  })
  it('does not rewrite original prompt syntax or any document during a no-op save', async () => {
    const store = setup(); await store.selectJob('anima'); await store.save()
    expect(request.mock.calls.filter(([, o]) => o?.method === 'PUT')).toHaveLength(0)
  })
  it('retains dataset dirty after config succeeds but dataset save fails, then retries only dataset', async () => {
    const store = setup(); await store.selectJob('anima')
    store.config.training_arguments.output_name = 'changed'; store.dataset.general.enable_bucket = false
    const initial = request.getMockImplementation()!
    let fail = true
    request.mockImplementation(async (url, opts) => { if (opts?.body?.dataset && fail) throw Error('disk full'); return initial(url, opts) })
    await expect(store.save()).rejects.toThrow('disk full')
    expect(store.dirty).toBe(true); expect(store.saving).toBe(false)
    fail = false; request.mockClear(); await store.save()
    const puts = request.mock.calls.filter(([, o]) => o?.method === 'PUT')
    expect(puts).toHaveLength(1); expect(puts[0]![1]?.body).toHaveProperty('dataset'); expect(store.dirty).toBe(false)
  })
  it('keeps a newer edit dirty when the previous captured draft finishes saving', async () => {
    const store = setup(); await store.selectJob('anima'); store.config.training_arguments.output_name = 'first'
    let resolve!: (value: any) => void
    request.mockImplementationOnce(() => new Promise(r => { resolve = r }))
    const saving = store.save(); await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
    store.config.training_arguments.output_name = 'second'; resolve({ success: true }); await saving
    expect(store.dirty).toBe(true); expect(store.config.training_arguments.output_name).toBe('second')
  })
  it('ignores old task responses even if transport cancellation is ignored', async () => {
    const store = setup(), previous = request.getMockImplementation()!
    let old!: (value: any) => void
    request.mockImplementation((url, opts) => url === '/api/jobs/old' ? new Promise(r => { old = r }) : url === '/api/jobs/new' ? Promise.resolve(anima('new')) : previous(url, opts))
    const first = store.selectJob('old'); await store.selectJob('new')
    old(anima('old')); await first
    expect(store.name).toBe('new'); expect(store.config.training_arguments.output_name).toBe('new')
    expect(store.loading).toBe(false)
  })
  it('preserves invalid draft on validation failure and supports discard', async () => {
    const store = setup(); await store.selectJob('anima'); store.config.network_arguments.network_dim = 0
    await expect(store.save()).rejects.toThrow('Rank')
    expect(store.config.network_arguments.network_dim).toBe(0); expect(store.dirty).toBe(true)
    store.discard(); expect(store.config.network_arguments.network_dim).toBe(32); expect(store.dirty).toBe(false)
  })
  it('round trips a Krea LoKR config with factor and full without introducing Anima fields', async () => {
    const cfg = Krea2.defaults(); cfg.network_arguments.network_module = Krea2.LOKR_MODULE
    cfg.network_arguments.network_args = ['factor=16', 'full_matrix=True']
    const doc = { name: 'krea', architecture: 'krea2', config: cfg, dataset: Krea2.datasetDefaults() }
    const store = setup(doc); await store.selectJob('krea')
    expect(store.negativePrompt).toBe('')
    store.config.network_arguments.network_dim = 64; await store.save()
    const body = request.mock.calls.find(([, o]) => o?.method === 'PUT')![1]?.body
    expect(body.config.network_arguments.network_args).toEqual(['factor=16', 'full_matrix=True'])
    expect(body.config).not.toHaveProperty('anima_arguments'); expect(store.dirty).toBe(false)
  })
  it('blocks Krea edits while running but allows saving prompt changes for the next run', async () => {
    const cfg = Krea2.defaults(), store = setup({ name:'krea', architecture:'krea2', config:cfg, dataset:Krea2.datasetDefaults() })
    await store.selectJob('krea'); store.running = true; store.config.training_arguments.seed = 123
    await expect(store.save()).rejects.toThrow('先停止')
    store.discard(); store.prompts[0].text = 'changed'; await store.save()
    expect(store.notice).toContain('启动快照'); expect(store.dirty).toBe(false)
  })
  it('keeps an explicit global negative replacement across subsequent prompt edits', async () => {
    const store = setup(); await store.selectJob('anima')
    store.prompts[0].sourceNegative = 'original negative'; store.negativePrompt = 'replacement'
    await store.save(); store.prompts[0].text = 'another fox'; request.mockClear(); await store.save()
    const body = request.mock.calls.find(([url, o]) => url.endsWith('/prompts') && o?.method === 'PUT')![1]?.body
    expect(body.prompts[0]).toContain('--n replacement'); expect(body.prompts[0]).not.toContain('original negative')
  })
  it('never starts a process when autosave validation fails', async () => {
    const store = setup(); await store.selectJob('anima'); store.config.network_arguments.network_dim = 0
    await expect(store.startTraining()).rejects.toThrow('Rank')
    expect(request.mock.calls.some(([url]) => url.endsWith('/train/start'))).toBe(false)
  })
})
