<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue'
import { Input } from '@/components/ui/input'
import { useEditorStore } from '@/stores/editor'
const props = withDefaults(defineProps<{
  object: Record<string, any>; field: string; label: string;
  type?: 'text' | 'number' | 'boolean' | 'textarea' | 'select' | 'json';
  options?: Array<string | { value: any; label: string }>; fallback?: any; disabled?: boolean;
  min?: number | string; max?: number | string; step?: number | string; help?: string;
}>(), { type: 'text' })
const emit = defineEmits<{ change: [value: any]; 'update:modelValue': [value: any] }>()
const store = useEditorStore(), id = useId(), localError = ref(''), jsonText = ref('')
const value = computed(() => props.object[props.field] ?? props.fallback ?? (props.type === 'boolean' ? false : ''))
watch(() => value.value, v => { if (!localError.value) jsonText.value = v === '' ? '' : JSON.stringify(v, null, 2) }, { immediate: true, deep: true })
function fail(message: string) { localError.value = message; store.fieldErrors[id] = `${props.label}: ${message}` }
function update(raw: any) {
  if (props.disabled) return
  try {
    let v = raw
    if (props.type === 'select') {
      const match = props.options?.find(option => String(typeof option === 'string' ? option : option.value) === raw)
      if (match && typeof match !== 'string') v = match.value
    }
    if (props.type === 'json') { jsonText.value = raw; v = raw.trim() ? JSON.parse(raw) : undefined }
    if (props.type === 'number') {
      if (raw === '') v = undefined
      else {
        v = Number(raw)
        if (!Number.isFinite(v)) throw Error('请输入有效数字')
        if (props.min !== undefined && v < Number(props.min)) throw Error(`最小值为 ${props.min}`)
        if (props.max !== undefined && v > Number(props.max)) throw Error(`最大值为 ${props.max}`)
      }
    }
    if (v === undefined) delete props.object[props.field]
    else props.object[props.field] = v
    localError.value = ''; delete store.fieldErrors[id]
    emit('change', v); emit('update:modelValue', v)
  } catch (e: any) { fail(e.message) }
}
onBeforeUnmount(() => { delete store.fieldErrors[id] })
</script>
<template>
  <div class="field" :class="{ 'field-check': type === 'boolean' }">
    <template v-if="type === 'boolean'">
      <input :id="id" type="checkbox" :checked="Boolean(value)" :disabled="disabled" @change="update(($event.target as HTMLInputElement).checked)">
      <label :for="id">{{ label }}</label>
    </template>
    <template v-else>
      <label :for="id">{{ label }}</label>
      <select v-if="type === 'select'" :id="id" :value="value" :disabled="disabled" @change="update(($event.target as HTMLSelectElement).value)">
        <option v-if="value === ''" value="">未设置</option>
        <option v-for="option in options" :key="String(typeof option === 'string' ? option : option.value)" :value="typeof option === 'string' ? option : option.value">{{ typeof option === 'string' ? option : option.label }}</option>
      </select>
      <textarea v-else-if="type === 'textarea' || type === 'json'" :id="id" :value="type === 'json' ? jsonText : value" :disabled="disabled" rows="4" spellcheck="false" @input="update(($event.target as HTMLTextAreaElement).value)" />
      <Input v-else :id="id" :type="type" :model-value="value" :disabled="disabled" :min="min" :max="max" :step="step ?? (type === 'number' ? 'any' : undefined)" @update:model-value="update" />
    </template>
    <small v-if="help" class="muted">{{ help }}</small>
    <small v-if="localError" class="error" role="alert">{{ localError }}</small>
  </div>
</template>
