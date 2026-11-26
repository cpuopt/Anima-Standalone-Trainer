<script setup lang="ts">
import { computed, onActivated, onDeactivated, ref, watch } from 'vue'
import { useEditorStore } from '@/stores/editor'
import { api, jobUrl } from '@/services/api'

interface PreviewItem {
  id: string
  filename: string
  originalName: string
  group: string
  epoch: string
  source: 'sample' | 'upload'
  sourcePath: string | null
  size: number
  mtime: number
}

interface ClientPermissions {
  viewParams: boolean
  downloadDataset: boolean
  downloadLora: boolean
  allowedModels: string[]
  stripModelMetadata?: string[]
}

interface ClientConfig {
  id: string
  token: string
  jobName: string
  clientName: string
  title: string
  note: string
  enabled: boolean
  previews: PreviewItem[]
  permissions: ClientPermissions
  createdAt: number
  updatedAt: number
}

interface SampleItem {
  name: string
  dir: string
  mtime: number
  path: string
}

interface ModelArtifact {
  name: string
  path: string
  size: number
  mtime: number
  ready: boolean
  label: string
}

interface PortalServiceStatus {
  running: boolean
  port: number | null
  requestedPort: number
  startedAt: number | null
  lastError: string | null
}

const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true })
const store = useEditorStore()
const alive = ref(true)
const isActive = computed(() => props.active && alive.value)
onActivated(() => { alive.value = true })
onDeactivated(() => { alive.value = false })

const portalPort = ref(3100)
const portInput = ref(3100)
const serviceStatus = ref<PortalServiceStatus>({
  running: false,
  port: null,
  requestedPort: 3100,
  startedAt: null,
  lastError: null
})
const serviceBusy = ref(false)
const clients = ref<ClientConfig[]>([])
const selectedId = ref<string | null>(null)
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const notice = ref('')

// Create client form
const newClientName = ref('')
const newTitle = ref('')
const newNote = ref('')

// Editable selected client fields
const editClientName = ref('')
const editTitle = ref('')
const editNote = ref('')
const editEnabled = ref(true)
const MODEL_METADATA_FIELDS = [
  'ss_datasets[*].bucket_info',
  'ss_datasets[*].tag_frequency',
  'ss_tag_frequency',
] as const

const permViewParams = ref(false)
const permDownloadDataset = ref(false)
const permDownloadLora = ref(false)
const allowedModels = ref<string[]>([])
const stripModelMetadata = ref<string[]>([])

// Samples & models
const samples = ref<SampleItem[]>([])
const selectedSamples = ref(new Set<string>())
const sampleFilter = ref('')
const models = ref<ModelArtifact[]>([])
const uploadGroup = ref('训练师精选上传')
const uploadInput = ref<HTMLInputElement | null>(null)

const selectedClient = computed(() => clients.value.find(c => c.id === selectedId.value) || null)
const copiedSamplePaths = computed(() => {
  const set = new Set<string>()
  for (const p of selectedClient.value?.previews || []) {
    if (p.source === 'sample' && p.sourcePath) set.add(p.sourcePath)
  }
  return set
})

const filteredSamples = computed(() => {
  const q = sampleFilter.value.trim().toLowerCase()
  if (!q) return samples.value
  return samples.value.filter(s => s.name.toLowerCase().includes(q) || s.dir.toLowerCase().includes(q))
})

function syncDraftFromClient(client: ClientConfig | null) {
  if (!client) return
  editClientName.value = client.clientName
  editTitle.value = client.title
  editNote.value = client.note
  editEnabled.value = client.enabled
  permViewParams.value = client.permissions.viewParams
  permDownloadDataset.value = client.permissions.downloadDataset
  permDownloadLora.value = client.permissions.downloadLora
  allowedModels.value = [...client.permissions.allowedModels]
  stripModelMetadata.value = [...(client.permissions.stripModelMetadata || [])]
}

watch(selectedClient, client => syncDraftFromClient(client), { immediate: true })

