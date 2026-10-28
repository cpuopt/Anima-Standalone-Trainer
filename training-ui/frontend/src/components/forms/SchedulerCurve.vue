<script setup lang="ts">
import { computed, useId } from 'vue'
import { curvePaths, curvePlot, schedulerPreview } from './scheduler-curves'
const props = defineProps<{ name: string }>()
const id = useId()
const preview = computed(() => schedulerPreview(props.name))
const paths = computed(() => curvePaths(props.name))
const floorY = computed(() => curvePlot.top + curvePlot.height * (1 - (preview.value?.floor ?? 0)))
</script>
<template>
  <section class="scheduler-curve" :data-scheduler-preview="name" aria-label="学习率曲线预览">
    <div class="scheduler-preview-eyebrow">LR SCHEDULE · 曲线示意</div>
    <div class="scheduler-preview-title">{{preview?.title || '自定义调度器'}}</div>
    <code>{{name || '未设置'}}</code>
    <figure v-if="preview" class="scheduler-figure">
      <svg viewBox="0 0 310 169" role="img" :aria-labelledby="`${id}-title ${id}-description`" class="scheduler-graph">
        <title :id="`${id}-title`">{{preview.title}}学习率曲线示意</title>
        <desc :id="`${id}-description`">{{preview.description}}横轴为训练进度，纵轴为相对学习率。{{preview.example}}</desc>
        <defs><linearGradient :id="`${id}-fill`" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="currentColor" stop-opacity="0.18"/><stop offset="100%" stop-color="currentColor" stop-opacity="0.01"/></linearGradient></defs>
        <g class="scheduler-grid"><path v-for="y in [17,76.5,136]" :key="y" :d="`M35 ${y} H285`"/><path v-for="x in [35,160,285]" :key="x" :d="`M${x} 17 V136`"/></g>
        <g class="scheduler-axis"><path d="M35 12 V136 H291"/></g>
        <path v-if="paths.length === 1" :d="`${paths[0]} L285,136 L35,136 Z`" :fill="`url(#${id}-fill)`" class="scheduler-area"/>
        <path v-if="preview.floor !== undefined" :d="`M35 ${floorY} H285`" class="scheduler-floor"/>
        <path v-for="(path,index) in paths" :key="index" :d="path" class="scheduler-line"/>
        <g class="scheduler-axis-text"><text x="28" y="21" text-anchor="end">1</text><text x="28" y="140" text-anchor="end">0</text><text x="35" y="151">0%</text><text x="285" y="151" text-anchor="end">100%</text><text x="160" y="164" text-anchor="middle">训练进度</text><text x="35" y="10">相对学习率</text></g>
      </svg>
      <figcaption>{{preview.example}}</figcaption>
    </figure>
    <p class="scheduler-preview-description" aria-live="polite">{{preview?.description || '未提供此自定义调度器的示意图；现有配置会原样保留。'}}</p>
    <p class="scheduler-preview-disclaimer">仅展示曲线形状，不是当前任务的实际学习率。Warmup、总步数、周期数、最低学习率和后端实现会影响实际曲线。</p>
  </section>
</template>
