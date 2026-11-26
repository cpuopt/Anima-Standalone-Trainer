<script setup lang="ts">
import { computed, KeepAlive, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import { Button } from '@/components/ui/button'
import { useEditorStore } from '@/stores/editor'
import { JOB_TAB_IDS, jobRoute, TAB_ITEMS } from '@/router'
import TensorBoardPanel from '@/features/tensorboard/TensorBoardPanel.vue'

const store = useEditorStore()
const route = useRoute()
const router = useRouter()

const ARCH_FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'anima', label: 'anima' },
  { value: 'krea2', label: 'krea2' },
  { value: 'moss_image', label: 'moss' },
] as const
const NEW_ARCH_OPTIONS = [
  { value: 'anima', label: 'anima', title: 'Anima' },
  { value: 'krea2', label: 'krea2', title: 'Krea 2' },
  { value: 'moss_image', label: 'moss', title: 'MOSS-Image' },
] as const

const activeTab = computed(() => (route.meta.tab as string | null) ?? null)
const routeJob = computed(() => typeof route.params.job === 'string' ? route.params.job : null)
const newName = ref(''), newArch = ref('anima'), search = ref(''), busy = ref(false)
const archFilter = ref<'all' | 'anima' | 'krea2' | 'moss_image'>('all')
const createOpen = ref(false), queueExpanded = ref(false), refreshing = ref(false)
const newNameInput = ref<HTMLInputElement | null>(null)
const accessExpired = ref(false), initialized = ref(false), visitedTensorBoard = ref(false)
function expired() { accessExpired.value = true }
function archShort(arch: string) { return arch === 'moss_image' ? 'moss' : arch }
const filteredJobs = computed(() => {
  const q = search.value.trim().toLowerCase()
  return store.jobs.filter(j =>
    (archFilter.value === 'all' || j.architecture === archFilter.value) &&
    (!q || j.name.toLowerCase().includes(q)),
  )
})
const unsaved = computed(() => store.dirty || store.globalDirty)
const running = computed(() => store.running || (!!store.name && store.trainingQueue.active === store.name))

watch(() => store.trainingQueue.lastFailure, failure => {
  if (failure) queueExpanded.value = true
})

watch(() => store.name, name => {
  visitedTensorBoard.value = Boolean(name && activeTab.value === 'tensorboard')
})
watch([activeTab, () => store.name], ([tab, name]) => {
  if (tab && JOB_TAB_IDS.has(tab)) localStorage.setItem('lastTab', tab)
  if (tab === 'tensorboard' && name) visitedTensorBoard.value = true
}, { immediate: true })

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

async function loadRouteJob(jobName: string) {
  store.error = ''; store.notice = ''
  try { await store.selectJob(jobName) }
  catch (e: any) { if (e.name !== 'AbortError') store.error = e.message }
}

async function syncRouteToStore(isInitial = false) {
  if (route.name === 'home') {
    const lastJob = localStorage.getItem('lastJob')
    if (isInitial && lastJob && store.jobs.some(j => j.name === lastJob)) {
      await router.replace(jobRoute(lastJob, localStorage.getItem('lastTab')))
      return
    }
    if (store.name) store.clearJob()
    return
  }
  if (route.name === 'settings') return
  const target = routeJob.value
  if (!target) return
  if (store.jobs.length && !store.jobs.some(j => j.name === target)) {
    await router.replace({ name: 'home' })
    return
  }
  if (store.name !== target) {
    await loadRouteJob(target)
    if (routeJob.value === target && store.name !== target && !store.loading) {
      await router.replace({ name: 'home' })
    }
  }
}

const removeGuard = router.beforeEach((to) => {
  const targetJob = typeof to.params.job === 'string' ? to.params.job : null
  if (store.name && store.dirty && (to.name === 'home' || (targetJob !== null && targetJob !== store.name))) {
    if (store.saving) return false
    if (!window.confirm('当前任务有未保存修改，放弃这些修改继续？')) return false
  }
})

watch(() => [route.name, routeJob.value], () => {
  if (initialized.value) void syncRouteToStore(false)
})

