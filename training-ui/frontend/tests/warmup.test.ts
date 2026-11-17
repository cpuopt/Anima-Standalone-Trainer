import { beforeEach, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import TrainingPanel from '@/features/training/TrainingPanel.vue'
import ConfigField from '@/components/forms/ConfigField.vue'
import { validateConfig } from '@/features/training/rules'
import { useEditorStore } from '@/stores/editor'

beforeEach(() => setActivePinia(createPinia()))

it('defaults old configs to steps and retains both values across switches', async () => {
  const store = useEditorStore()
  store.config = { architecture:'anima', training_arguments:{ lr_warmup_steps:123 } }
  const panel = mount(TrainingPanel)
  const field = (text: string) => panel.findAllComponents(ConfigField).find(component => component.props('label') === text)!
  expect(field('LR Warmup Steps').find('input').element.value).toBe('123')
  expect(store.config.training_arguments).toEqual({lr_warmup_steps:123})
  await field('LR Warmup Unit').find('select').setValue('epochs')
  await field('LR Warmup Epochs').find('input').setValue('2.5')
  await field('LR Warmup Unit').find('select').setValue('steps')
  expect(field('LR Warmup Steps').find('input').element.value).toBe('123')
  await field('LR Warmup Unit').find('select').setValue('epochs')
  expect(field('LR Warmup Epochs').find('input').element.value).toBe('2.5')
  expect(store.config.training_arguments.lr_warmup_steps).toBe(123)
  panel.unmount()
})

it('validates epoch durations and rejects unsupported optimizers', async () => {
  for (const value of [-1, NaN, Infinity, '2', true]) {
    await expect(validateConfig({training_arguments:{lr_warmup_unit:'epochs',lr_warmup_epochs:value}})).rejects.toThrow('LR Warmup Epochs')
  }
  for (const value of [0, 0.5, 2]) {
    await expect(validateConfig({training_arguments:{lr_warmup_unit:'epochs',lr_warmup_epochs:value}})).resolves.toBeUndefined()
  }
  await expect(validateConfig({training_arguments:{lr_warmup_unit:'epochs',optimizer_type:'AdamWScheduleFree'}})).rejects.toThrow('ScheduleFree')
})
