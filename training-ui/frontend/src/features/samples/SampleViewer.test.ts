import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import SampleViewer from './SampleViewer.vue'

afterEach(() => { document.body.style.overflow = ''; vi.restoreAllMocks() })
function open() {
  const wrapper = mount(SampleViewer,{attachTo:document.body,props:{image:{name:'example.png',path:'/example.png',mtime:1},metadata:'actual parameters',index:0,count:2}})
  const stage = document.querySelector<HTMLElement>('.viewer-stage')!
  Object.defineProperties(stage,{clientWidth:{value:1024,configurable:true},clientHeight:{value:724,configurable:true}})
  const img = document.querySelector<HTMLImageElement>('.viewer-stage img')!
  Object.defineProperties(img,{naturalWidth:{value:1000,configurable:true},naturalHeight:{value:1400,configurable:true}})
  img.dispatchEvent(new Event('load'))
  return {wrapper,stage}
}
describe('sample image viewport', () => {
  it('zooms around the cursor, isolates wheel events, and restores body scroll', async () => {
    document.body.style.overflow = 'auto'
    const {wrapper,stage} = open()
    await flushPromises()
    const before = Number(stage.dataset.scale)
    const event = new WheelEvent('wheel',{deltaY:-120,clientX:200,clientY:150,bubbles:true,cancelable:true})
    stage.dispatchEvent(event)
    await flushPromises()
    expect(event.defaultPrevented).toBe(true)
    expect(Number(stage.dataset.scale)).toBeGreaterThan(before)
    expect(stage.dataset.pan).not.toBe('0,0')
    const zoomed = stage.dataset.scale
    document.querySelector('.viewer-inspector')!.dispatchEvent(new WheelEvent('wheel',{deltaY:120,bubbles:true}))
    await flushPromises()
    expect(stage.dataset.scale).toBe(zoomed)
    expect(document.body.style.overflow).toBe('hidden')
    wrapper.unmount()
    expect(document.body.style.overflow).toBe('auto')
  })
  it('supports fit, actual size, keyboard navigation and image-change reset', async () => {
    const {wrapper,stage} = open()
    await flushPromises()
    document.querySelectorAll<HTMLButtonElement>('.viewer-zoom button')[3]!.click()
    await flushPromises()
    expect(Number(stage.dataset.scale)).toBe(1)
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'0'}))
    await flushPromises()
    expect(Number(stage.dataset.scale)).toBeCloseTo(.5)
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight'}))
    expect(wrapper.emitted('navigate')).toEqual([['ArrowRight']])
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))
    expect(wrapper.emitted('close')).toHaveLength(1)
    await wrapper.setProps({image:{name:'next.png',path:'/next.png',mtime:2}})
    const next = document.querySelector<HTMLImageElement>('.viewer-stage img')!
    Object.defineProperties(next,{naturalWidth:{value:1400},naturalHeight:{value:800}})
    next.dispatchEvent(new Event('load'))
    await flushPromises()
    expect(Number(stage.dataset.scale)).toBeCloseTo(1000/1400)
    expect(stage.dataset.pan).toBe('0,0')
    wrapper.unmount()
  })
})
