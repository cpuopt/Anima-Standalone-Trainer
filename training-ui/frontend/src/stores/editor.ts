import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { api, jobUrl } from '@/services/api'
import { canonical, clone, type Config, type JobDocument, type JobSummary } from '@/domain/types'
import { Krea2 } from '@/domain/legacy'
import { parsePromptLine, serializePrompt, defaultNegativePrompt, applyGlobalNegative } from '@/features/prompts/model'
import { validateConfig } from '@/features/training/rules'

export const useEditorStore = defineStore('editor', () => {
  const name = ref<string | null>(null)
  const config = ref<Config>({})
  const dataset = ref<Config>({})
  const architecture = ref('anima')
  const prompts = ref<any[]>([])
  const negativePrompt = ref(defaultNegativePrompt)
  const jobs = ref<JobSummary[]>([])
  const registry = ref<any>({})
  const globalConfig = ref<Config>({})
  const gpus = ref<any[]>([])
  const error = ref('')
  const fieldErrors = ref<Record<string, string>>({})
  const notice = ref('')
  const loading = ref(false)
  const saving = ref(false)
  const running = ref(false)
  const phase = ref<string | null>(null)
  const operation = ref<string | null>(null)
  const logs = ref('')
  const hardware = ref<any>(null)
  const connected = ref(false)
  const runtimeTick = ref(0)
  const configSnapshot = ref('{}'), datasetSnapshot = ref('{}'), promptSnapshot = ref('[]')
  const globalSnapshot = ref('{}')
  const savedNegative = ref(defaultNegativePrompt)
  const dirty = computed(() => Boolean(name.value) && (
    canonical(config.value) !== configSnapshot.value || canonical(dataset.value) !== datasetSnapshot.value ||
    canonical(prompts.value) !== promptSnapshot.value || negativePrompt.value !== savedNegative.value))
  const globalDirty = computed(() => canonical(globalConfig.value) !== globalSnapshot.value)
  const locked = computed(() => loading.value || saving.value || (architecture.value === 'krea2' && running.value))
  let requestVersion = 0, controller: AbortController | null = null
  let socket: WebSocket | null = null, reconnect: ReturnType<typeof setTimeout> | null = null
  let statusTimer: ReturnType<typeof setInterval> | null = null, disposed = false

  const touch = () => {} // Compatibility for feature components; dirty is derived from complete drafts.
  async function loadJobs() { jobs.value = await api('/api/jobs') }
  async function initialize() {
    disposed = false
    const results = await Promise.allSettled([
      api('/api/architectures').then(v => { registry.value = v }),
      api('/api/global-config').then(v => { globalConfig.value = v; globalSnapshot.value = canonical(v) }),
      api('/api/system/gpus').then(v => { gpus.value = Array.isArray(v) ? v : (v.gpus || []) }),
      loadJobs(),
    ])
    const failures = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[]
    if (failures.length) error.value = failures.map(r => String(r.reason.message || r.reason)).join('; ')
    connect()
    statusTimer = setInterval(() => { void refreshStatus().catch(() => {}) }, 5000)
    const last = localStorage.getItem('lastJob')
    if (last && jobs.value.some(j => j.name === last)) await selectJob(last)
  }
  async function selectJob(job: string) {
    if (saving.value) throw Error('请等待保存完成后切换任务')
    const version = ++requestVersion
    controller?.abort(); controller = new AbortController()
    loading.value = true; error.value = ''; name.value = null; running.value = false
    logs.value = ''; phase.value = null; operation.value = null
    try {
      const [doc, lines, status] = await Promise.all([
        api<JobDocument>(jobUrl(job), { signal: controller.signal }),
        api<{ prompts: string[] }>(jobUrl(job, '/prompts'), { signal: controller.signal }),
        api(jobUrl(job, '/train/status'), { signal: controller.signal }),
      ])
      if (version !== requestVersion) return
      name.value = doc.name; architecture.value = doc.architecture
      config.value = clone(doc.config); dataset.value = clone(doc.dataset)
      prompts.value = lines.prompts.map(parsePromptLine)
      let transient: any = {}
      try { transient = JSON.parse(localStorage.getItem(`prompt_transient_${job}`) || '{}') } catch { /* ignore corrupt cache */ }
      negativePrompt.value = transient.negative_prompt ?? (doc.architecture === 'krea2' ? '' : defaultNegativePrompt)
      configSnapshot.value = canonical(config.value); datasetSnapshot.value = canonical(dataset.value)
      promptSnapshot.value = canonical(prompts.value); savedNegative.value = negativePrompt.value
      running.value = status.running; phase.value = status.phase; operation.value = status.operation
      localStorage.setItem('lastJob', job)
      subscribe()
    } catch (e: any) {
      if (version === requestVersion && e.name !== 'AbortError') { error.value = e.message; throw e }
    } finally { if (version === requestVersion) loading.value = false }
  }
  function validate() {
    if (Object.keys(fieldErrors.value).length) throw Error(Object.values(fieldErrors.value).join('; '))
    if (architecture.value === 'krea2') { Krea2.validate(config.value); Krea2.validateDataset(dataset.value) }
    const sets = Array.isArray(dataset.value.datasets) ? dataset.value.datasets : [dataset.value.datasets].filter(Boolean)
    for (const d of sets) {
      const subsets = Array.isArray(d.subsets) ? d.subsets : [d.subsets].filter(Boolean)
      const paths = subsets.map((s: any) => String(s.image_dir || '').trim().toLowerCase()).filter(Boolean)
      if (new Set(paths).size !== paths.length) throw Error('数据子集存在重复图像目录')
    }
  }
  async function save() {
    if (!name.value || saving.value || loading.value) throw Error('当前任务不可保存')
    if (architecture.value === 'krea2' && running.value && (canonical(config.value) !== configSnapshot.value || canonical(dataset.value) !== datasetSnapshot.value)) throw Error('请先停止 Krea 2 再修改配置或数据集')
    saving.value = true; error.value = ''; notice.value = ''
    const target = name.value
    // Save each resource separately so a later failure cannot mark unsaved resources clean.
    try {
      validate()
      const cfg = clone(config.value), ds = clone(dataset.value), ps = clone(prompts.value), neg = negativePrompt.value
      await validateConfig(cfg)
      if (canonical(cfg) !== configSnapshot.value) {
        await api(jobUrl(target), { method: 'PUT', body: { config: cfg } })
        configSnapshot.value = canonical(cfg)
      }
      if (canonical(ds) !== datasetSnapshot.value) {
        await api(jobUrl(target), { method: 'PUT', body: { dataset: ds } })
        datasetSnapshot.value = canonical(ds)
      }
      if (canonical(ps) !== promptSnapshot.value || neg !== savedNegative.value) {
        const negativeChanged = neg !== savedNegative.value
        if (negativeChanged) applyGlobalNegative(ps, neg)
        await api(jobUrl(target, '/prompts'), { method: 'PUT', body: { prompts: ps.filter(p => p.text?.trim()).map(p => serializePrompt(p, architecture.value, neg)) } })
        if (negativeChanged) applyGlobalNegative(prompts.value, neg)
        promptSnapshot.value = canonical(ps); savedNegative.value = neg
        let old: any = {}
        try { old = JSON.parse(localStorage.getItem(`prompt_transient_${target}`) || '{}') } catch { /* ignore */ }
        localStorage.setItem(`prompt_transient_${target}`, JSON.stringify({ ...old, negative_prompt: neg }))
      }
      notice.value = running.value ? '已保存；提示词变更将在下次启动时生效，当前训练使用启动快照。' : '已保存'
      await loadJobs()
    } catch (e: any) { error.value = e.message; throw e }
    finally { saving.value = false }
  }
  function discard() {
    config.value = JSON.parse(configSnapshot.value); dataset.value = JSON.parse(datasetSnapshot.value)
    prompts.value = JSON.parse(promptSnapshot.value); negativePrompt.value = savedNegative.value
    error.value = ''; notice.value = '已放弃未保存的修改'
  }
  async function saveGlobal() {
    if (Object.keys(fieldErrors.value).length) throw Error(Object.values(fieldErrors.value).join('; '))
    const targets = globalConfig.value.ui?.lbai_targets
    if (targets !== undefined) {
      if (!Array.isArray(targets)) throw Error('LBAI 目标必须为数组')
      for (const target of targets) {
        const numbers = target.type === 'point' ? [target.value] : [target.min, target.max]
        if (!String(target.name || '').trim() || !['point', 'range'].includes(target.type) || numbers.some((v: any) => typeof v !== 'number' || !Number.isFinite(v) || v < 0) || (target.type === 'range' && target.min > target.max)) throw Error('LBAI 目标名称、类型或数值无效')
      }
    }
    const captured = clone(globalConfig.value)
    await api('/api/global-config', { method: 'PUT', body: captured })
    globalSnapshot.value = canonical(captured); notice.value = '全局设置已保存'
  }
  async function createJob(job: string, arch: string) {
    const result = await api('/api/jobs', { method: 'POST', body: { name: job, architecture: arch } })
    await loadJobs(); await selectJob(result.name)
  }
  async function cloneJob(newName: string) {
    if (!name.value) return
    const result = await api(jobUrl(name.value, '/clone'), { method: 'POST', body: { newName } })
    await loadJobs(); await selectJob(result.name)
  }
  async function deleteJob() {
    if (!name.value || running.value) throw Error('不能删除运行中的任务')
    const target = name.value
    await api(jobUrl(target), { method: 'DELETE' })
    ++requestVersion; controller?.abort()
    name.value = null; config.value = {}; dataset.value = {}; prompts.value = []; logs.value = ''
    localStorage.removeItem('lastJob'); localStorage.removeItem(`prompt_transient_${target}`); localStorage.removeItem(`sample_order_${target}`)
    await loadJobs()
  }
  async function refreshStatus() {
    const target = name.value, version = requestVersion
    if (!target) return
    const s = await api(jobUrl(target, '/train/status'))
    if (target !== name.value || version !== requestVersion) return
    running.value = s.running; phase.value = s.phase; operation.value = s.operation; runtimeTick.value++
  }
  async function startTraining() {
    if (!name.value || running.value) return
    await save()
    logs.value = ''
    await api(jobUrl(name.value, '/train/start'), { method: 'POST' })
    await refreshStatus()
  }
  async function stopTraining() {
    if (!name.value) return
    await api(jobUrl(name.value, '/train/stop'), { method: 'POST' }); await refreshStatus()
  }
  function subscribe() {
    if (socket?.readyState === WebSocket.OPEN && name.value) socket.send(JSON.stringify({ type: 'subscribe', job: name.value }))
  }
  function connect() {
    if (disposed || socket && socket.readyState < WebSocket.CLOSING) return
    // The server replays the current run's buffer on subscribe; reset rather than append duplicates.
    logs.value = ''
    socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/`)
    const current = socket
    current.onopen = () => { if (current !== socket) return; connected.value = true; subscribe() }
    current.onmessage = event => {
      if (current !== socket) return
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === 'hw_stats') { hardware.value = msg.data; return }
        if (!name.value || msg.job !== name.value) return
        if (msg.type === 'log') logs.value = (logs.value + msg.data).slice(-500000)
        if (msg.type === 'status') { running.value = msg.data === 'running'; void refreshStatus().catch(() => {}) }
        runtimeTick.value++
      } catch { /* malformed events do not break the connection */ }
    }
    current.onclose = () => {
      if (current !== socket) return
      connected.value = false
      if (!disposed) reconnect = setTimeout(connect, 2000)
    }
    current.onerror = () => current.close()
  }
  function dispose() {
    disposed = true; ++requestVersion; controller?.abort()
    if (reconnect) clearTimeout(reconnect)
    if (statusTimer) clearInterval(statusTimer)
    socket?.close(); socket = null; connected.value = false
  }
  return { name, config, dataset, architecture, prompts, negativePrompt, jobs, registry, globalConfig, gpus, error, fieldErrors, notice,
    loading, saving, running, phase, operation, logs, hardware, connected, runtimeTick, dirty, globalDirty, locked,
    touch, initialize, loadJobs, selectJob, validate, save, discard, saveGlobal, createJob, cloneJob, deleteJob,
    refreshStatus, startTraining, stopTraining, dispose }
})
