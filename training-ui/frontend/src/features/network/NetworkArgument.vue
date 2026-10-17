<script setup lang="ts">
import { computed } from 'vue'
import Field from '@/components/forms/ConfigField.vue'
import { argumentValue, replaceArgument } from '../training/rules'
const props = defineProps<{ network: Record<string, any>; name: string; label: string; type?: 'number' | 'boolean' | 'text'; fallback?: any; help?: string; disabled?: boolean; min?: number; max?: number; step?: number | string }>()
const emit = defineEmits<{ change: [value: any] }>()
const holder = computed(() => new Proxy({} as Record<string, any>, {
  get(_target, key) {
    if (key !== 'value') return undefined
    const raw = argumentValue(props.network.network_args, props.name)
    if (raw === undefined) return props.fallback
    if (props.type === 'boolean') return /^(true|1|yes|y|on)$/i.test(raw.trim())
    if (props.type === 'number') return Number(raw)
    return raw
  },
  set(_target, key, value) {
    if (key !== 'value') return false
    props.network.network_args = replaceArgument(props.network.network_args, props.name, value === false ? undefined : value)
    return true
  },
  deleteProperty(_target, key) {
    if (key !== 'value') return false
    props.network.network_args = replaceArgument(props.network.network_args, props.name, undefined)
    return true
  },
}))
</script>
<template><Field :object="holder" field="value" :label="label" :type="type || 'text'" :fallback="fallback" :help="help" :disabled="disabled" :min="min" :max="max" :step="step" @change="emit('change', $event)" /></template>
