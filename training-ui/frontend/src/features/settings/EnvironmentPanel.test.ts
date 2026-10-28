import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks=vi.hoisted(()=>({api:vi.fn()}))
vi.mock('@/services/api',()=>({api:mocks.api}))
import EnvironmentPanel from './EnvironmentPanel.vue'
beforeEach(()=>{vi.useFakeTimers();mocks.api.mockReset();vi.spyOn(window,'confirm').mockReturnValue(true)})
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks()})
const listing={environments:[{id:'main',label:'主环境',installed:true,path:'/main',status:'ready',versions:{uv:'0.12.18'}},{id:'krea2',label:'Krea 2',installed:false,path:'/krea'}],history:[],busy:false}
it('renders environment cards without any job or model environment',async()=>{
  mocks.api.mockResolvedValue(listing);const w=mount(EnvironmentPanel);await flushPromises()
  expect(w.text()).toContain('主环境');expect(w.text()).toContain('未安装');expect(w.find('pre[aria-label="安装日志"]').text()).toContain('等待')
  w.unmount()
})
it('installation requires confirmation and submits only the allowed CUDA profile',async()=>{
  mocks.api.mockImplementation((url:string)=>Promise.resolve(url.includes('/install')?{id:'task-1',status:'running'}:listing))
  const w=mount(EnvironmentPanel);await flushPromises()
  await w.findAll('button').find(b=>b.text()==='安装环境')!.trigger('click');await flushPromises()
  expect(window.confirm).toHaveBeenCalled();expect(mocks.api).toHaveBeenCalledWith('/api/environments/krea2/install',{method:'POST',body:{cuda:'cu128'}})
  w.unmount()
})
it('reconnects to persisted logs with incremental byte cursor and emits completion',async()=>{
  const task={id:'task-1',status:'completed'}
  mocks.api.mockImplementation((url:string)=>Promise.resolve(url.startsWith('/api/environment-tasks/')?{...task,output:btoa('done'),cursor:4,hasMore:false}:{...listing,task}))
  const w=mount(EnvironmentPanel);await flushPromises()
  expect(w.text()).toContain('done');expect(w.emitted('changed')).toHaveLength(1)
  expect(w.find('a[download]').attributes('href')).toContain('task-1/log')
  w.unmount()
})
it('installation buttons are disabled while training owns environments',async()=>{
  mocks.api.mockResolvedValue({...listing,trainingBusy:true});const w=mount(EnvironmentPanel);await flushPromises()
  expect(w.findAll('button').find(b=>b.text()==='安装环境')!.attributes('disabled')).toBeDefined();w.unmount()
})
it.each([
  [undefined,'待检测'],
  [{status:'missing',distributions:{},error:"No module named 'triton'"},'未安装（可选依赖）'],
  [{status:'importable',version:'3.3.0',distributions:{'triton-windows':'3.3.0.post19'}},'可导入（未验证 GPU 编译）'],
  [{status:'broken',distributions:{triton:'3.3.0'},error:'DLL load failed'},'导入失败'],
])('renders optional Triton probe %j',async(triton,label)=>{
  mocks.api.mockResolvedValue({...listing,environments:[listing.environments[0],{id:'anima-lumina',label:'Anima / Lumina',installed:true,status:'ready',triton}]})
  const w=mount(EnvironmentPanel);await flushPromises()
  const probe=w.find('[aria-label="Triton 检测"]')
  expect(probe.text()).toContain(label)
  expect(w.findAll('[aria-label="Triton 检测"]')).toHaveLength(1)
  if(triton&&'error' in triton)expect(probe.text()).toContain(triton.error)
  if(triton&&'version' in triton)expect(probe.text()).toContain('triton-windows 3.3.0.post19')
  expect(w.text()).toContain('验证通过')
  w.unmount()
})
