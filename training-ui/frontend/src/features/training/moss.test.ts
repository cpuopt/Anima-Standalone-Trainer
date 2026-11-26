import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, it, vi } from 'vitest'
import { useEditorStore } from '@/stores/editor'
import { Moss } from '@/domain/training'
import TrainingPanel from './TrainingPanel.vue'
import NetworkPanel from '../network/NetworkPanel.vue'
import DatasetPanel from '../dataset/DatasetPanel.vue'
import MultiGpuPanel from '../multi-gpu/MultiGpuPanel.vue'
import Field from '@/components/forms/ConfigField.vue'
import { serializePrompt, parsePromptLine } from '../prompts/model'
vi.mock('@/services/api',()=>({api:vi.fn(async()=>({count:1,exists:true,readable:true})),jobUrl:(name:string,suffix='')=>`/api/jobs/${name}${suffix}`}))
beforeEach(()=>{setActivePinia(createPinia());localStorage.clear()})
function fixture(){const s=useEditorStore();s.name='moss';s.architecture='moss_image';s.config=Moss.defaults();s.dataset=Moss.datasetDefaults();return s}
it('MOSS controls edit only its own config; no FP8, full-finetune, Anima layers or estimate',async()=>{
  const s=fixture();const w=mount(TrainingPanel)
  expect(w.text()).toContain('MOSS-Image');expect(w.text()).not.toContain('Dynamic Scaled FP8')
  const quant=w.findAllComponents(Field).find(x=>x.props('field')==='convrot_int8')!
  await quant.find('input').setValue(true);expect(s.config.moss_arguments.convrot_int8).toBe(true)
  expect(s.config.anima_arguments).toBeUndefined();Moss.validate(s.config);w.unmount()
  const n=mount(NetworkPanel);expect(n.text()).not.toContain('Full Finetune');expect(n.text()).not.toContain('样例层矩阵')
  const module=n.findAll('select').find(x=>x.findAll('option').some(o=>o.element.value==='networks.lora_generic'))!
  s.config.network_arguments.network_args=['loraplus_lr_ratio=2']
  await module.setValue('networks.loha');expect(s.config.network_arguments.network_args).toEqual([])
  await module.setValue('networks.lokr')
  await n.findAllComponents(Field).find(x=>x.props('label')==='LoKR Factor')!.find('input').setValue('3')
  await n.findAllComponents(Field).find(x=>x.props('label')==='Full Matrix')!.find('input').setValue(true)
  expect(s.config.network_arguments.network_args).toEqual(['factor=3','full_matrix=true']);Moss.validate(s.config);n.unmount()
})
it('MOSS dataset and hardware edits do not inject Anima-only fields',async()=>{
  const s=fixture();s.gpus=[{index:0,name:'first'},{index:1,name:'second'}]
  const ds=mount(DatasetPanel);expect(ds.text()).not.toContain('LBAI');expect(ds.text()).not.toContain('Progressive')
  await ds.findAll('button').find(b=>b.text()==='添加子集')!.trigger('click');Moss.validateDataset(s.dataset);ds.unmount()
  const hw=mount(MultiGpuPanel);await hw.findAll('.gpu-card input')[1]!.setValue(true);expect(s.config.gpu_ids).toBe('1');expect(s.config.training_arguments.multigpu_mode).toBeUndefined();hw.unmount()
})
it('MOSS compile controls edit, validate and preserve settings when disabled',async()=>{
  const s=fixture();const w=mount(TrainingPanel)
  const control=(key:string)=>w.findAllComponents(Field).find(x=>x.props('field')===key)!
  expect(control('compile_mode')).toBeUndefined()
  await control('compile').find('input').setValue(true)
  await control('compile_mode').find('select').setValue('max-autotune-no-cudagraphs')
  await control('compile_dynamic').find('select').setValue('false')
  await control('compile_cache_size_limit').find('input').setValue('64')
  await control('compile_fullgraph').find('input').setValue(true)
  await control('cuda_allow_tf32').find('input').setValue(true)
  expect(s.config.training_arguments).toMatchObject({compile:true,compile_mode:'max-autotune-no-cudagraphs',compile_dynamic:'false',compile_cache_size_limit:64,compile_fullgraph:true,cuda_allow_tf32:true})
  Moss.validate(s.config)
  await control('compile').find('input').setValue(false)
  expect(control('compile_mode')).toBeUndefined()
  expect(s.config.training_arguments.compile_mode).toBe('max-autotune-no-cudagraphs')
  s.running=true;await flushPromises();expect(w.find('fieldset').attributes()).toHaveProperty('disabled')
  w.unmount()
})
it('MOSS prompt serialization preserves seed 0 and explicit empty negative without Anima flags',()=>{
  const p=parsePromptLine('fox --w 512 --h 768 --s 3 --l 0 --d 0 --n')
  const text=serializePrompt(p,'moss_image','do not replace explicit empty')
  expect(text).toContain('--d 0');expect(text).toContain('--l 0');expect(text).not.toContain('--ss');expect(text).not.toContain('do not replace');expect(text).not.toContain('--n')
})
