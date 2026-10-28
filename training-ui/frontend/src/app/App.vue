<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useEditorStore } from '@/stores/editor'
import TrainingPanel from '@/features/training/TrainingPanel.vue'
import DatasetPanel from '@/features/dataset/DatasetPanel.vue'
import NetworkPanel from '@/features/network/NetworkPanel.vue'
import MultiGpuPanel from '@/features/multi-gpu/MultiGpuPanel.vue'
import PromptsPanel from '@/features/prompts/PromptsPanel.vue'
import SamplesPanel from '@/features/samples/SamplesPanel.vue'
import ArtifactsPanel from '@/features/artifacts/ArtifactsPanel.vue'
import ConsolePanel from '@/features/console/ConsolePanel.vue'
import TensorBoardPanel from '@/features/tensorboard/TensorBoardPanel.vue'
import SettingsPanel from '@/features/settings/SettingsPanel.vue'
import PersistentPanels from './PersistentPanels.vue'

const store = useEditorStore()
const tabs = [
  { id:'training', label:'训练', component:TrainingPanel }, { id:'dataset', label:'数据集', component:DatasetPanel },
  { id:'network', label:'网络', component:NetworkPanel }, { id:'multi-gpu', label:'多 GPU', component:MultiGpuPanel },
  { id:'prompts', label:'提示词与生成', component:PromptsPanel }, { id:'samples', label:'样例', component:SamplesPanel },
  { id:'console', label:'控制台', component:ConsolePanel }, { id:'tensorboard', label:'TensorBoard', component:TensorBoardPanel },
  { id:'artifacts', label:'训练产出', component:ArtifactsPanel },
  { id:'settings', label:'设置', component:SettingsPanel },
]
const cached = localStorage.getItem('lastTab') || 'training'
const tab = ref(tabs.some(t => t.id === cached) ? cached : 'training')
const newName = ref(''), newArch = ref('anima'), search = ref(''), busy = ref(false)
const accessExpired = ref(false)
function expired() { accessExpired.value = true }
const filteredJobs = computed(() => store.jobs.filter(j => j.name.toLowerCase().includes(search.value.toLowerCase())))
const unsaved = computed(() => store.dirty || store.globalDirty)
watch(tab, v => localStorage.setItem('lastTab', v))
const ui = computed(() => store.globalConfig.ui || {})
const background = computed(() => ({
  backgroundImage: ui.value.background ? `url(${JSON.stringify(ui.value.background)})` : undefined,
  backgroundPosition: ui.value.background_position || '50% 50%',
  filter: `brightness(${Number(ui.value.brightness_level ?? 100)}%) blur(${Number(ui.value.blur_level ?? 10)}px)`,
  opacity: 1 - Number(ui.value.dim_level ?? 70) / 100,
}))
watch(() => ui.value.theme, theme => {
  const actual = theme || localStorage.getItem('ui_theme') || 'github-dark'
  document.documentElement.classList.toggle('dark', actual !== 'github-light')
  document.documentElement.dataset.theme = actual
}, { immediate: true })
async function run(action: () => Promise<any>) {
  if (busy.value) return
  busy.value = true; store.error = ''; store.notice = ''
  try { await action() } catch (e: any) { if (e.name !== 'AbortError') store.error = e.message }
  finally { busy.value = false }
}
function allowDiscard() { return !store.dirty || window.confirm('当前任务有未保存修改，放弃这些修改继续？') }
async function choose(name: string) { if (allowDiscard()) await run(() => store.selectJob(name)) }
async function create() {
  if (!newName.value.trim() || !allowDiscard()) return
  await run(async () => { await store.createJob(newName.value.trim(), newArch.value); newName.value = '' })
}
async function clone() {
  if (!store.name || !allowDiscard()) return
  const value = window.prompt('新任务名称（复制已保存的配置）', `${store.name}_copy`)
  if (value?.trim()) await run(() => store.cloneJob(value.trim()))
}
async function remove() {
  if (store.name && window.confirm(`删除任务 ${store.name} 及全部文件？此操作无法撤销。`)) await run(() => store.deleteJob())
}
async function train() { await run(async () => { await store.startTraining(); tab.value = 'console' }) }
function stop() { if (window.confirm('停止当前任务？')) void run(store.stopTraining) }
function unload(event: BeforeUnloadEvent) { if (unsaved.value) { event.preventDefault(); event.returnValue = '' } }
function keyboard(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    void run(() => tab.value === 'settings' ? store.saveGlobal() : store.save())
  }
}
onMounted(() => {
  window.addEventListener('ui-access-expired', expired)
  window.addEventListener('beforeunload', unload); window.addEventListener('keydown', keyboard)
  void run(() => store.initialize())
})
onBeforeUnmount(() => { store.dispose(); window.removeEventListener('ui-access-expired', expired); window.removeEventListener('beforeunload', unload); window.removeEventListener('keydown', keyboard) })
</script>
<template>
  <div class="app-background" :style="background" />
  <div class="studio-shell" :style="{ textShadow: ui.text_shadow_size ? `0 1px ${ui.text_shadow_size}px #000` : undefined }">
    <aside class="sidebar">
      <a class="brand" href="/ui/"><span class="brand-mark">A</span><span>Training Studio<small>Anima · Krea 2 · MOSS</small></span></a>
      <div class="sidebar-heading"><h2>任务</h2><button class="subtle" title="刷新任务" :disabled="busy" @click="run(store.loadJobs)">↻</button></div>
      <Input v-model="search" aria-label="搜索任务" placeholder="搜索任务…" />
      <nav class="job-list" aria-label="任务列表">
        <button v-for="job in filteredJobs" :key="job.name" class="job-item" :class="{ selected: store.name === job.name }" :disabled="store.saving" @click="choose(job.name)"><span class="job-dot" :class="{ running: job.running }"/><span class="job-name">{{ job.name }}<small>{{ job.architecture }}</small></span></button>
        <p v-if="!filteredJobs.length" class="muted">暂无任务</p>
      </nav>
      <form class="new-job" @submit.prevent="create">
        <label for="job-name">新建任务</label><Input id="job-name" v-model="newName" placeholder="任务名称" :disabled="busy" />
        <select v-model="newArch" aria-label="模型架构"><option value="anima">Anima</option><option value="krea2">Krea 2</option><option value="moss_image">MOSS-Image</option></select>
        <Button type="submit" :disabled="busy || !newName.trim()">创建任务</Button>
      </form>
      <footer><button class="subtle" @click="tab = 'settings'">全局设置<span v-if="store.globalDirty"> ·</span></button><a href="/legacy/" target="_blank" rel="noopener">打开旧界面 ↗</a><span :class="store.connected ? 'connection-on' : 'muted'">{{ store.connected ? '实时连接正常' : '实时连接恢复中…' }}</span></footer>
    </aside>
    <main>
      <header class="toolbar">
        <div class="title"><span class="eyebrow">TRAINING WORKSPACE</span><h1>{{ tab === 'settings' ? '全局设置' : store.name || '工作台' }}<span v-if="store.dirty" class="dirty-dot" title="有未保存修改">●</span></h1><span v-if="store.name" class="muted">{{ store.architecture }} · {{ store.running ? store.phase || '运行中' : '就绪' }}</span></div>
        <div v-if="store.name" class="toolbar-actions">
          <Button variant="outline" :disabled="busy || store.saving" @click="clone">复制</Button>
          <Button variant="outline" :disabled="busy || store.running" @click="remove">删除</Button>
          <Button v-if="store.dirty" variant="ghost" :disabled="busy || store.saving" @click="store.discard()">放弃修改</Button>
          <Button :disabled="busy || store.loading || store.saving || !store.dirty" @click="run(store.save)">{{ store.saving ? '保存中…' : '保存' }}</Button>
          <Button v-if="!store.running" class="train-button" :disabled="busy || store.loading" @click="train">开始训练</Button>
          <Button v-else variant="destructive" :disabled="busy" @click="stop">停止</Button>
        </div>
      </header>
      <div v-if="store.error" class="banner error" role="alert">{{ store.error }}<button aria-label="关闭错误" @click="store.error = ''">×</button></div>
      <div v-if="accessExpired" class="banner error" role="alert">远程会话已过期，未保存的编辑仍保留。<a href="/login" target="_blank" rel="noopener">在新标签页重新登录</a><button @click="accessExpired = false">关闭提示</button></div>
      <div v-if="store.notice" class="banner notice" role="status">{{ store.notice }}</div>
      <nav class="tabs" aria-label="配置页面"><button v-for="item in tabs" :key="item.id" :class="{ active: tab === item.id }" :disabled="!store.name && item.id !== 'settings'" @click="tab = item.id">{{ item.label }}</button></nav>
      <div class="workspace">
        <p v-if="store.loading" role="status" class="muted">正在读取任务…</p>
        <PersistentPanels v-else-if="store.name || tab === 'settings'" :key="store.name ?? 'global'" :tabs="tabs" :active="tab" />
        <section v-else class="welcome"><div class="welcome-mark">A</div><h2>开始一次新的训练</h2><p>选择已有任务，或在左侧创建 Anima / Krea 2 / MOSS 任务。</p><button class="button" @click="tab='settings'">配置模型与运行环境</button></section>
      </div>
    </main>
  </div>
</template>