function portalOrigin(port = serviceStatus.value.port || portalPort.value) {
  if (typeof window === 'undefined') return `http://localhost:${port}`
  const proto = window.location.protocol === 'https:' ? 'https:' : 'http:'
  const host = window.location.hostname || 'localhost'
  return `${proto}//${host}:${port}`
}

function portalUrl(token: string) {
  return `${portalOrigin()}/p/${encodeURIComponent(token)}`
}

function applyServiceStatus(svc?: PortalServiceStatus | null) {
  if (!svc) return
  serviceStatus.value = svc
  const activePort = svc.port || svc.requestedPort || 3100
  portalPort.value = activePort
  if (svc.running || !serviceBusy.value) {
    portInput.value = activePort
  }
}

function previewThumbUrl(clientId: string, previewId: string) {
  if (!store.name) return ''
  return jobUrl(store.name, `/client-portal/${encodeURIComponent(clientId)}/previews/${encodeURIComponent(previewId)}/image`)
}

function relativeSamplePath(sample: SampleItem) {
  if (!store.name) return sample.path
  const encPrefix = `/api/jobs/${encodeURIComponent(store.name)}/samples/`
  const rawPrefix = `/api/jobs/${store.name}/samples/`
  if (sample.path.startsWith(encPrefix)) return decodeURIComponent(sample.path.slice(encPrefix.length))
  if (sample.path.startsWith(rawPrefix)) return sample.path.slice(rawPrefix.length)
  return sample.path
}

