<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue'
import FieldHelp from '@/components/forms/FieldHelp.vue'
import { useEditorStore } from '@/stores/editor'
import { formatLr, gaugeRatioToLr, lrToGaugeRatio, stepLrValue } from './timeline'

const props = withDefaults(defineProps<{
  object: Record<string, any>
  field?: string
  label?: string
  fallback?: number
  disabled?: boolean
}>(), {
  field: 'learning_rate',
  label: 'Learning Rate',
  fallback: 0.00005,
})

const store = useEditorStore()
const id = useId()
const localError = ref('')
const focused = ref(false)
const draftText = ref('')
const gaugeEl = ref<HTMLElement | null>(null)

const numericValue = computed<number>(() => {
  const raw = props.object[props.field]
  if (raw === undefined || raw === null || raw === '') return props.fallback
  return Number(raw)
})

const displayValue = computed(() => (focused.value ? draftText.value : formatLr(numericValue.value)))
const gaugePercent = computed(() => `${(lrToGaugeRatio(numericValue.value) * 100).toFixed(1)}%`)
const isDisabled = computed(() => Boolean(props.disabled || store.locked))

watch(numericValue, v => {
  if (!focused.value) draftText.value = formatLr(v)
}, { immediate: true })

function fail(message: string) {
  localError.value = message
  store.fieldErrors[id] = `${props.label}: ${message}`
}

function clearError() {
  localError.value = ''
  delete store.fieldErrors[id]
}

function commitNumber(v: number | undefined) {
  if (isDisabled.value) return
  if (v === undefined) {
    delete props.object[props.field]
    clearError()
    return
  }
  if (!Number.isFinite(v)) { fail('请输入有效数字'); return }
  if (v <= 0) { fail('必须大于 0'); return }
  props.object[props.field] = v
  clearError()
}

function onInput(event: Event) {
  const raw = (event.target as HTMLInputElement).value
  draftText.value = raw
  if (raw.trim() === '') {
    commitNumber(undefined)
    return
  }
  const n = Number(raw)
  commitNumber(n)
}

function onFocus() {
  focused.value = true
  draftText.value = formatLr(numericValue.value)
}

function onBlur() {
  focused.value = false
  if (!localError.value) draftText.value = formatLr(numericValue.value)
}

function step(dir: -1 | 1) {
  if (isDisabled.value) return
  const next = stepLrValue(numericValue.value, dir)
  commitNumber(next)
  draftText.value = formatLr(next)
}

function applyClientX(clientX: number) {
  const el = gaugeEl.value
  if (!el || isDisabled.value) return
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0) return
  const next = gaugeRatioToLr((clientX - rect.left) / rect.width)
  commitNumber(next)
  draftText.value = formatLr(next)
}

function onGaugePointerDown(event: PointerEvent) {
  if (isDisabled.value || event.button !== 0) return
  event.preventDefault()
  const el = gaugeEl.value
  el?.setPointerCapture?.(event.pointerId)
  applyClientX(event.clientX)
  const onMove = (ev: PointerEvent) => applyClientX(ev.clientX)
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onUp)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
}

function onGaugeKeydown(event: KeyboardEvent) {
  if (isDisabled.value) return
  if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') { event.preventDefault(); step(-1) }
  if (event.key === 'ArrowRight' || event.key === 'ArrowUp') { event.preventDefault(); step(1) }
}

onBeforeUnmount(() => { delete store.fieldErrors[id] })
</script>

<template>
  <div class="field tt-lr-field" :data-tt-field="field">
    <div class="field-label-row">
      <label :for="id">{{ label }}</label>
      <FieldHelp :field="field" :label="label" />
    </div>
    <div class="tt-lr-row">
      <input
        :id="id"
        class="tt-lr-input"
        type="text"
        inputmode="decimal"
        :value="displayValue"
        :disabled="isDisabled"
        @focus="onFocus"
        @blur="onBlur"
        @input="onInput"
      />
      <div class="tt-stepper">
        <button type="button" :disabled="isDisabled" aria-label="减小 Learning Rate" @click="step(-1)">−</button>
        <button type="button" :disabled="isDisabled" aria-label="增大 Learning Rate" @click="step(1)">+</button>
      </div>
    </div>
    <div
      ref="gaugeEl"
      class="tt-gauge"
      :class="{ 'is-disabled': isDisabled }"
      role="slider"
      :tabindex="isDisabled ? -1 : 0"
      aria-label="Learning Rate 滑条"
      :aria-valuemin="0.000001"
      :aria-valuemax="0.001"
      :aria-valuenow="Number.isFinite(numericValue) ? numericValue : 0"
      :aria-disabled="isDisabled"
      title="点击或横向拖拽调节 Learning Rate"
      @pointerdown="onGaugePointerDown"
      @keydown="onGaugeKeydown"
    >
      <div class="tt-gauge-fill" :style="{ width: gaugePercent }" />
      <div class="tt-gauge-ticks" />
    </div>
    <div class="tt-scale-marks" aria-hidden="true">
      <span>1e-6</span><span>1e-5</span><span>5e-5</span><span>1e-4</span><span>1e-3</span>
    </div>
    <small v-if="localError" class="error" role="alert">{{ localError }}</small>
  </div>
</template>
