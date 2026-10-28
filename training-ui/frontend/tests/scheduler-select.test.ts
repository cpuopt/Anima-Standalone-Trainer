import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { reactive } from 'vue'
import ConfigField from '@/components/forms/ConfigField.vue'
import TrainingPanel from '@/features/training/TrainingPanel.vue'
import { useEditorStore } from '@/stores/editor'
import { Krea2, Moss } from '@/domain/legacy'
import { curvePaths, schedulerPreviews } from '@/components/forms/scheduler-curves'

const wrappers: VueWrapper[] = []
const scrollDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')
beforeEach(() => {
  setActivePinia(createPinia())
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable:true, value:vi.fn() })
})
afterEach(() => {
  wrappers.splice(0).forEach(w => w.unmount()); document.body.innerHTML = ''; vi.restoreAllMocks(); vi.unstubAllGlobals()
  if (scrollDescriptor) Object.defineProperty(Element.prototype, 'scrollIntoView', scrollDescriptor)
  else Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
})
function render(object: Record<string, any> = reactive({lr_scheduler:'cosine'}), disabled = false) {
  const w = mount(ConfigField, { attachTo:document.body, props:{ object, field:'lr_scheduler', label:'LR Scheduler', type:'select', options:Object.keys(schedulerPreviews), disabled } })
  wrappers.push(w); return w
}
async function open(w: VueWrapper) {
  const trigger = w.get('[role="combobox"]')
  ;(trigger.element as HTMLElement).focus()
  await trigger.trigger('keydown', { key:'ArrowDown' }); await flushPromises()
}
function option(name: string) { return document.querySelector(`[data-scheduler-option="${name}"]`) as HTMLElement }
function preview() { return document.querySelector('[data-scheduler-preview]') as HTMLElement }

describe('LR Scheduler illustration dropdown', () => {
  it('has distinct bounded SVG curves for every current backend scheduler', () => {
    for (const name of [...Krea2.SCHEDULERS, ...Moss.SCHEDULERS]) expect(schedulerPreviews[name], name).toBeDefined()
    const paths = Object.keys(schedulerPreviews).map(name => curvePaths(name).join(' '))
    expect(new Set(paths).size).toBe(6)
    expect(paths.join('')).not.toMatch(/NaN|Infinity/)
    expect(curvePaths('constant')[0]).toContain('L285.00,17.00')
    expect(curvePaths('cosine')[0]).toContain('L285.00,136.00')
    expect(curvePaths('cosine_with_restarts')).toHaveLength(3)
    expect(curvePaths('custom')).toEqual([])
    expect(curvePaths('constructor')).toEqual([])
  })
  it('previews each hovered option through a portal without changing the value', async () => {
    const object = reactive({ lr_scheduler:'cosine', custom:'preserve' })
    const w = render(object); await open(w)
    expect(document.querySelector('[data-slot="select-content"]')).not.toBeNull()
    for (const name of Object.keys(schedulerPreviews)) {
      option(name).dispatchEvent(new MouseEvent('pointermove', { bubbles:true }))
      await flushPromises()
      expect(preview().dataset.schedulerPreview).toBe(name)
      expect(preview().querySelector('svg[role="img"]')).not.toBeNull()
      expect(preview().textContent).toContain('不是当前任务的实际学习率')
      expect(object).toEqual({lr_scheduler:'cosine',custom:'preserve'})
    }
    expect(w.emitted('change')).toBeUndefined()
  })
  it('updates preview on keyboard navigation and commits only on Enter', async () => {
    const object = reactive({ lr_scheduler:'cosine' })
    const w = render(object); await open(w)
    option('linear').focus(); await flushPromises()
    expect(preview().dataset.schedulerPreview).toBe('linear')
    option('linear').dispatchEvent(new KeyboardEvent('keydown', { key:'ArrowDown', bubbles:true }))
    await flushPromises()
    await vi.waitFor(() => expect(preview().dataset.schedulerPreview).toBe('cosine'))
    expect(object.lr_scheduler).toBe('cosine')
    option('polynomial').focus()
    option('polynomial').dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', bubbles:true }))
    await flushPromises()
    expect(object.lr_scheduler).toBe('polynomial')
    expect(w.emitted('change')).toEqual([['polynomial']])
    expect(document.querySelector('[data-slot="select-content"]')).toBeNull()
  })
  it('pointer selection applies the hovered option once', async () => {
    const object = reactive({lr_scheduler:'cosine'}), w = render(object)
    await open(w)
    option('linear').dispatchEvent(new MouseEvent('pointermove', {bubbles:true, clientX:40, clientY:40})); await flushPromises()
    expect(object.lr_scheduler).toBe('cosine')
    option('linear').dispatchEvent(new MouseEvent('pointerup', {bubbles:true, cancelable:true, clientX:40, clientY:40})); await flushPromises()
    expect(object.lr_scheduler).toBe('linear')
    expect(w.emitted('change')).toEqual([['linear']])
  })
  it('Escape cancels browsing, preserves the original value and returns focus', async () => {
    const object = reactive({ lr_scheduler:'cosine' }), w = render(object)
    await open(w); option('constant').focus(); await flushPromises()
    document.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true }))
    await flushPromises()
    expect(object.lr_scheduler).toBe('cosine')
    expect(w.emitted('change')).toBeUndefined()
    expect(document.querySelector('[data-slot="select-content"]')).toBeNull()
    expect(document.activeElement).toBe(w.get('[role="combobox"]').element)
  })
  it('shows a placeholder without writing defaults and preserves custom loaded values', async () => {
    const unset = reactive({}), w = render(unset)
    expect(w.get('[role="combobox"]').text()).toContain('未设置')
    await open(w); expect(unset).toEqual({})
    w.unmount(); wrappers.splice(0)
    const object = reactive({lr_scheduler:'custom_scheduler'}), custom = render(object)
    await open(custom)
    expect(preview().textContent).toContain('自定义调度器')
    expect(preview().querySelector('svg')).toBeNull()
    expect(object.lr_scheduler).toBe('custom_scheduler')
  })
  it('respects disabled fields and closes an open menu if the form becomes locked', async () => {
    const disabled = render(reactive({lr_scheduler:'cosine'}), true)
    expect(disabled.get('[role="combobox"]').attributes('disabled')).toBeDefined()
    await open(disabled); expect(preview()).toBeNull()
    disabled.unmount(); wrappers.splice(0)
    const w = render(); await open(w)
    expect(preview()).not.toBeNull()
    useEditorStore().saving = true; await flushPromises()
    expect(w.get('[role="combobox"]').attributes('disabled')).toBeDefined()
    expect(preview()).toBeNull()
  })
  it.each(['anima','krea2','moss_image'])('uses the preview select in %s without mutating configuration on open', async architecture => {
    const store = useEditorStore(); store.name = 'preview'; store.architecture = architecture
    store.config = architecture === 'moss_image' ? Moss.defaults() : architecture === 'krea2' ? Krea2.defaults() : {training_arguments:{lr_scheduler:'cosine'}}
    const before = JSON.stringify(store.config)
    const w = mount(TrainingPanel, {attachTo:document.body}); wrappers.push(w)
    await open(w)
    expect(preview().querySelector('svg')).not.toBeNull()
    expect(JSON.stringify(store.config)).toBe(before)
  })
})