function formatSize(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GiB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`
  return `${(bytes / 1024).toFixed(1)} KiB`
}

async function loadAll() {
  if (!store.name) return
  loading.value = true
  error.value = ''
  try {
    const [portalRes, samplesRes, modelsPage0] = await Promise.all([
      api<{ portalPort: number; service?: PortalServiceStatus | null; clients: ClientConfig[] }>(jobUrl(store.name, '/client-portal')),
      api<SampleItem[]>(jobUrl(store.name, '/samples')).catch(() => []),
      api<{ items: ModelArtifact[]; total?: number; pageSize?: number }>(jobUrl(store.name, '/artifacts?kind=models&page=0'))
        .catch(() => ({ items: [] as ModelArtifact[], total: 0, pageSize: 40 }))
    ])
    const allModels: ModelArtifact[] = Array.isArray(modelsPage0?.items) ? [...modelsPage0.items] : []
    const total = Number(modelsPage0?.total || 0)
    const pageSize = Number(modelsPage0?.pageSize || 40)
    if (total > allModels.length && pageSize > 0) {
      const totalPages = Math.min(10, Math.ceil(total / pageSize))
      for (let page = 1; page < totalPages; page++) {
        const next = await api<{ items: ModelArtifact[] }>(jobUrl(store.name, `/artifacts?kind=models&page=${page}`)).catch(() => ({ items: [] }))
        if (Array.isArray(next?.items)) allModels.push(...next.items)
      }
    }
    portalPort.value = portalRes.portalPort || 3100
    if (portalRes.service) applyServiceStatus(portalRes.service)
    clients.value = portalRes.clients || []
    samples.value = Array.isArray(samplesRes) ? samplesRes : []
    models.value = allModels
    if (selectedId.value && !clients.value.some(c => c.id === selectedId.value)) {
      selectedId.value = clients.value[0]?.id || null
    } else if (!selectedId.value && clients.value.length) {
      selectedId.value = clients.value[0].id
    }
  } catch (e: any) {
    error.value = e.message || '加载客户交付配置失败'
  } finally {
    loading.value = false
  }
}

watch(() => store.name, () => {
  selectedId.value = null
  selectedSamples.value.clear()
  notice.value = ''
  if (isActive.value) void loadAll()
}, { immediate: true })

watch(isActive, active => {
  if (active && store.name) void loadAll()
})

function replaceClientInList(updated: ClientConfig) {
  const idx = clients.value.findIndex(c => c.id === updated.id)
  if (idx >= 0) clients.value[idx] = updated
  else clients.value.unshift(updated)
  syncDraftFromClient(updated)
}

async function createClient() {
  if (!store.name || !newClientName.value.trim()) return
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    const res = await api<{ client: ClientConfig }>(jobUrl(store.name, '/client-portal'), {
      method: 'POST',
      body: {
        clientName: newClientName.value.trim(),
        title: newTitle.value.trim() || `${store.name} · 成果预览`,
        note: newNote.value.trim()
      }
    })
    clients.value.unshift(res.client)
    selectedId.value = res.client.id
    newClientName.value = ''
    newTitle.value = ''
    newNote.value = ''
    notice.value = `已创建客户「${res.client.clientName}」的独立交付链接`
  } catch (e: any) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}

async function saveClientConfig(rotateToken = false) {
  if (!store.name || !selectedClient.value) return
  if (rotateToken && !window.confirm('重置访问码后，原客户链接将立即失效，确认重置？')) return
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    const res = await api<{ client: ClientConfig }>(
      jobUrl(store.name, `/client-portal/${encodeURIComponent(selectedClient.value.id)}`),
      {
        method: 'PUT',
        body: {
          clientName: editClientName.value.trim(),
          title: editTitle.value.trim(),
          note: editNote.value.trim(),
          enabled: editEnabled.value,
          rotateToken,
          permissions: {
            viewParams: permViewParams.value,
            downloadDataset: permDownloadDataset.value,
            downloadLora: permDownloadLora.value,
            allowedModels: allowedModels.value,
            stripModelMetadata: stripModelMetadata.value
          }
        }
      }
    )
    replaceClientInList(res.client)
    notice.value = rotateToken ? '已生成新的客户访问链接' : '客户交付权限与配置已保存并即时生效'
  } catch (e: any) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}

async function removeClient() {
  if (!store.name || !selectedClient.value) return
  if (!window.confirm(`删除客户「${selectedClient.value.clientName}」及其全部预览图副本？不会删除原始训练样例。`)) return
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    const id = selectedClient.value.id
    await api(jobUrl(store.name, `/client-portal/${encodeURIComponent(id)}`), { method: 'DELETE' })
    clients.value = clients.value.filter(c => c.id !== id)
    selectedId.value = clients.value[0]?.id || null
    notice.value = '已删除该客户交付配置及预览副本目录'
  } catch (e: any) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}

async function copyUrl(token: string) {
  const url = portalUrl(token)
  try {
    await navigator.clipboard.writeText(url)
    notice.value = `已复制客户访问链接：${url}`
  } catch {
    notice.value = `请手动复制链接：${url}`
  }
}

function toggleSample(sample: SampleItem) {
  const next = new Set(selectedSamples.value)
  if (next.has(sample.path)) next.delete(sample.path)
  else next.add(sample.path)
  selectedSamples.value = next
}

function selectUnsyncedSamples() {
  const next = new Set(selectedSamples.value)
  for (const s of filteredSamples.value) {
    if (!copiedSamplePaths.value.has(relativeSamplePath(s))) next.add(s.path)
  }
  selectedSamples.value = next
}

async function syncSelectedSamples() {
  if (!store.name || !selectedClient.value || !selectedSamples.value.size) return
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    const res = await api<{ added: number; skipped: number; client: ClientConfig }>(
      jobUrl(store.name, `/client-portal/${encodeURIComponent(selectedClient.value.id)}/previews/sync-samples`),
      { method: 'POST', body: { paths: [...selectedSamples.value] } }
    )
    replaceClientInList(res.client)
    selectedSamples.value.clear()
    notice.value = `已复制 ${res.added} 张预览图到客户独立目录` + (res.skipped ? `（跳过 ${res.skipped} 张已存在）` : '')
  } catch (e: any) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error(`读取文件失败: ${file.name}`))
    reader.readAsDataURL(file)
  })
}

async function uploadSelectedFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const fileList = Array.from(input.files || [])
  if (!fileList.length || !store.name || !selectedClient.value) return
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    const payload = []
    let totalBytes = 0
    for (const file of fileList) {
      totalBytes += file.size
      if (totalBytes > 32 * 1024 * 1024) {
        throw new Error('单次批量上传总大小请控制在 32MB 以内，可分批上传')
      }
      payload.push({
        name: file.name,
        dataUrl: await readAsDataUrl(file),
        group: uploadGroup.value.trim() || '训练师精选上传'
      })
    }
    const res = await api<{ uploaded: number; client: ClientConfig }>(
      jobUrl(store.name, `/client-portal/${encodeURIComponent(selectedClient.value.id)}/previews/upload`),
      { method: 'POST', body: { files: payload } }
    )
    replaceClientInList(res.client)
    notice.value = `已手动上传 ${res.uploaded} 张预览图到客户目录`
  } catch (e: any) {
    error.value = e.message
  } finally {
    input.value = ''
    busy.value = false
  }
}

async function removePreview(previewId: string) {
  if (!store.name || !selectedClient.value) return
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    const res = await api<{ client: ClientConfig }>(
      jobUrl(store.name, `/client-portal/${encodeURIComponent(selectedClient.value.id)}/previews/${encodeURIComponent(previewId)}`),
      { method: 'DELETE' }
    )
    replaceClientInList(res.client)
    notice.value = '已从客户可见列表中移出该预览图（原训练样例保留）'
  } catch (e: any) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}

async function startPortalService() {
  serviceBusy.value = true
  error.value = ''
  notice.value = ''
  try {
    const svc = await api<PortalServiceStatus>('/api/client-portal/service/start', {
      method: 'POST',
      body: { port: Number(portInput.value) || 3100 }
    })
    applyServiceStatus(svc)
    notice.value = `独立客户服务已在端口 ${svc.port} 启动`
  } catch (e: any) {
    error.value = e.message || '启动独立客户服务失败'
  } finally {
    serviceBusy.value = false
  }
}

async function stopPortalService() {
  serviceBusy.value = true
  error.value = ''
  notice.value = ''
  try {
    const svc = await api<PortalServiceStatus>('/api/client-portal/service/stop', { method: 'POST' })
    applyServiceStatus(svc)
    notice.value = '独立客户服务已停止'
  } catch (e: any) {
    error.value = e.message || '停止独立客户服务失败'
  } finally {
    serviceBusy.value = false
  }
}

function toggleModelPath(modelPath: string) {
  const set = new Set(allowedModels.value)
  if (set.has(modelPath)) set.delete(modelPath)
  else set.add(modelPath)
  allowedModels.value = [...set]
}

function isClientMetaKept(field: string) {
  return !stripModelMetadata.value.includes(field)
}

function setClientMetaKept(field: string, kept: boolean) {
  const set = new Set(stripModelMetadata.value)
  if (kept) set.delete(field)
  else set.add(field)
  stripModelMetadata.value = MODEL_METADATA_FIELDS.filter(f => set.has(f))
}
</script>

<template>
  <section class="client-portal-admin" aria-label="客户预览与交付配置">
    <header class="panel cp-header">
      <div>
        <h2>客户预览与交付配置</h2>
        <p class="muted">
          在此直接启停独立端口的客户交付门户（默认 <code>{{ portalPort }}</code> 端口）。
          客户仅能查看复制到独立目录的预览图；付款后再逐项开通参数、数据集与指定 LoRA 模型权限。
        </p>
      </div>
      <div class="cp-service-bar">
        <span class="cp-svc-pill" :class="serviceStatus.running ? 'on' : 'off'">
          <span class="cp-svc-dot" />
          {{ serviceStatus.running ? `运行中 · 端口 ${serviceStatus.port}` : '客户服务未启动' }}
        </span>
        <label class="cp-port-field">
          <span>端口</span>
          <input
            v-model.number="portInput"
            type="number"
            min="1024"
            max="65535"
            :disabled="serviceStatus.running || serviceBusy"
            aria-label="独立客户服务端口"
          />
        </label>
        <button
          v-if="!serviceStatus.running"
          class="button cp-primary-btn"
          :disabled="serviceBusy || busy"
          @click="startPortalService"
        >{{ serviceBusy ? '启动中…' : '启动客户服务' }}</button>
        <button
          v-else
          class="button cp-danger"
          :disabled="serviceBusy || busy"
          @click="stopPortalService"
        >{{ serviceBusy ? '停止中…' : '停止客户服务' }}</button>
        <a
          v-if="serviceStatus.running"
          class="button"
          :href="portalOrigin()"
          target="_blank"
          rel="noopener"
        >打开客户端首页 ↗</a>
        <button class="button" :disabled="loading || busy" @click="loadAll">{{ loading ? '刷新中…' : '刷新数据' }}</button>
      </div>
    </header>

    <p v-if="error" class="banner error" role="alert">{{ error }}</p>
    <p v-if="notice" class="banner notice" role="status">{{ notice }}</p>

    <div class="cp-layout">
      <!-- 左侧：客户列表与新建 -->
      <aside class="panel cp-sidebar">
        <h3>当前任务的客户列表（{{ clients.length }}）</h3>
        <div v-if="clients.length" class="cp-client-list">
          <button
            v-for="c in clients"
            :key="c.id"
            class="cp-client-item"
            :class="{ active: c.id === selectedId }"
            @click="selectedId = c.id"
          >
            <div class="cp-client-row">
              <strong>{{ c.clientName }}</strong>
              <span class="cp-badge" :class="c.enabled ? 'on' : 'off'">{{ c.enabled ? '已启用' : '已停用' }}</span>
            </div>
            <small class="muted">{{ c.previews.length }} 张预览 · {{ (c.permissions.downloadLora || c.permissions.viewParams || c.permissions.downloadDataset) ? '已开交付权限' : '仅预览阶段' }}</small>
          </button>
        </div>
        <p v-else class="muted">尚未为本任务创建客户交付链接。</p>

        <form class="cp-create-form" @submit.prevent="createClient">
          <h3>新建客户交付链接</h3>
          <div class="field">
            <label for="cp-new-name">客户名称</label>
            <input id="cp-new-name" v-model="newClientName" placeholder="例如：Atelier K" required />
          </div>
          <div class="field">
            <label for="cp-new-title">展厅展示标题</label>
            <input id="cp-new-title" v-model="newTitle" :placeholder="`${store.name || '任务'} · 成果预览`" />
          </div>
          <div class="field">
            <label for="cp-new-note">训练师寄语 / 说明（客户可见）</label>
            <textarea id="cp-new-note" v-model="newNote" rows="2" placeholder="选填，例如：推荐权重 0.85，请重点查验 E16 光影表现" />
          </div>
          <button type="submit" class="button cp-primary-btn" :disabled="busy || !newClientName.trim()">创建客户交付配置</button>
        </form>
      </aside>

      <!-- 右侧：所选客户配置工作区 -->
      <div v-if="selectedClient" class="cp-main">
        <!-- 1. 访问链接与基础信息 -->
        <section class="panel">
          <div class="cp-sec-head">
            <h3>1. 独立端口访问链接与基础设置</h3>
            <div class="cp-actions">
              <button class="button" :disabled="busy" @click="copyUrl(selectedClient.token)">复制客户链接</button>
              <a class="button" :href="portalUrl(selectedClient.token)" target="_blank" rel="noopener">新窗口打开 ↗</a>
              <button class="button" :disabled="busy" @click="saveClientConfig(true)">重置访问码</button>
              <button class="button cp-danger" :disabled="busy" @click="removeClient">删除客户</button>
            </div>
          </div>

          <div class="cp-url-box">
            <code>{{ portalUrl(selectedClient.token) }}</code>
            <small v-if="!serviceStatus.running" class="cp-svc-warn">独立客户服务尚未启动，请先点击上方「启动客户服务」再打开或分享此链接。</small>
          </div>

          <div class="fields" style="margin-top:14px;">
            <div class="field">
              <label>客户名称</label>
              <input v-model="editClientName" />
            </div>
            <div class="field">
              <label>展示标题</label>
              <input v-model="editTitle" />
            </div>
            <div class="field field-check">
              <label><input type="checkbox" v-model="editEnabled" /> 启用此访问链接（关闭后客户将无法打开）</label>
            </div>
          </div>
          <div class="field" style="margin-top:12px;">
            <label>训练师备注</label>
            <textarea v-model="editNote" rows="2" />
          </div>
        </section>

        <!-- 2. 付费后权限与指定模型配置 -->
        <section class="panel">
          <div class="cp-sec-head">
            <div>
              <h3>2. 交付权限范围配置（未勾选时客户端严格锁定不可见/不可下）</h3>
              <p class="muted" style="margin:4px 0 0;">客户未付费时请保持全部取消勾选；确认收款后按订单范围逐项开通并保存。</p>
            </div>
            <button class="button cp-primary-btn" :disabled="busy" @click="saveClientConfig(false)">保存权限与基础设置</button>
          </div>

          <div class="cp-perm-grid">
            <label class="cp-perm-card" :class="{ checked: permViewParams }">
              <input type="checkbox" v-model="permViewParams" />
              <div>
                <strong>可见训练参数</strong>
                <small class="muted">开放脱敏后的训练配置、网络维度、学习率及预览图生成参数。</small>
              </div>
            </label>
            <label class="cp-perm-card" :class="{ checked: permDownloadDataset }">
              <input type="checkbox" v-model="permDownloadDataset" />
              <div>
                <strong>下载数据集</strong>
                <small class="muted">允许客户查看数据集统计并一键打包下载图像与标注文件。</small>
              </div>
            </label>
            <label class="cp-perm-card" :class="{ checked: permDownloadLora }">
              <input type="checkbox" v-model="permDownloadLora" />
              <div>
                <strong>下载指定 LoRA 模型</strong>
                <small class="muted">仅允许下载下方由您显式指定的权重版本，其余检查点保持隔离。</small>
              </div>
            </label>
          </div>

          <div class="cp-model-picker" :class="{ dimmed: !permDownloadLora }">
            <h4>指定允许该客户下载的模型文件（已选 {{ allowedModels.length }} 个）</h4>
            <div v-if="models.length" class="cp-model-list">
              <label v-for="m in models" :key="m.path" class="cp-model-item">
                <input
                  type="checkbox"
                  :checked="allowedModels.includes(m.path)"
                  @change="toggleModelPath(m.path)"
                />
                <span class="mono">{{ m.name }}</span>
                <span class="muted">{{ m.label }} · {{ formatSize(m.size) }}</span>
              </label>
            </div>
            <p v-else class="muted">当前任务 <code>output/</code> 目录下暂无已保存的模型文件。</p>
            <div class="cp-meta-filter">
              <div class="cp-meta-title">客户下载模型时保留的元数据（取消勾选将在客户下载及预览时自动去除对应项）：</div>
              <div class="cp-meta-checks">
                <label v-for="field in MODEL_METADATA_FIELDS" :key="field" class="cp-meta-opt">
                  <input
                    type="checkbox"
                    :checked="isClientMetaKept(field)"
                    @change="setClientMetaKept(field, ($event.target as HTMLInputElement).checked)"
                  />
                  <span class="mono">{{ field }}</span>
                </label>
              </div>
            </div>
          </div>
        </section>

        <!-- 3. 客户可见预览图配置 -->
        <section class="panel">
          <div class="cp-sec-head">
            <div>
              <h3>3. 客户可见预览图（已发布 {{ selectedClient.previews.length }} 张）</h3>
              <p class="muted" style="margin:4px 0 0;">所有图片均已物理复制到独立预览目录，可放心移出或调整，不会影响训练任务本身。</p>
            </div>
          </div>

          <div v-if="selectedClient.previews.length" class="cp-preview-grid">
            <article v-for="p in selectedClient.previews" :key="p.id" class="cp-preview-card">
              <img :src="previewThumbUrl(selectedClient.id, p.id)" :alt="p.originalName" loading="lazy" />
              <div class="cp-preview-meta">
                <strong :title="p.originalName">{{ p.originalName }}</strong>
                <small class="muted">{{ p.group }} · {{ p.epoch }} · {{ p.source === 'upload' ? '手动上传' : '样例复制' }}</small>
              </div>
              <button class="button cp-remove-btn" :disabled="busy" @click="removePreview(p.id)">移出</button>
            </article>
          </div>
          <p v-else class="muted cp-empty-inline">该客户暂未配置任何可见预览图，请从下方训练样例中勾选复制或手动上传。</p>

          <!-- 手动上传 -->
          <div class="cp-subbox">
            <div class="cp-sec-head">
              <strong>手动上传预览图</strong>
              <div class="cp-actions">
                <input v-model="uploadGroup" style="width:170px;" placeholder="分组标签" aria-label="上传图片分组名称" />
                <input ref="uploadInput" type="file" accept="image/png,image/jpeg,image/webp" multiple style="display:none" @change="uploadSelectedFiles" />
                <button class="button" :disabled="busy" @click="uploadInput?.click()">选择本地图片上传…</button>
              </div>
            </div>
          </div>

          <!-- 从训练样例勾选复制 -->
          <div class="cp-subbox">
            <div class="cp-sec-head">
              <strong>从训练「样例」勾选复制到客户目录（{{ samples.length }} 张可选）</strong>
              <div class="cp-actions">
                <input v-model="sampleFilter" style="width:180px;" type="search" placeholder="筛选样例文件名…" />
                <button class="button" :disabled="!filteredSamples.length" @click="selectUnsyncedSamples">全选未同步</button>
                <button class="button cp-primary-btn" :disabled="busy || !selectedSamples.size" @click="syncSelectedSamples">
                  复制到客户预览目录 ({{ selectedSamples.size }})
                </button>
              </div>
            </div>
            <div v-if="filteredSamples.length" class="cp-sample-pick-grid">
              <button
                v-for="s in filteredSamples"
                :key="s.path"
                type="button"
                class="cp-sample-pick"
                :class="{ selected: selectedSamples.has(s.path), synced: copiedSamplePaths.has(relativeSamplePath(s)) }"
                @click="toggleSample(s)"
              >
                <img :src="s.path" :alt="s.name" loading="lazy" />
                <span class="cp-sample-name" :title="s.name">{{ s.name }}</span>
                <span v-if="copiedSamplePaths.has(relativeSamplePath(s))" class="cp-synced-tag">已同步</span>
              </button>
            </div>
            <p v-else class="muted" style="margin-top:10px;">当前任务暂无可用的训练样例图片。</p>
          </div>
        </section>
      </div>

      <section v-else class="panel cp-empty-main">
        <p class="muted">请先在左侧新建一个客户交付配置，或选择已有客户开始配置可见预览图与授权范围。</p>
      </section>
    </div>
  </section>
</template>

<style scoped>
.cp-header { display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap; }
.cp-header h2 { margin:0 0 4px; }
.cp-header p { margin:0; }
.cp-service-bar { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.cp-svc-pill { display:inline-flex; align-items:center; gap:6px; padding:5px 10px; border-radius:999px; font-size:12px; border:1px solid var(--border); background:var(--background); }
.cp-svc-pill.on { color:#34d399; border-color:#34d39955; }
.cp-svc-pill.off { color:var(--muted-foreground); }
.cp-svc-dot { width:7px; height:7px; border-radius:50%; background:currentColor; }
.cp-port-field { display:inline-flex; align-items:center; gap:6px; font-size:12px; color:var(--muted-foreground); }
.cp-port-field input { width:84px !important; min-height:32px !important; padding:4px 8px !important; font-family:Consolas,monospace; }
.cp-svc-warn { display:block; margin-top:6px; color:#fbbf24; font-size:11px; }
.cp-layout { display:grid; grid-template-columns:280px minmax(0,1fr); gap:20px; align-items:start; }
.cp-sidebar h3 { margin:0 0 12px; }
.cp-client-list { display:flex; flex-direction:column; gap:8px; margin-bottom:20px; }
.cp-client-item { text-align:left; padding:10px 12px; border:1px solid var(--border); border-radius:8px; background:var(--background); }
.cp-client-item:hover { border-color:var(--primary); }
.cp-client-item.active { background:var(--accent); border-color:var(--primary); }
.cp-client-row { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:4px; }
.cp-badge { font-size:11px; padding:1px 6px; border-radius:4px; border:1px solid var(--border); }
.cp-badge.on { color:#34d399; border-color:#34d39955; }
.cp-badge.off { color:var(--muted-foreground); }
.cp-create-form { border-top:1px solid var(--border); padding-top:16px; display:flex; flex-direction:column; gap:10px; }
.cp-main { display:flex; flex-direction:column; gap:20px; min-width:0; }
.cp-sec-head { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:12px; }
.cp-sec-head h3 { margin:0; }
.cp-actions { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
.cp-primary-btn { background:var(--primary); color:var(--primary-foreground); border-color:var(--primary); }
.cp-danger { color:#ed8e9c; }
.cp-url-box { padding:10px 12px; background:var(--background); border:1px solid var(--border); border-radius:6px; overflow-wrap:anywhere; font-size:12px; }
.cp-perm-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(210px,1fr)); gap:12px; margin-top:8px; }
.cp-perm-card { display:flex; gap:10px; align-items:flex-start; padding:12px; border:1px solid var(--border); border-radius:8px; background:var(--background); cursor:pointer; }
.cp-perm-card.checked { border-color:var(--primary); background:var(--accent); }
.cp-perm-card strong { display:block; font-size:13px; margin-bottom:3px; }
.cp-model-picker { margin-top:16px; padding-top:14px; border-top:1px solid var(--border); }
.cp-model-picker.dimmed { opacity:.65; }
.cp-model-picker h4 { margin:0 0 10px; font-size:13px; }
.cp-model-list { display:flex; flex-direction:column; gap:8px; max-height:220px; overflow:auto; }
.cp-model-item { display:flex; align-items:center; gap:10px; padding:8px 10px; border:1px solid var(--border); border-radius:6px; background:var(--background); font-size:12px; cursor:pointer; flex-wrap:wrap; }
.cp-meta-filter { margin-top:14px; padding-top:12px; border-top:1px dashed var(--border); }
.cp-meta-title { font-size:12px; color:var(--muted-foreground); margin-bottom:8px; }
.cp-meta-checks { display:flex; flex-wrap:wrap; gap:10px 16px; }
.cp-meta-opt { display:inline-flex; align-items:center; gap:6px; font-size:12px; cursor:pointer; }
.cp-meta-opt input { width:auto; margin:0; }
.mono { font-family:Consolas,monospace; }
.cp-preview-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(160px,1fr)); gap:12px; }
.cp-preview-card { border:1px solid var(--border); border-radius:8px; overflow:hidden; background:var(--background); display:flex; flex-direction:column; }
.cp-preview-card img { width:100%; height:140px; object-fit:cover; }
.cp-preview-meta { padding:8px; flex:1; min-width:0; }
.cp-preview-meta strong { display:block; font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cp-remove-btn { margin:0 8px 8px; }
.cp-empty-inline { padding:18px; border:1px dashed var(--border); border-radius:6px; text-align:center; }
.cp-subbox { margin-top:18px; padding-top:16px; border-top:1px solid var(--border); }
.cp-sample-pick-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(120px,1fr)); gap:8px; margin-top:10px; max-height:360px; overflow:auto; }
.cp-sample-pick { position:relative; border:2px solid var(--border); border-radius:6px; overflow:hidden; background:var(--background); padding:0; text-align:left; }
.cp-sample-pick.selected { border-color:var(--primary); box-shadow:0 0 0 1px var(--primary); }
.cp-sample-pick.synced { opacity:.85; }
.cp-sample-pick img { width:100%; height:100px; object-fit:cover; display:block; }
.cp-sample-name { display:block; font-size:11px; padding:4px 6px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cp-synced-tag { position:absolute; top:4px; right:4px; background:#0b1019d9; color:#34d399; font-size:10px; padding:1px 5px; border-radius:3px; border:1px solid #34d39955; }
.cp-empty-main { padding:48px 24px; text-align:center; }
@media (max-width:960px) { .cp-layout { grid-template-columns:1fr; } }
</style>
