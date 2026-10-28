<script setup lang="ts">
import type { SelectContentEmits, SelectContentProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { SelectContent, SelectPortal, useForwardPropsEmits } from 'reka-ui'
import { cn } from '@/lib/utils'
defineOptions({ inheritAttrs: false })
const props = withDefaults(defineProps<SelectContentProps & { class?: HTMLAttributes['class'] }>(), {
  position: 'popper', sideOffset: 6, collisionPadding: 12,
})
const emit = defineEmits<SelectContentEmits>()
const forwarded = useForwardPropsEmits(reactiveOmit(props, 'class'), emit)
</script>
<template>
  <SelectPortal>
    <SelectContent v-bind="{ ...forwarded, ...$attrs }" data-slot="select-content" :class="cn('scheduler-select-content', props.class)"><slot /></SelectContent>
  </SelectPortal>
</template>
