import { mount } from '@vue/test-utils'
import { defineComponent, h, onUnmounted, ref } from 'vue'
import { expect, it, vi } from 'vitest'
import PersistentPanels from './PersistentPanels.vue'

it('mounts tabs lazily and retains iframe DOM and local state when switching', async () => {
  const mounted = vi.fn(), unmounted = vi.fn()
  const metrics = defineComponent({ setup() {
    mounted(); onUnmounted(unmounted)
    const count = ref(0)
    return () => h('section', [h('iframe', { src: '/tensorboard/job/' }), h('button', { onClick: () => count.value++ }, String(count.value))])
  } })
  const tabs = [{ id: 'training', component: defineComponent({ render: () => h('p', 'Training') }) }, { id: 'tensorboard', component: metrics }]
  const wrapper = mount(PersistentPanels, { props: { tabs, active: 'training' }, attachTo: document.body })
  expect(mounted).not.toHaveBeenCalled()
  await wrapper.setProps({ active: 'tensorboard' })
  await wrapper.get('button').trigger('click')
  const iframe = wrapper.get('iframe').element
  await wrapper.setProps({ active: 'training' })
  expect(iframe.isConnected).toBe(true)
  expect(wrapper.get('[data-panel="tensorboard"]').isVisible()).toBe(false)
  await wrapper.setProps({ active: 'tensorboard' })
  expect(wrapper.get('iframe').element).toBe(iframe)
  expect(wrapper.get('button').text()).toBe('1')
  expect(mounted).toHaveBeenCalledOnce()
  expect(unmounted).not.toHaveBeenCalled()
  wrapper.unmount()
  expect(unmounted).toHaveBeenCalledOnce()
})

it('resets visited panels when the parent switches the job key', async () => {
  const job = ref('first')
  const panel = defineComponent({ setup() {
    const count = ref(0)
    return () => h('button', { onClick: () => count.value++ }, String(count.value))
  } })
  const tabs = [{ id: 'training', component: panel }]
  const wrapper = mount(defineComponent({ setup: () => () => h(PersistentPanels, { key: job.value, tabs, active: 'training' }) }))
  await wrapper.get('button').trigger('click')
  expect(wrapper.get('button').text()).toBe('1')
  job.value = 'second'
  await wrapper.vm.$nextTick()
  expect(wrapper.get('button').text()).toBe('0')
  wrapper.unmount()
})
