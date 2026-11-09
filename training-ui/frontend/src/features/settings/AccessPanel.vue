<script setup lang="ts">
import { api } from '@/services/api'
import { ref } from 'vue'
const error = ref('')
async function logout() {
  try { await api('/api/access/logout', { method: 'POST' }); window.location.assign('/login') }
  catch (e: any) { error.value = e.message }
}
</script>
<template>
  <section class="rounded-lg border p-4 space-y-3" aria-label="局域网访问">
    <h3 class="font-semibold">局域网访问</h3>
    <p class="text-sm text-muted-foreground">首次访问需设置密码，本地和远程统一登录。密码仅在本次服务进程内有效，登录不会自动过期；服务重启后重新设置。已登录用户均可管理环境、运行性能测试，并直接浏览服务进程可读取的图片与 TXT；无需目录授权，预览路径不限制在绑定目录内。</p>
    <p v-if="error" role="alert" class="text-destructive">{{ error }}</p>
    <button class="btn" @click="logout">退出登录</button>
  </section>
</template>
