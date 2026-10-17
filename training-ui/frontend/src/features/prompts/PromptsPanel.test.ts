import { flushPromises, mount } from '@vue/test-utils'
import { reactive } from 'vue'
import { beforeEach, expect, it, vi } from 'vitest'
const state=vi.hoisted(()=>({store:null as any,api:vi.fn()}))
vi.mock('@/stores/editor',()=>({useEditorStore:()=>state.store}))
vi.mock('@/services/api',()=>({api:state.api,jobUrl:(name:string,suffix='')=>`/api/jobs/${name}${suffix}`}))
vi.mock('@/components/forms/ConfigField.vue',()=>({default:{props:['object','field','label'],template:'<label>{{label}}<input :value="object[field]" @input="object[field]=$event.target.value"/></label>'}}))
import PromptsPanel from './PromptsPanel.vue'
import Field from '@/components/forms/ConfigField.vue'
beforeEach(()=>{localStorage.clear();state.store=reactive({name:'krea-job',architecture:'krea2',config:{},negativePrompt:'',prompts:[{text:'bird',w:1024,h:1024,s:52,l:3.5,d:1}],gpus:[{index:0,name:'GPU'}],running:false,runtimeTick:0,refreshStatus:vi.fn().mockResolvedValue(undefined),save:vi.fn().mockResolvedValue(undefined)});state.api.mockReset().mockImplementation(async(url:string)=>url.endsWith('/checkpoints')?[]:{success:true})})
it('restores legacy GPU strings and sends independent Turbo options after save',async()=>{
  localStorage.setItem('prompt_transient_krea-job',JSON.stringify({gen_gpu_ids:'0,1'}))
  localStorage.setItem('krea2_generation_krea-job',JSON.stringify({base:'turbo',steps:8,cfg:1}))
  const wrapper=mount(PromptsPanel);await flushPromises()
  await wrapper.findAll('button').find(b=>b.text()==='保存并生成')!.trigger('click');await flushPromises()
  expect(state.store.save).toHaveBeenCalledOnce()
  expect(state.store.refreshStatus).toHaveBeenCalledOnce()
  const call=state.api.mock.calls.find(c=>c[0].endsWith('/generate'))!
  expect(call[1].body).toEqual({gen_gpu_ids:'0',krea2_base:'turbo',krea2_steps:8,krea2_cfg:1})
  expect(state.store.prompts[0].s).toBe(52);wrapper.unmount()
})
it('keeps generation disabled while status refresh is pending and reports refresh failure',async()=>{
  let reject!:(reason:Error)=>void
  state.store.refreshStatus.mockImplementation(()=>new Promise((_resolve,r)=>{reject=r}))
  const wrapper=mount(PromptsPanel);await flushPromises()
  const generate=wrapper.findAll('button').find(b=>b.text()==='保存并生成')!
  await generate.trigger('click');await flushPromises()
  expect(generate.attributes('disabled')).toBeDefined();expect(state.store.running).toBe(true)
  reject(Error('offline'));await flushPromises()
  expect(wrapper.text()).toContain('采样已启动，但状态刷新失败：offline')
  expect(generate.attributes('disabled')).toBeDefined();wrapper.unmount()
})
it('reorders cards without changing the prompt content',async()=>{
  state.store.prompts.push({...state.store.prompts[0],text:'forest'})
  const wrapper=mount(PromptsPanel);await flushPromises()
  await wrapper.findAll('button').find(b=>b.text()==='下移')!.trigger('click')
  expect(state.store.prompts.map((p:any)=>p.text)).toEqual(['forest','bird']);wrapper.unmount()
})
it('uses Anima flow shift and the legacy parallel_cfg/sharding generation modes',async()=>{
  state.store.architecture='anima';state.store.config={anima_arguments:{discrete_flow_shift:6.5},training_arguments:{discrete_flow_shift:99}}
  localStorage.setItem('prompt_transient_krea-job',JSON.stringify({gen_gpu_ids:'0,1',gen_multi_gpu_mode:'sharding'}))
  const wrapper=mount(PromptsPanel);await flushPromises()
  await wrapper.findAll('button').find(b=>b.text()==='保存并生成')!.trigger('click');await flushPromises()
  expect(state.api.mock.calls.find(c=>c[0].endsWith('/generate'))![1].body).toMatchObject({flow_shift:6.5,gen_multi_gpu_mode:'sharding',gen_gpu_ids:'0,1'})
  wrapper.unmount()
})
it('does not add sampling defaults on browse; toggles epochs and steps and removes both keys when disabled',async()=>{
  const wrapper=mount(PromptsPanel);await flushPromises()
  expect(state.store.config).toEqual({})
  const enable=wrapper.find('input[type="checkbox"]')
  await enable.setValue(true)
  expect(state.store.config.training_arguments.sample_every_n_epochs).toBe(1)
  await enable.setValue(false)
  expect(state.store.config.training_arguments.sample_every_n_epochs).toBeUndefined()
  state.store.config.training_arguments.max_train_steps=1000
  await enable.setValue(true)
  expect(state.store.config.training_arguments.sample_every_n_steps).toBe(100)
  await enable.setValue(false)
  expect(state.store.config.training_arguments.sample_every_n_steps).toBeUndefined();wrapper.unmount()
})
it('locks Krea sampling during training and prevents TP/SP multi-GPU sampling',async()=>{
  state.store.running=true
  const wrapper=mount(PromptsPanel);await flushPromises()
  expect(wrapper.find('input[type="checkbox"]').attributes('disabled')).toBeDefined()
  state.store.running=false;state.store.architecture='anima';state.store.config={gpu_ids:'0,1',training_arguments:{multigpu_mode:'tp_sp'}}
  await flushPromises()
  expect(wrapper.find('input[type="checkbox"]').attributes('disabled')).toBeDefined()
  expect(wrapper.text()).toContain('TP/SP 多 GPU 训练不支持');wrapper.unmount()
})
it('keeps Flash and Sage generation attention mutually exclusive',async()=>{
  state.store.architecture='anima'
  const wrapper=mount(PromptsPanel);await flushPromises()
  const fields=wrapper.findAllComponents(Field)
  const flash=fields.find(f=>f.props('field')==='flash_attn')!,sage=fields.find(f=>f.props('field')==='sage_attn')!
  flash.props('object').flash_attn=true;flash.vm.$emit('change',true);await flushPromises()
  sage.props('object').sage_attn=true;sage.vm.$emit('change',true);await flushPromises()
  expect(flash.props('object').flash_attn).toBe(false)
  wrapper.unmount()
})
