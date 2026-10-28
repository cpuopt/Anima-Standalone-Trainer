<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '@/services/api'
const local = ref(false), ready = ref(false), code = ref(''), roots = ref<string[]>([]), directory = ref(''), error = ref(''), notice = ref(''), busy = ref(false)
async function run(action: () => Promise<void>) {
  if (busy.value) return
  busy.value = true; error.value = ''; notice.value = ''
  try { await action() } catch (e: any) { error.value = e.message } finally { busy.value = false }
}
async function reveal() { await run(async () => { code.value = (await api('/api/access/code')).code }) }
async function reset() {
  if (!window.confirm('重置共享访问码？所有远程会话和实时连接将失效，正在运行的训练不受影响。')) return
  await run(async () => { await api('/api/access/reset', { method: 'POST' }); code.value = ''; notice.value = '访问码已重置，旧会话已失效。' })
}
async function authorize(path: string, remove = false) {
  if (remove && !window.confirm(`撤销此目录及其子目录的远程预览授权？\n${path}`)) return
  await run(async () => {
    roots.value = (await api('/api/datasets/authorized-roots', { method: 'POST', body: { path, remove } })).roots
    directory.value = ''; notice.value = remove ? '已撤销目录授权' : '已授权此目录及其子目录，远程已认证用户可以只读预览。'
  })
}
async function logout() { await api('/api/access/logout', { method: 'POST' }); window.location.assign('/login') }
onMounted(async () => {
  try {
    const status = await api('/api/access/status'); local.value = status.local
    if (local.value) roots.value = (await api('/api/datasets/authorized-roots')).roots
  } catch (e: any) { error.value = e.message } finally { ready.value = true }
})
</script>
<template>
  <section class="rounded-lg border p-4 space-y-3" aria-label="局域网访问">
    <h3 class="font-semibold">局域网访问</h3>
    <p class="text-sm text-muted-foreground">远程访问需共享访问码，有效期 12 小时。持有码者拥有训练控制权限；仅用于可信局域网，非可信网络必须使用 HTTPS。环境安装等操作仍仅限 localhost。</p>
    <p v-if="error" role="alert" class="text-destructive">{{ error }}</p><p v-if="notice" role="status">{{ notice }}</p>
    <template v-if="ready && local">
      <div class="flex gap-2 flex-wrap"><button class="btn" :disabled="busy" @click="reveal">显示访问码</button><button v-if="code" class="btn" @click="code = ''">隐藏访问码</button><button class="btn text-destructive" :disabled="busy" @click="reset">重置访问码</button></div>
      <input v-if="code" :value="code" readonly aria-label="共享访问码" class="w-full rounded border p-2 bg-transparent font-mono" @focus="($event.target as HTMLInputElement).select()" />
      <h4 class="font-semibold">允许远程预览的服务器目录</h4>
      <p class="text-sm text-muted-foreground">上传后的管理目录自动可用。其他目录必须在此由本机授权；不要授权磁盘根目录、密钥或私密资料目录。</p>
      <div class="flex gap-2"><input v-model="directory" aria-label="授权根目录" placeholder="服务器绝对目录路径" class="min-w-0 flex-1 rounded border p-2 bg-transparent" /><button class="btn" :disabled="busy || !directory.trim()" @click="authorize(directory)">授权目录</button></div>
      <ul class="space-y-2"><li v-for="root in roots" :key="root" class="flex items-center gap-2"><code class="min-w-0 flex-1 break-all">{{ root }}</code><button class="btn" :disabled="busy" @click="authorize(root, true)">撤销</button></li></ul>
    </template>
    <template v-else-if="ready"><p class="text-sm text-muted-foreground">访问码和目录授权需在训练机器的 localhost 界面管理。</p><button class="btn" @click="logout">退出远程登录</button></template>
  </section>
</template>
