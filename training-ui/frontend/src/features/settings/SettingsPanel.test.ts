import { flushPromises, mount } from '@vue/test-utils'
import { reactive } from 'vue'
import { beforeEach, expect, it, vi } from 'vitest'
const state=vi.hoisted(()=>({store:null as any,api:vi.fn()}))
vi.mock('@/stores/editor',()=>({useEditorStore:()=>state.store}))
vi.mock('@/services/api',()=>({api:state.api,jobUrl:(name:string,suffix='')=>`/api/jobs/${name}${suffix}`}))
vi.mock('@/components/forms/ConfigField.vue',()=>({default:{props:['object','field','label'],template:'<label>{{label}}<input :value="object[field]" @input="object[field]=$event.target.value"/></label>'}}))
import SettingsPanel from './SettingsPanel.vue'
beforeEach(()=>{state.store=reactive({globalConfig:{},registry:{architectures:{}},saveGlobal:vi.fn().mockResolvedValue(undefined)});state.api.mockReset().mockResolvedValue({installed:true})})
it('can open without a job and leaves absent global sections untouched until editing',async()=>{
  const wrapper=mount(SettingsPanel);await flushPromises()
  expect(state.store.globalConfig).toEqual({})
  const language=wrapper.findAll('label').find(l=>l.text().includes('训练日志语言'))!
  await language.find('input').setValue('en');await flushPromises()
  expect(state.store.globalConfig.ui.log_language).toBe('en')
  expect(state.store.globalConfig.model_paths).toBeUndefined()
  wrapper.unmount()
})
it('saves validated default estimate targets only on explicit save',async()=>{
  const wrapper=mount(SettingsPanel);await flushPromises()
  await wrapper.findAll('button').find(b=>b.text()==='保存全局设置')!.trigger('click');await flushPromises()
  expect(state.store.globalConfig.ui.lbai_targets.length).toBeGreaterThan(0)
  expect(state.store.saveGlobal).toHaveBeenCalledOnce();wrapper.unmount()
})
it('edits the isolated Anima/Lumina environment independently of other backends',async()=>{
  state.store.globalConfig={krea2_venv_path:'krea',moss_venv_path:'moss'}
  const wrapper=mount(SettingsPanel);await flushPromises()
  const environment=wrapper.findAll('label').find(l=>l.text().includes('Anima / Lumina Python 环境'))!
  await environment.find('input').setValue('/env/anima-lumina')
  expect(state.store.globalConfig.anima_lumina_venv_path).toBe('/env/anima-lumina')
  expect(state.store.globalConfig.krea2_venv_path).toBe('krea')
  expect(state.store.globalConfig.moss_venv_path).toBe('moss')
  wrapper.unmount()
})
it('confirms reset, warns about unsaved edits, and reloads the same job only after success',async()=>{
  Object.assign(state.store,{name:'example',dirty:true,running:false,selectJob:vi.fn().mockResolvedValue(undefined)})
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false)
  const wrapper=mount(SettingsPanel);await flushPromises()
  const reset=wrapper.findAll('button').find(b=>b.text()==='恢复模板默认配置')!
  await reset.trigger('click');await flushPromises()
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining('未保存'))
  expect(state.api.mock.calls.some(c=>c[0].endsWith('/reset-config'))).toBe(false)
  confirm.mockReturnValue(true);await reset.trigger('click');await flushPromises()
  expect(state.api).toHaveBeenCalledWith('/api/jobs/example/reset-config',{method:'POST'})
  expect(state.store.selectJob).toHaveBeenCalledWith('example');wrapper.unmount()
})
