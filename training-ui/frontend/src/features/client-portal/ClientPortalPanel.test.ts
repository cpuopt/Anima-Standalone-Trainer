import { beforeEach, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import ClientPortalPanel from './ClientPortalPanel.vue'

let state: any
const mocks = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock('@/stores/editor', () => ({ useEditorStore: () => state }))
vi.mock('@/services/api', () => ({
  api: mocks.api,
  jobUrl: (name: string, suffix = '') => `/api/jobs/${encodeURIComponent(name)}${suffix}`,
}))

const sampleClient = {
  id: 'cli_01',
  token: 'tok_abc123456789',
  jobName: 'demo_job',
  clientName: 'Atelier K',
  title: '星尘水彩预览',
  note: '请核对 E16',
  enabled: true,
  previews: [
    {
      id: 'prv_1',
      filename: 'prv_1_a.png',
      originalName: 'a.png',
      group: 'Prompt 1',
      epoch: 'E16',
      source: 'sample',
      sourcePath: 'output/sample/a.png',
      size: 1024,
      mtime: 1,
    },
  ],
  permissions: {
    viewParams: false,
    downloadDataset: false,
    downloadLora: false,
    allowedModels: [],
  },
  createdAt: 1,
  updatedAt: 1,
}

beforeEach(() => {
  state = reactive({ name: 'demo_job', running: false })
  mocks.api.mockReset()
})

it('loads clients, samples and models, and saves updated paid permissions', async () => {
  const updatedClient = {
    ...sampleClient,
    permissions: {
      viewParams: true,
      downloadDataset: false,
      downloadLora: true,
      allowedModels: ['output/demo-000016.safetensors'],
    },
  }

  mocks.api.mockImplementation((url: string, opts?: any) => {
    if (url.endsWith('/client-portal') && !opts?.method) {
      return Promise.resolve({ portalPort: 3100, clients: [sampleClient] })
    }
    if (url.endsWith('/samples')) {
      return Promise.resolve([{ name: 'a.png', dir: 'output/sample', mtime: 1, path: '/api/jobs/demo_job/samples/output/sample/a.png' }])
    }
    if (url.includes('/artifacts?kind=models')) {
      return Promise.resolve({ items: [{ name: 'demo-000016.safetensors', path: 'output/demo-000016.safetensors', size: 2048, mtime: 1, ready: true, label: 'Epoch 16' }] })
    }
    if (url.includes('/client-portal/cli_01') && opts?.method === 'PUT') {
      return Promise.resolve({ client: updatedClient })
    }
    return Promise.resolve({})
  })

  const wrapper = mount(ClientPortalPanel, { props: { active: true } })
  await flushPromises()

  expect(wrapper.text()).toContain('Atelier K')
  expect(wrapper.text()).toContain(':3100/p/tok_abc123456789')
  expect(wrapper.text()).toContain('demo-000016.safetensors')

  // Toggle viewParams, downloadLora, and select model
  const checkboxes = wrapper.findAll('input[type="checkbox"]')
  // [0]=enabled, [1]=viewParams, [2]=downloadDataset, [3]=downloadLora, [4]=model
  await checkboxes[1].setValue(true)
  await checkboxes[3].setValue(true)
  await checkboxes[4].setValue(true)

  const saveBtn = wrapper.findAll('button').find(b => b.text() === '保存权限与基础设置')!
  await saveBtn.trigger('click')
  await flushPromises()

  const putCall = mocks.api.mock.calls.find((c: any[]) => c[1]?.method === 'PUT')
  expect(putCall).toBeTruthy()
  expect(putCall![1].body.permissions).toEqual({
    viewParams: true,
    downloadDataset: false,
    downloadLora: true,
    allowedModels: ['output/demo-000016.safetensors'],
    stripModelMetadata: [],
  })
  wrapper.unmount()
})

it('manages model metadata retention checkboxes and persists stripModelMetadata', async () => {
  const clientWithStripped = {
    ...sampleClient,
    permissions: {
      ...sampleClient.permissions,
      downloadLora: true,
      allowedModels: ['output/demo-000016.safetensors'],
      stripModelMetadata: ['ss_datasets[*].bucket_info'],
    },
  }
  mocks.api.mockImplementation((url: string, opts?: any) => {
    if (url.endsWith('/client-portal') && !opts?.method) {
      return Promise.resolve({ portalPort: 3100, clients: [clientWithStripped] })
    }
    if (url.endsWith('/samples')) return Promise.resolve([])
    if (url.includes('/artifacts?kind=models')) {
      return Promise.resolve({ items: [{ name: 'demo-000016.safetensors', path: 'output/demo-000016.safetensors', size: 2048, mtime: 1, ready: true, label: 'Epoch 16' }] })
    }
    if (url.includes('/client-portal/cli_01') && opts?.method === 'PUT') {
      return Promise.resolve({ client: { ...clientWithStripped, permissions: opts.body.permissions } })
    }
    return Promise.resolve({})
  })

  const wrapper = mount(ClientPortalPanel, { props: { active: true } })
  await flushPromises()

  const metaChecks = wrapper.findAll('.cp-meta-checks input[type="checkbox"]')
  expect(metaChecks).toHaveLength(3)
  expect((metaChecks[0]!.element as HTMLInputElement).checked).toBe(false)
  expect((metaChecks[1]!.element as HTMLInputElement).checked).toBe(true)
  expect((metaChecks[2]!.element as HTMLInputElement).checked).toBe(true)

  // Uncheck ss_tag_frequency as well
  await metaChecks[2]!.setValue(false)
  await wrapper.findAll('button').find(b => b.text() === '保存权限与基础设置')!.trigger('click')
  await flushPromises()

  const putCall = mocks.api.mock.calls.find((c: any[]) => c[1]?.method === 'PUT')
  expect(putCall![1].body.permissions.stripModelMetadata).toEqual([
    'ss_datasets[*].bucket_info',
    'ss_tag_frequency',
  ])
  wrapper.unmount()
})

it('starts and stops the independent client portal service from the trainer UI', async () => {
  let serviceState = { running: false, port: null as number | null, requestedPort: 3100, startedAt: null as number | null, lastError: null }

  mocks.api.mockImplementation((url: string, opts?: any) => {
    if (url.endsWith('/client-portal') && !opts?.method) {
      return Promise.resolve({ portalPort: 3100, service: serviceState, clients: [sampleClient] })
    }
    if (url.endsWith('/samples')) return Promise.resolve([])
    if (url.includes('/artifacts?kind=models')) return Promise.resolve({ items: [] })
    if (url === '/api/client-portal/service/start' && opts?.method === 'POST') {
      serviceState = { running: true, port: 3105, requestedPort: 3105, startedAt: 100, lastError: null }
      return Promise.resolve(serviceState)
    }
    if (url === '/api/client-portal/service/stop' && opts?.method === 'POST') {
      serviceState = { running: false, port: null, requestedPort: 3105, startedAt: null, lastError: null }
      return Promise.resolve(serviceState)
    }
    return Promise.resolve({})
  })

  const wrapper = mount(ClientPortalPanel, { props: { active: true } })
  await flushPromises()

  expect(wrapper.text()).toContain('客户服务未启动')
  const portField = wrapper.find('input[aria-label="独立客户服务端口"]')
  await portField.setValue(3105)

  await wrapper.findAll('button').find(b => b.text() === '启动客户服务')!.trigger('click')
  await flushPromises()

  expect(mocks.api).toHaveBeenCalledWith('/api/client-portal/service/start', { method: 'POST', body: { port: 3105 } })
  expect(wrapper.text()).toContain('运行中 · 端口 3105')
  expect(wrapper.text()).toContain(':3105/p/tok_abc123456789')

  await wrapper.findAll('button').find(b => b.text() === '停止客户服务')!.trigger('click')
  await flushPromises()

  expect(mocks.api).toHaveBeenCalledWith('/api/client-portal/service/stop', { method: 'POST' })
  expect(wrapper.text()).toContain('客户服务未启动')
  wrapper.unmount()
})
