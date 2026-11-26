import { defineComponent, type Component } from 'vue'
import { createRouter, createWebHistory, type RouteLocationRaw, type RouteRecordRaw, type Router, type RouterHistory } from 'vue-router'
import TrainingPanel from '@/features/training/TrainingPanel.vue'
import DatasetPanel from '@/features/dataset/DatasetPanel.vue'
import NetworkPanel from '@/features/network/NetworkPanel.vue'
import MultiGpuPanel from '@/features/multi-gpu/MultiGpuPanel.vue'
import PromptsPanel from '@/features/prompts/PromptsPanel.vue'
import SamplesPanel from '@/features/samples/SamplesPanel.vue'
import ConsolePanel from '@/features/console/ConsolePanel.vue'
import ArtifactsPanel from '@/features/artifacts/ArtifactsPanel.vue'
import ClientPortalPanel from '@/features/client-portal/ClientPortalPanel.vue'
import SettingsPanel from '@/features/settings/SettingsPanel.vue'

export interface TabItem {
  id: string
  label: string
  routeName: string
  requiresJob: boolean
}

export const TAB_ITEMS: TabItem[] = [
  { id: 'training', label: '训练', routeName: 'job-training', requiresJob: true },
  { id: 'dataset', label: '数据集', routeName: 'job-dataset', requiresJob: true },
  { id: 'network', label: '网络', routeName: 'job-network', requiresJob: true },
  { id: 'multi-gpu', label: '多 GPU', routeName: 'job-multi-gpu', requiresJob: true },
  { id: 'prompts', label: '提示词与生成', routeName: 'job-prompts', requiresJob: true },
  { id: 'samples', label: '样例', routeName: 'job-samples', requiresJob: true },
  { id: 'console', label: '控制台', routeName: 'job-console', requiresJob: true },
  { id: 'tensorboard', label: 'TensorBoard', routeName: 'job-tensorboard', requiresJob: true },
  { id: 'artifacts', label: '训练产出', routeName: 'job-artifacts', requiresJob: true },
  { id: 'client-portal', label: '客户交付', routeName: 'job-client-portal', requiresJob: true },
  { id: 'settings', label: '设置', routeName: 'settings', requiresJob: false },
]

export const JOB_TAB_IDS = new Set(TAB_ITEMS.filter(item => item.requiresJob).map(item => item.id))

// TensorBoardPanel stays mounted outside RouterView so its iframe never reloads on tab switches.
export const EmptyRouteView = defineComponent({ name: 'TensorBoardRouteSlot', render: () => null })

const JOB_PANEL_COMPONENTS: Record<string, Component> = {
  training: TrainingPanel,
  dataset: DatasetPanel,
  network: NetworkPanel,
  'multi-gpu': MultiGpuPanel,
  prompts: PromptsPanel,
  samples: SamplesPanel,
  console: ConsolePanel,
  tensorboard: EmptyRouteView,
  artifacts: ArtifactsPanel,
  'client-portal': ClientPortalPanel,
}

export function jobRoute(job: string, tabId?: string | null): RouteLocationRaw {
  const safeTab = tabId && JOB_TAB_IDS.has(tabId) ? tabId : 'training'
  return { name: `job-${safeTab}`, params: { job } }
}

export function createAppRouter(history: RouterHistory = createWebHistory(import.meta.env.BASE_URL)): Router {
  const jobTabRoutes: RouteRecordRaw[] = TAB_ITEMS
    .filter(item => item.requiresJob)
    .map(item => ({
      path: `/jobs/:job/${item.id}`,
      name: item.routeName,
      component: JOB_PANEL_COMPONENTS[item.id]!,
      meta: { tab: item.id, requiresJob: true },
    }))

  return createRouter({
    history,
    routes: [
      { path: '/', name: 'home', component: EmptyRouteView, meta: { tab: null } },
      { path: '/settings', name: 'settings', component: SettingsPanel, meta: { tab: 'settings', requiresJob: false } },
      { path: '/jobs/:job', redirect: to => ({ name: 'job-training', params: { job: to.params.job } }) },
      ...jobTabRoutes,
      { path: '/:pathMatch(.*)*', redirect: { name: 'home' } },
    ],
  })
}
