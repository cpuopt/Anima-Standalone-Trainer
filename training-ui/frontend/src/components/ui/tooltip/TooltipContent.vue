<script setup lang="ts">
// shadcn-vue / Reka UI Tooltip, styled with this application's theme tokens.
import type { TooltipContentEmits, TooltipContentProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { TooltipArrow, TooltipContent, TooltipPortal, useForwardPropsEmits } from 'reka-ui'
import { cn } from '@/lib/utils'
defineOptions({ inheritAttrs: false })
const props = withDefaults(defineProps<TooltipContentProps & { class?: HTMLAttributes['class'] }>(), { sideOffset: 8, collisionPadding: 12 })
const emit = defineEmits<TooltipContentEmits>()
const forwarded = useForwardPropsEmits(reactiveOmit(props, 'class'), emit)
</script>
<template>
  <TooltipPortal>
    <TooltipContent data-slot="tooltip-content" v-bind="{ ...forwarded, ...$attrs }" :class="cn('config-tooltip', props.class)">
      <slot /><TooltipArrow class="config-tooltip-arrow" :width="10" :height="5" />
    </TooltipContent>
  </TooltipPortal>
</template>
