import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const state=vi.hoisted(()=>({api:vi.fn()}))
vi.mock('@/services/api',()=>({api:state.api}))
import PerformancePanel from './PerformancePanel.vue'
beforeEach(()=>{vi.useFakeTimers();state.api.mockReset().mockResolvedValue({task:null,busy:false,blocked:false})})
afterEach(()=>{vi.useRealTimers()})
it('starts the chosen matrix suite in a model environment and can stop',async()=>{
  const wrapper=mount(PerformancePanel);await flushPromises()
  expect((wrapper.findAll('input')[1].element as HTMLInputElement).value).toBe('5')
  await wrapper.findAll('select')[0].setValue('krea2');await wrapper.find('input').setValue(1)
  await wrapper.findAll('input')[1].setValue(10)
  state.api.mockResolvedValue({status:'running',sizes:[2048,4096,8192],results:[]})
  await wrapper.findAll('button').find(b=>b.text()==='开始性能测试')!.trigger('click');await flushPromises()
  expect(state.api).toHaveBeenCalledWith('/api/benchmarks/tensor',{method:'POST',body:{environment:'krea2',gpu:1,sizes:[2048,4096,8192],repeats:10}})
  expect(wrapper.text()).toContain('0 / 18')
  await wrapper.findAll('button').find(b=>b.text()==='停止测试')!.trigger('click');await flushPromises()
  expect(state.api).toHaveBeenCalledWith('/api/benchmarks/tensor/stop',{method:'POST'})
  wrapper.unmount()
})
it('rejects empty, fractional and out-of-range round counts',async()=>{
  const wrapper=mount(PerformancePanel);await flushPromises()
  const input=wrapper.findAll('input')[1]
  for(const value of ['',0,51,1.5]){
    await input.setValue(value)
    expect(wrapper.findAll('button').find(b=>b.text()==='开始性能测试')!.attributes('disabled')).toBeDefined()
    expect(wrapper.find('[role="alert"]').text()).toContain('1–50')
  }
  await input.setValue(5)
  expect(wrapper.findAll('button').find(b=>b.text()==='开始性能测试')!.attributes('disabled')).toBeUndefined()
  wrapper.unmount()
})
it('restores progress, renders unsupported reasons and cancels polling on unmount',async()=>{
  state.api.mockResolvedValue({busy:true,blocked:false,task:{status:'running',sizes:[4096],results:[{mode:'bf16',size:4096,status:'skipped',reason:'不支持原生 BF16'}]}})
  const wrapper=mount(PerformancePanel);await flushPromises()
  expect(wrapper.text()).toContain('不支持原生 BF16');expect(wrapper.text()).toContain('1 / 6')
  expect(wrapper.findAll('button').find(b=>b.text()==='开始性能测试')!.attributes('disabled')).toBeDefined()
  wrapper.unmount();const calls=state.api.mock.calls.length
  await vi.advanceTimersByTimeAsync(3000);expect(state.api).toHaveBeenCalledTimes(calls)
})
it('renders FP8 TFLOPS and integer TOPS in their respective result rows',async()=>{
  state.api.mockResolvedValue({busy:false,blocked:false,task:{status:'completed',sizes:[2048],modes:['bf16','fp16','tf32','fp32','fp8','int8'],results:[
    {mode:'fp8',size:2048,status:'completed',throughput:123.45,unit:'TFLOPS',mean_ms:0.2},
    {mode:'int8',size:2048,status:'completed',throughput:234.56,unit:'TOPS',mean_ms:0.1},
  ]}})
  const wrapper=mount(PerformancePanel);await flushPromises()
  const rows=wrapper.findAll('tbody tr')
  expect(rows[0].text()).toContain('FP8 E4M3');expect(rows[0].text()).toContain('123.45 TFLOPS')
  expect(rows[1].text()).toContain('234.56 TOPS');expect(rows[1].text()).not.toContain('TFLOPS')
  wrapper.unmount()
})
it('shows launch failures and blocks starts while training is busy',async()=>{
  const wrapper=mount(PerformancePanel);await flushPromises();state.api.mockRejectedValue(Error('模型环境未安装'))
  await wrapper.find('button').trigger('click');await flushPromises()
  expect(wrapper.find('[role="alert"]').text()).toContain('模型环境未安装')
  state.api.mockResolvedValue({busy:false,blocked:true,task:null});await vi.advanceTimersByTimeAsync(1500)
  expect(wrapper.find('button').attributes('disabled')).toBeDefined();wrapper.unmount()
})
