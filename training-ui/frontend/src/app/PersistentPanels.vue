<script setup lang="ts">
import { ref, toRaw, watch, type Component } from 'vue'

const props = defineProps<{ tabs: Array<{ id: string; component: Component }>; active: string }>()
const visited = ref(new Set<string>())
watch(() => props.active, id => { visited.value.add(id) }, { immediate: true, flush: 'sync' })
</script>

<template>
  <!-- Keep iframe DOM attached: KeepAlive alone detaches it and can reload TensorBoard. -->
  <template v-for="item in tabs" :key="item.id">
    <div v-if="visited.has(item.id)" v-show="active === item.id" :data-panel="item.id">
      <component :is="toRaw(item.component)" />
    </div>
  </template>
</template>
