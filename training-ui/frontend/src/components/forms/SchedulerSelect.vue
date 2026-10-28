<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Select, SelectContent, SelectIcon, SelectItem, SelectItemIndicator, SelectItemText, SelectTrigger, SelectValue, SelectViewport } from '@/components/ui/select'
import SchedulerCurve from './SchedulerCurve.vue'
const props = defineProps<{ id: string; modelValue: string; label: string; options?: Array<string | { value: any; label: string }>; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const open = ref(false), highlighted = ref(props.modelValue)
const choices = computed(() => {
  const items = (props.options || []).map(option => typeof option === 'string' ? {value:option,label:option} : {value:String(option.value),label:option.label}).filter(option => option.value !== '')
  // Viewing an older/custom value must not silently replace it with the first option.
  return props.modelValue && !items.some(item => item.value === props.modelValue)
    ? [{ value:props.modelValue, label:props.modelValue }, ...items] : items
})
watch(open, value => { if (value) highlighted.value = props.modelValue || choices.value[0]?.value || '' })
watch(() => props.disabled, value => { if (value) open.value = false })
function select(value: unknown) { if (!props.disabled && typeof value === 'string') emit('update:modelValue', value) }
</script>
<template>
  <Select :model-value="modelValue || undefined" v-model:open="open" :disabled="disabled" @update:model-value="select">
    <SelectTrigger :id="id" :aria-label="label" class="scheduler-select-trigger">
      <SelectValue placeholder="未设置"/><SelectIcon aria-hidden="true">⌄</SelectIcon>
    </SelectTrigger>
    <SelectContent align="start" :aria-label="`${label} 选项`">
      <div class="scheduler-menu-layout">
        <div class="scheduler-options-column">
          <div class="scheduler-menu-hint">悬停 / ↑↓ 预览 · 选择后应用</div>
          <SelectViewport class="scheduler-options">
            <SelectItem v-for="option in choices" :key="option.value" :value="option.value" :text-value="option.label"
              class="scheduler-option" :data-scheduler-option="option.value"
              @pointerenter="highlighted = option.value" @pointermove="highlighted = option.value" @focus="highlighted = option.value">
              <SelectItemText>{{option.label}}</SelectItemText><SelectItemIndicator class="scheduler-selected" aria-hidden="true">✓</SelectItemIndicator>
            </SelectItem>
          </SelectViewport>
        </div>
        <SchedulerCurve :name="highlighted" />
      </div>
    </SelectContent>
  </Select>
</template>
