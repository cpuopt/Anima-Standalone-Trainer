import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { useEditorStore } from '@/stores/editor'
import { Krea2, Moss } from '@/domain/training'
import TrainingPanel from './TrainingPanel.vue'

const wrappers: VueWrapper[] = []
beforeEach(() => {
  setActivePinia(createPinia())
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(() => {
  wrappers.splice(0).forEach(w => w.unmount())
  vi.unstubAllGlobals()
})

describe('TrainingPanel redesigned controls', () => {
  it('offers Muon only for Anima full fine-tuning and preserves the previous optimizer', async () => {
    const store = useEditorStore()
    store.architecture = 'anima'
    store.config = { network_arguments: {}, training_arguments: { optimizer_type: 'AdamW' } }
    const w = mount(TrainingPanel)
    wrappers.push(w)
    const toggle = '[data-tt-field="use_muon"] input'
    await w.get(toggle).setValue(true)
    expect(store.config.training_arguments.use_muon).toBe(true)
    expect(store.config.training_arguments.optimizer_type).toBe('AdamW')
    expect(w.find('[data-tt-field="optimizer_type"]').exists()).toBe(false)
    await w.get(toggle).setValue(false)
    expect(w.find('[data-tt-field="optimizer_type"]').exists()).toBe(true)
    store.config.network_arguments.network_module = 'networks.lora_anima'
    await flushPromises()
    expect(w.find(toggle).exists()).toBe(false)
  })

  it('renders RunTimeline and LearningRateControl across Anima, Krea 2, and MOSS without mutating config', () => {
    for (const arch of ['anima', 'krea2', 'moss_image']) {
      const store = useEditorStore()
      store.name = `job-${arch}`
      store.architecture = arch
      store.config = arch === 'krea2' ? Krea2.defaults() : arch === 'moss_image' ? Moss.defaults() : { training_arguments: { learning_rate: 0.00005, lr_scheduler: 'cosine_with_restarts', lr_scheduler_num_cycles: 3 } }
      const before = JSON.stringify(store.config)
      const w = mount(TrainingPanel)
      wrappers.push(w)
      expect(w.find('.tt-chart-svg').exists(), arch).toBe(true)
      expect(w.find('.tt-gauge[role="slider"]').exists(), arch).toBe(true)
      expect(w.find('button[aria-label="增大 Learning Rate"]').exists(), arch).toBe(true)
      expect(w.find('button[aria-label="减小 Learning Rate"]').exists(), arch).toBe(true)
      expect(JSON.stringify(store.config), arch).toBe(before)
    }
  })

  it('updates learning_rate via +/- steppers and validates non-positive values', async () => {
    const store = useEditorStore()
    store.name = 'lr-test'
    store.architecture = 'anima'
    store.config = { training_arguments: { learning_rate: 0.00005 } }
    const w = mount(TrainingPanel)
    wrappers.push(w)

    await w.get('button[aria-label="增大 Learning Rate"]').trigger('click')
    expect(store.config.training_arguments.learning_rate).toBeCloseTo(0.00006, 9)

    await w.get('button[aria-label="减小 Learning Rate"]').trigger('click')
    expect(store.config.training_arguments.learning_rate).toBeCloseTo(0.00005, 9)

    const input = w.get('.tt-lr-input')
    await input.setValue('-1')
    expect(Object.keys(store.fieldErrors).length).toBe(1)
    expect(w.find('.tt-lr-field .error').text()).toContain('必须大于 0')

    await input.setValue('1e-4')
    expect(store.config.training_arguments.learning_rate).toBeCloseTo(0.0001, 9)
    expect(Object.keys(store.fieldErrors).length).toBe(0)
  })

  it.each(['anima', 'krea2'])('shows Restart Cycles for cosine_with_min_lr in %s and updates timeline', async (arch) => {
    const store = useEditorStore()
    store.name = `min-lr-${arch}`
    store.architecture = arch
    if (arch === 'krea2') {
      store.config = Krea2.defaults()
      store.config.training_arguments.lr_scheduler = 'cosine_with_min_lr'
    } else {
      store.config = { training_arguments: { learning_rate: 0.00005, lr_scheduler: 'cosine_with_min_lr' } }
    }
    const before = JSON.stringify(store.config)
    const w = mount(TrainingPanel)
    wrappers.push(w)

    expect(w.find('[data-tt-field="lr_scheduler_num_cycles"]').exists()).toBe(true)
    expect(w.find('[data-tt-field="lr_scheduler_min_lr_ratio"]').exists()).toBe(true)
    expect(JSON.stringify(store.config)).toBe(before)

    const cyclesInput = w.get('[data-tt-field="lr_scheduler_num_cycles"] input')
    await cyclesInput.setValue('3')
    expect(store.config.training_arguments.lr_scheduler_num_cycles).toBe(3)
    expect(w.find('.tt-recipe-bar').text()).toContain('cosine×3 (min 0)')
    expect(w.find('.tt-chart-svg').text()).toContain('cosine_with_min_lr · 3 cycles')

    store.config.training_arguments.lr_scheduler = 'cosine'
    await flushPromises()
    expect(w.find('[data-tt-field="lr_scheduler_num_cycles"]').exists()).toBe(false)
    expect(w.find('[data-tt-field="lr_scheduler_min_lr_ratio"]').exists()).toBe(false)

    store.config.training_arguments.lr_scheduler = 'cosine_with_restarts'
    await flushPromises()
    expect(w.find('[data-tt-field="lr_scheduler_num_cycles"]').exists()).toBe(true)
    expect(w.find('[data-tt-field="lr_scheduler_min_lr_ratio"]').exists()).toBe(false)
  })

  it('renders cosine_with_restarts timeline with N decay cycles and N - 1 vertical hard restarts', async () => {
    const store = useEditorStore()
    store.name = 'restarts-timeline'
    store.architecture = 'anima'
    store.config = {
      training_arguments: {
        learning_rate: 0.0001,
        lr_scheduler: 'cosine_with_restarts',
        lr_scheduler_num_cycles: 5,
        lr_warmup_steps: 0,
      },
    }
    const w = mount(TrainingPanel)
    wrappers.push(w)

    expect(w.find('.tt-chart-svg').text()).toContain('cosine_with_restarts · 5 周期（4 次重启）')
    expect(w.find('.tt-recipe-bar').text()).toContain('cosine×5（重启4次）')
    const path5 = w.findAll('.tt-chart-svg path.tt-hit-stroke').at(-1)!.attributes('d')!
    expect(path5.match(/L([\d.]+),166\.0 L\1,32\.0/g)).toHaveLength(4)

    store.config.training_arguments.lr_scheduler_num_cycles = 1
    await flushPromises()
    expect(w.find('.tt-chart-svg').text()).toContain('cosine_with_restarts · 1 周期（0 次重启）')
    const path1 = w.findAll('.tt-chart-svg path.tt-hit-stroke').at(-1)!.attributes('d')!
    expect(path1.match(/L([\d.]+),166\.0 L\1,32\.0/g)).toBeNull()
    const annText = w.findAll('.tt-chart-svg text.primary-ink').at(0)!
    const annX = Number(annText.attributes('x'))
    expect(annX).toBeGreaterThanOrEqual(58)
    expect(annX).toBeLessThanOrEqual(960)
  })
})
