import { flushPromises, mount } from '@vue/test-utils'
import { reactive } from 'vue'
import { expect, it, vi } from 'vitest'
const state=vi.hoisted(()=>({store:null as any,api:vi.fn()}))
vi.mock('@/stores/editor',()=>({useEditorStore:()=>state.store}))
vi.mock('@/services/api',()=>({api:state.api,jobUrl:(name:string,suffix='')=>`/api/jobs/${name}${suffix}`}))
import TensorBoardPanel from './TensorBoardPanel.vue'
it('ignores a previous job response after switching jobs',async()=>{
  let resolveFirst!:(v:any)=>void
  state.store=reactive({name:'first'})
  state.api.mockImplementation((url:string)=>url.includes('/first/')?new Promise(resolve=>{resolveFirst=resolve}):Promise.resolve({running:false}))
  const wrapper=mount(TensorBoardPanel)
  state.store.name='second';await flushPromises()
  resolveFirst({running:true,url:'/tensorboard/first/'});await flushPromises()
  expect(wrapper.find('iframe').exists()).toBe(false)
  expect(wrapper.text()).toContain('未运行');wrapper.unmount()
})
