<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useEditorStore } from '@/stores/editor'
import { fieldHelpScope } from './help-context'
import { getFieldHelp } from './field-help'
const props = defineProps<{ field: string; label: string; note?: string }>()
const scope = inject(fieldHelpScope, undefined)
const store = useEditorStore(), open = ref(false)
const info = computed(() => scope ? getFieldHelp(scope, props.field, store.architecture, store.config.network_arguments?.network_module) : undefined)
function toggle() { open.value = !open.value }
</script>
<template>
  <TooltipProvider v-if="info">
    <Tooltip v-model:open="open">
      <TooltipTrigger as-child>
        <!-- Not a second labelable control inside <label>; remains focusable in locked fieldsets. -->
        <span class="field-help-trigger" role="button" tabindex="0" :aria-label="`${label}：参数说明`" :data-field-help="field"
          @click.stop.prevent="toggle" @keydown.enter.stop.prevent="toggle" @keydown.space.stop.prevent="toggle">?</span>
      </TooltipTrigger>
      <TooltipContent side="top">
        <div class="field-help-content">
          <strong>{{info.title}}</strong>
          <p><b>含义：</b>{{info.meaning}}</p>
          <p><b>作用：</b>{{info.effect}}</p>
          <div v-if="info.notes.length" class="field-help-notes"><b>兼容与注意：</b><ul><li v-for="note in info.notes" :key="note">{{note}}</li></ul></div>
          <p v-if="note && !info.notes.includes(note)" class="field-help-extra">{{note}}</p>
        </div>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
</template>
