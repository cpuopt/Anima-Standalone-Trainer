import { beforeEach, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { reactive } from 'vue'
import ConfigField from '@/components/forms/ConfigField.vue'
import { useEditorStore } from '@/stores/editor'
beforeEach(() => setActivePinia(createPinia()))
it('does not write displayed defaults and preserves explicit zero and false', async () => {
  const object = reactive<Record<string, any>>({ zero: 0, disabled: false })
  const input = mount(ConfigField, { props: { object, field:'unset', label:'Unset', type:'number', fallback:32 } })
  expect(object).toEqual({ zero:0, disabled:false })
  await input.find('input').setValue('0'); expect(object.unset).toBe(0)
  input.unmount()
})
it('preserves numeric select values used by distributed configuration', async () => {
  const object = reactive<Record<string, any>>({ stage:2 })
  const input = mount(ConfigField, { props:{ object, field:'stage', label:'Stage', type:'select', options:[{value:2,label:'Two'},{value:3,label:'Three'}] } })
  await input.find('select').setValue('3'); expect(object.stage).toBe(3)
  input.unmount()
})
it('blocks save when JSON is incomplete instead of silently saving its previous value', async () => {
  const store = useEditorStore(), object = reactive({ args:['existing=0'] })
  const input = mount(ConfigField, { props:{ object, field:'args', label:'Args', type:'json' } })
  await input.find('textarea').setValue('["unfinished')
  expect(object.args).toEqual(['existing=0']); expect(() => store.validate()).toThrow('Args')
  await input.find('textarea').setValue('["changed=0"]')
  expect(object.args).toEqual(['changed=0']); expect(Object.keys(store.fieldErrors)).toHaveLength(0)
  input.unmount()
})