async function choose(name: string) {
  const targetTab = activeTab.value && JOB_TAB_IDS.has(activeTab.value) ? activeTab.value : localStorage.getItem('lastTab')
  await router.push(jobRoute(name, targetTab))
}
async function selectTab(id: string) {
  if (id === 'settings') await router.push({ name: 'settings' })
  else if (store.name) await router.push(jobRoute(store.name, id))
}
async function refreshJobs() {
  refreshing.value = true
  try { await run(store.loadJobs) }
  finally { window.setTimeout(() => { refreshing.value = false }, 420) }
}
async function toggleCreate(open?: boolean) {
  createOpen.value = open !== undefined ? open : !createOpen.value
  if (createOpen.value) {
    await nextTick()
    newNameInput.value?.focus()
  }
}
async function create() {
  if (!newName.value.trim() || !allowDiscard()) return
  await run(async () => {
    await store.createJob(newName.value.trim(), newArch.value)
    newName.value = ''
    createOpen.value = false
    archFilter.value = 'all'
    if (store.name) await router.push(jobRoute(store.name, 'training'))
  })
}
async function clone() {
  if (!store.name || !allowDiscard()) return
  const value = window.prompt('新任务名称（复制已保存的配置）', `${store.name}_copy`)
  if (value?.trim()) {
    const targetTab = activeTab.value && JOB_TAB_IDS.has(activeTab.value) ? activeTab.value : 'training'
    await run(async () => {
      await store.cloneJob(value.trim())
      if (store.name) await router.push(jobRoute(store.name, targetTab))
    })
  }
}
async function remove() {
  if (store.name && window.confirm(`删除任务 ${store.name} 及全部文件？此操作无法撤销。`)) {
    await run(async () => {
      await store.deleteJob()
      await router.push({ name: 'home' })
    })
  }
}
async function train() {
  await run(async () => {
    const name = store.name
    const result = await store.startTraining()
    if (result && !result.queued && name && store.name === name) await router.push(jobRoute(name, 'console'))
  })
}
function stop() { if (window.confirm('停止当前任务？')) void run(store.stopTraining) }
function unload(event: BeforeUnloadEvent) { if (unsaved.value) { event.preventDefault(); event.returnValue = '' } }
function keyboard(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    void run(() => activeTab.value === 'settings' ? store.saveGlobal() : store.save())
  }
}
onMounted(async () => {
  window.addEventListener('ui-access-expired', expired)
  window.addEventListener('beforeunload', unload); window.addEventListener('keydown', keyboard)
  await run(() => store.initialize({ autoSelect: false }))
  await router.isReady()
  initialized.value = true
  await syncRouteToStore(true)
})
onBeforeUnmount(() => {
  removeGuard()
  store.dispose()
  window.removeEventListener('ui-access-expired', expired)
  window.removeEventListener('beforeunload', unload)
  window.removeEventListener('keydown', keyboard)
})
</script>
<template>
  <div class="app-background" :style="background" />
  <div class="studio-shell" :style="{ textShadow: ui.text_shadow_size ? `0 1px ${ui.text_shadow_size}px #000` : undefined }">
    <aside class="sidebar" aria-label="任务导航栏">
      <div class="sb-head">
        <a class="brand" href="/ui/" title="返回工作台首页">
          <span class="sb-brand-glyph">A</span>
          <span>Training Studio</span>
        </a>
        <div class="sb-head-actions">
          <button type="button" class="sb-icon-btn" :class="{ spinning: refreshing }" title="刷新任务列表" aria-label="刷新任务" :disabled="busy" @click="refreshJobs">↻</button>
          <button type="button" class="sb-icon-btn is-primary" :aria-expanded="createOpen" aria-controls="sb-create-drawer" @click="toggleCreate()">+ 新建</button>
        </div>
      </div>

      <form v-if="createOpen" id="sb-create-drawer" class="new-job" @submit.prevent="create">
        <div class="sb-create-row">
          <label for="job-name">新建训练任务</label>
          <button type="button" class="sb-create-close" aria-label="关闭新建面板" @click="toggleCreate(false)">×</button>
        </div>
        <input ref="newNameInput" id="job-name" v-model="newName" class="sb-create-input" placeholder="输入任务名称…" aria-label="新建任务名称" :disabled="busy" />
        <div class="sb-arch-seg" role="group" aria-label="模型架构">
          <button v-for="opt in NEW_ARCH_OPTIONS" :key="opt.value" type="button" :title="opt.title" :aria-pressed="newArch === opt.value" :disabled="busy" @click="newArch = opt.value">{{ opt.label }}</button>
        </div>
        <button type="submit" class="sb-create-submit" :disabled="busy || !newName.trim()">创建任务</button>
      </form>

      <div class="sb-search-row">
        <svg class="sb-search-ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="7" cy="7" r="4.8"/><path d="M10.7 10.7L14 14" stroke-linecap="round"/></svg>
        <input v-model="search" class="sb-search-input" aria-label="搜索任务" placeholder="搜索任务…" />
        <button v-if="search" type="button" class="sb-clear-btn" aria-label="清空搜索" @click="search = ''">×</button>
        <span class="sb-search-count">{{ filteredJobs.length }}</span>
      </div>

      <div class="sb-filters" role="group" aria-label="按模型类型筛选">
        <button v-for="f in ARCH_FILTERS" :key="f.value" type="button" class="sb-filter-btn" :aria-pressed="archFilter === f.value" @click="archFilter = f.value">{{ f.label }}</button>
      </div>

      <nav class="job-list" aria-label="任务列表">
        <button
          v-for="job in filteredJobs"
          :key="job.name"
          class="job-item"
          :class="{ selected: store.name === job.name && activeTab !== 'settings' }"
          :title="`${job.name} (${archShort(job.architecture)})`"
          :disabled="store.saving"
          @click="choose(job.name)"
        >
          <span
            class="job-dot"
            :class="{
              running: store.trainingQueue.active === job.name || (store.name === job.name ? store.running : job.running),
              queued: store.trainingQueue.pending.includes(job.name),
            }"
          />
          <span class="job-name">{{ job.name }}</span>
          <span class="job-arch" :data-arch="job.architecture">{{ archShort(job.architecture) }}</span>
        </button>
        <p v-if="!filteredJobs.length" class="sb-empty">暂无任务</p>
      </nav>

      <section class="training-queue" aria-labelledby="training-queue-heading">
        <button type="button" class="sb-queue-toggle" :aria-expanded="queueExpanded" aria-controls="sb-queue-body" @click="queueExpanded = !queueExpanded">
          <span id="training-queue-heading" class="sr-only">训练队列</span>
          <span class="sb-queue-summary">
            <template v-if="store.trainingQueue.lastFailure">
              <span class="job-dot error" />
              <span class="sb-queue-err-text">上次训练失败 · 排队 {{ store.trainingQueue.pending.length }}</span>
            </template>
            <template v-else-if="store.trainingQueue.active">
              <span class="job-dot running" />
              <span class="sb-queue-active-name">{{ store.trainingQueue.active }} · 等待 {{ store.trainingQueue.pending.length }}</span>
            </template>
            <template v-else>
              <span class="job-dot" />
              <span class="muted">队列空闲 · 0 运行</span>
            </template>
          </span>
          <span class="sb-queue-meta">{{ queueExpanded ? '▴' : '▾' }}</span>
        </button>
        <div v-show="queueExpanded" id="sb-queue-body" class="sb-queue-body">
          <button v-if="store.trainingQueue.active" type="button" class="sb-qitem" :disabled="store.saving" @click="choose(store.trainingQueue.active)">
            <span class="job-dot running" />
            <span class="job-name">{{ store.trainingQueue.active }}</span>
            <span class="sb-queue-meta">训练中</span>
          </button>
          <ol v-if="store.trainingQueue.pending.length" class="queue-list">
            <li v-for="job in store.trainingQueue.pending" :key="job">
              <button type="button" class="sb-qitem-btn" :disabled="store.saving" @click="choose(job)">{{ job }}</button>
            </li>
          </ol>
          <p v-if="!store.trainingQueue.active && !store.trainingQueue.pending.length" class="sb-qempty muted">没有等待中的任务</p>
          <p v-if="store.trainingQueue.lastFailure" class="error queue-failure" role="status">
            {{ store.trainingQueue.lastFailure.name }} 训练失败 · {{ store.trainingQueue.lastFailure.message }}
          </p>
        </div>
      </section>

      <footer class="sb-foot">
        <button type="button" class="sb-settings-btn" :class="{ active: activeTab === 'settings' }" @click="selectTab('settings')">
          全局设置<span v-if="store.globalDirty" aria-label="有未保存设置"> ·</span>
        </button>
        <span class="sb-conn" :class="store.connected ? 'connection-on' : 'muted'">
          <span class="job-dot" :class="{ running: store.connected }" />
          {{ store.connected ? '实时连接正常' : '连接恢复中…' }}
        </span>
      </footer>
    </aside>
    <main :class="{ 'tensorboard-main': activeTab === 'tensorboard' }">
      <header class="toolbar">
        <div class="title"><span class="eyebrow">TRAINING WORKSPACE</span><h1>{{ activeTab === 'settings' ? '全局设置' : store.name || '工作台' }}<span v-if="store.dirty" class="dirty-dot" title="有未保存修改">●</span></h1><span v-if="store.name" class="muted">{{ store.architecture }} · {{ running ? store.phase || '运行中' : store.queued ? '排队中' : '就绪' }}</span></div>
        <div v-if="store.name" class="toolbar-actions">
          <Button variant="outline" :disabled="busy || store.saving" @click="clone">复制</Button>
          <Button variant="outline" :disabled="busy || running || store.queued" @click="remove">删除</Button>
          <Button v-if="store.dirty" variant="ghost" :disabled="busy || store.saving" @click="store.discard()">放弃修改</Button>
          <Button :disabled="busy || store.loading || store.saving || !store.dirty" @click="run(store.save)">{{ store.saving ? '保存中…' : '保存' }}</Button>
          <Button v-if="!running" class="train-button" :disabled="busy || store.loading || store.queued" @click="train">{{ store.queued ? '已加入训练队列' : store.trainingQueue.active ? '加入训练队列' : '开始训练' }}</Button>
          <Button v-else variant="destructive" :disabled="busy" @click="stop">停止</Button>
        </div>
      </header>
      <div v-if="store.error" class="banner error" role="alert">{{ store.error }}<button aria-label="关闭错误" @click="store.error = ''">×</button></div>
      <div v-if="accessExpired" class="banner error" role="alert">登录已失效或服务已重启，未保存的编辑仍保留。<a href="/login" target="_blank" rel="noopener">在新标签页重新登录</a><button @click="accessExpired = false">关闭提示</button></div>
      <div v-if="store.notice" class="banner notice" role="status">{{ store.notice }}</div>
      <nav class="tabs" aria-label="配置页面"><button v-for="item in TAB_ITEMS" :key="item.id" :class="{ active: activeTab === item.id }" :disabled="item.requiresJob && !store.name" @click="selectTab(item.id)">{{ item.label }}</button></nav>
      <div class="workspace" :class="{'samples-workspace':activeTab === 'samples','console-workspace':activeTab === 'console','tensorboard-workspace':activeTab === 'tensorboard'}">
        <p v-if="store.loading || (routeJob && !store.name)" role="status" class="muted">正在读取任务…</p>
        <section v-else-if="route.name === 'home'" class="welcome"><div class="welcome-mark">A</div><h2>开始一次新的训练</h2><p>选择已有任务，或在左侧创建 Anima / Krea 2 / MOSS 任务。</p><button class="button" @click="selectTab('settings')">配置模型与运行环境</button></section>
        <template v-else>
          <RouterView v-slot="{ Component, route: currentRoute }">
            <KeepAlive :key="store.name ?? 'global'">
              <component :is="Component" v-if="Component" :key="currentRoute.name" />
            </KeepAlive>
          </RouterView>
          <div v-if="store.name && visitedTensorBoard" v-show="activeTab === 'tensorboard'" data-panel="tensorboard">
            <TensorBoardPanel :key="store.name" />
          </div>
        </template>
      </div>
    </main>
  </div>
</template>
