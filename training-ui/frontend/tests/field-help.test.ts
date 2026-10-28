import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import Field from '@/components/forms/ConfigField.vue'
import FieldHelp from '@/components/forms/FieldHelp.vue'
import { provideFieldHelp } from '@/components/forms/help-context'
import { fieldHelpCatalog, getFieldHelp } from '@/components/forms/field-help'
import { useEditorStore } from '@/stores/editor'
import { Krea2, Moss } from '@/domain/legacy'
import TrainingPanel from '@/features/training/TrainingPanel.vue'
import DatasetPanel from '@/features/dataset/DatasetPanel.vue'
import NetworkPanel from '@/features/network/NetworkPanel.vue'
vi.mock('@/services/api', () => ({ api: vi.fn(async () => ({ block_count:1, layers:['blocks.0.self_attn.q_proj'], count:1, exists:true, readable:true })) }))
const wrappers: VueWrapper[] = []
beforeEach(() => {
  setActivePinia(createPinia())
  // jsdom has no layout observer; keep the actual Reka portal and events intact.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(() => { wrappers.splice(0).forEach(w => w.unmount()); document.body.innerHTML = ''; vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
function render(component: any) { const w = mount(component, { attachTo: document.body }); wrappers.push(w); return w }
function fixture(architecture = 'anima') {
  const store = useEditorStore()
  store.name = 'tooltip-test'; store.architecture = architecture
  store.config = architecture === 'krea2' ? Krea2.defaults() : architecture === 'moss_image' ? Moss.defaults() : {
    training_arguments:{ lr_scheduler:'cosine_with_restarts', optimizer_type:'Prodigy' },
    network_arguments:{ network_module:'networks.lokr', network_dim:16, network_alpha:16, network_args:['use_dora=true'] },
  }
  store.dataset = { general:{}, datasets:[{ resolution:1024, batch_size:1, subsets:[{ image_dir:'', num_repeats:1 }] }] }
  return store
}
function tooltipContent() { return document.querySelector('[data-slot="tooltip-content"]')! }

describe('Chinese parameter help', () => {
  it('every catalog entry provides Chinese meaning and effect', () => {
    for (const [scope, entries] of Object.entries(fieldHelpCatalog)) for (const key of Object.keys(entries)) {
      const help = getFieldHelp(scope as keyof typeof fieldHelpCatalog, key)!
      expect(help, `${scope}.${key}`).toBeDefined()
      expect(help.meaning).toMatch(/[\u4e00-\u9fff]/)
      expect(help.effect).toMatch(/[\u4e00-\u9fff]/)
    }
    expect(getFieldHelp('training', 'unknown_future_option')).toBeUndefined()
  })
  it.each(['anima','krea2','moss_image'])('covers rendered fields and native controls without changing %s drafts', async architecture => {
    const store = fixture(architecture)
    const before = JSON.stringify({config:store.config,dataset:store.dataset})
    for (const component of [TrainingPanel, DatasetPanel, NetworkPanel]) {
      const w = render(component)
      for (const field of w.findAllComponents(Field)) {
        expect(field.find('[data-field-help]').exists(), `${architecture}: ${field.props('label')}`).toBe(true)
      }
      // Native controls not using ConfigField must also have a help affordance.
      for (const label of w.findAll('label.field')) {
        if (label.find('input,select,textarea').exists()) expect(label.find('[data-field-help]').exists(), label.text()).toBe(true)
      }
      expect(w.findAll('[data-field-help]').length).toBeGreaterThan(5)
    }
    await flushPromises()
    expect(JSON.stringify({config:store.config,dataset:store.dataset})).toBe(before)
  })
  it('shows compile conflicts through the real shadcn portal on keyboard focus and dismisses with Escape', async () => {
    fixture()
    const w = render(TrainingPanel)
    const trigger = w.get('[data-field-help="torch_compile"]')
    await trigger.trigger('focus'); await flushPromises()
    expect(tooltipContent()).not.toBeNull()
    expect(tooltipContent().textContent).toContain('含义：')
    expect(tooltipContent().textContent).toContain('作用：')
    expect(tooltipContent().textContent).toContain('CUDA Direct、TP/SP 明确互斥')
    expect(tooltipContent().textContent).toContain('Triton')
    document.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true }))
    await flushPromises()
    expect(tooltipContent()).toBeNull()
  })
  it('opens after mouse hover without touching the training document', async () => {
    vi.useFakeTimers()
    const store = fixture(), before = JSON.stringify(store.config)
    const Host = defineComponent({ components:{FieldHelp}, setup(){ provideFieldHelp('training'); return {} }, template:'<FieldHelp field="weight_decay" label="Weight Decay" />' })
    const w = render(Host)
    await w.get('[role="button"]').trigger('pointermove', { pointerType:'mouse' })
    await vi.advanceTimersByTimeAsync(300); await flushPromises()
    expect(tooltipContent()).not.toBeNull()
    expect(tooltipContent().textContent).toContain('可与 cosine 同用')
    expect(JSON.stringify(store.config)).toBe(before)
  })
  it('covers conditional scheduler, full finetune and MOSS compile fields', async () => {
    const store = fixture()
    store.config.training_arguments.lr_scheduler = 'cosine_with_min_lr'
    const training = render(TrainingPanel)
    expect(training.find('[data-field-help="lr_scheduler_min_lr_ratio"]').exists()).toBe(true)
    delete store.config.network_arguments.network_module
    const network = render(NetworkPanel)
    expect(network.find('[data-field-help="freeze_llm_adapter"]').exists()).toBe(true)
    training.unmount(); network.unmount(); wrappers.splice(0)
    fixture('moss_image').config.training_arguments.compile = true
    const moss = render(TrainingPanel)
    for (const key of ['compile_backend','compile_mode','compile_dynamic','compile_fullgraph','compile_cache_size_limit']) expect(moss.find(`[data-field-help="${key}"]`).exists()).toBe(true)
  })
  it('click, Enter and Space toggle explanations without changing the checkbox or submitting a form', async () => {
    const store = fixture(); store.config.training_arguments.gradient_checkpointing = false
    const w = render(TrainingPanel)
    const trigger = w.get('[data-field-help="gradient_checkpointing"]')
    await trigger.trigger('click'); await flushPromises()
    expect(tooltipContent()).not.toBeNull()
    expect(store.config.training_arguments.gradient_checkpointing).toBe(false)
    await trigger.trigger('keydown', { key:'Enter' }); await flushPromises()
    expect(tooltipContent()).toBeNull()
    await trigger.trigger('keydown', { key:' ' }); await flushPromises()
    expect(tooltipContent()).not.toBeNull()
    expect(store.config.training_arguments.gradient_checkpointing).toBe(false)
  })
  it('keeps help accessible when training locks inputs', async () => {
    const store = fixture(); store.saving = true
    const w = render(TrainingPanel)
    expect(w.get('fieldset').attributes('disabled')).toBeDefined()
    const trigger = w.get('[data-field-help="torch_compile"]')
    expect(trigger.attributes('tabindex')).toBe('0')
    await trigger.trigger('focus'); await flushPromises()
    expect(tooltipContent()).not.toBeNull()
  })
  it('uses architecture-specific notes and does not label every compile/offload combination as mutually exclusive', () => {
    expect(getFieldHelp('training','torch_compile')!.notes.join()).toContain('明确互斥')
    expect(getFieldHelp('training','compile','moss_image')!.notes.join()).toContain('排除对应 Linear')
    expect(getFieldHelp('training','compile','krea2')!.notes.join()).toContain('不能把 Anima')
    expect(getFieldHelp('training','discrete_flow_shift','krea2')!.notes.join()).toContain('krea2_shift')
    expect(getFieldHelp('dataset','caption_dropout_rate','moss_image')!.notes.join()).not.toContain('迁移到全局')
  })
  it('provides help for dynamic advanced layer rows and disabled full-matrix rank', async () => {
    fixture()
    const w = render(NetworkPanel)
    const toggle = w.findAll('label').find(x => x.text().startsWith('高级分层设置'))!
    await toggle.find('input').setValue(true); await flushPromises()
    for (const key of ['layer_mode','layer_enabled','layer_rank','layer_alpha','layer_factor']) expect(w.find(`[data-field-help="${key}"]`).exists()).toBe(true)
    const full = w.findAllComponents(Field).find(x => x.props('label') === 'Full Matrix')!
    await full.find('input').setValue(true)
    const rank = w.findAllComponents(Field).find(x => x.props('field') === 'network_dim')!
    expect(rank.find('input').attributes('disabled')).toBeDefined()
    await rank.get('[data-field-help="network_dim"]').trigger('click'); await flushPromises()
    expect(tooltipContent().textContent).toContain('Full Matrix 忽略 Rank')
  })
  it('preserves explicit inline notes while adding Chinese structured help', async () => {
    fixture()
    const Host = defineComponent({ components:{FieldHelp}, setup(){ provideFieldHelp('training'); return {} }, template:'<FieldHelp field="learning_rate" label="LR" note="额外限制说明" />' })
    const w = render(Host)
    await w.get('[role="button"]').trigger('click'); await flushPromises()
    expect(tooltipContent().textContent).toContain('额外限制说明')
  })
})
