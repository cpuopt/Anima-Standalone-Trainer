<script setup lang="ts">
import { computed } from 'vue'
import { buildTimestepDensityPath } from './timeline'

const props = defineProps<{ method: string; shift: number }>()

const shiftVal = computed(() => Math.max(0.05, Number(props.shift) || 1))
const pathD = computed(() => buildTimestepDensityPath(props.method, shiftVal.value))
const label = computed(() => {
  if (shiftVal.value > 1.05) return `偏向高噪声 · ${shiftVal.value}`
  if (shiftVal.value < 0.95) return `偏向低噪声 · ${shiftVal.value}`
  return '无偏移 · 1.0'
})
</script>

<template>
  <div class="tt-mini-figure">
    <div class="tt-mini-head">
      <strong>噪声时间步密度示意</strong>
      <span class="mono">{{ label }}</span>
    </div>
    <svg class="tt-mini-svg" viewBox="0 0 240 46" preserveAspectRatio="none" role="img" aria-label="噪声时间步采样密度">
      <line x1="0" y1="44" x2="240" y2="44" stroke="var(--border)" stroke-width="1" vector-effect="non-scaling-stroke" />
      <path :d="`${pathD} Z`" fill="var(--primary)" opacity=".12" />
      <path :d="pathD" fill="none" stroke="var(--primary)" stroke-width="1.5" vector-effect="non-scaling-stroke" />
    </svg>
    <div class="tt-mini-axis" aria-hidden="true">
      <span>低噪声 0</span><span>高噪声 1</span>
    </div>
  </div>
</template>
