import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { useEditorStore } from '@/stores/editor'
import { Moss } from '@/domain/legacy'
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
it('MOSS prompt serialization preserves seed 0 and explicit empty negative without Anima flags',()=>{
  const p=parsePromptLine('fox --w 512 --h 768 --s 3 --l 0 --d 0 --n')
  const text=serializePrompt(p,'moss_image','do not replace explicit empty')
  expect(text).toContain('--d 0');expect(text).toContain('--l 0');expect(text).not.toContain('--ss');expect(text).not.toContain('do not replace');expect(text).not.toContain('--n')
})
it('legacy MOSS forms preserve loaded configuration, adapter options and dataset snapshots',async()=>{
  const html=readFileSync(resolve('../public/index.html'),'utf8').replace(/<script[\s\S]*?<\/script>/g,'')
  document.body.innerHTML=html
  const src=readFileSync(resolve('../public/js/moss-ui.js'),'utf8')
  const ui=new Function('Moss',src+';return MossUI;')(Moss)
  const config=Moss.defaults();config.network_arguments.network_module='networks.lokr';config.network_arguments.network_args=['factor=3','full_matrix=true']
  ui.populate(config);ui.setDataset(Moss.datasetDefaults());(document.getElementById('cfg-enable-sampling') as HTMLInputElement).checked=false
  expect(ui.config()).toEqual(config);expect(ui.datasetValue()).toEqual(Moss.datasetDefaults())
  const factor=[...document.querySelectorAll('.moss-panel input')].find(x=>x.id.startsWith('moss-factor-')) as HTMLInputElement
  factor.value='16';factor.dispatchEvent(new Event('input'));factor.dispatchEvent(new Event('change'))
  expect(ui.config().network_arguments.network_args).toContain('factor=16');Moss.validate(ui.config())
  ui.populate({architecture:'anima'});expect(document.body.classList.contains('moss-mode')).toBe(false);document.body.innerHTML='';await flushPromises()
})
