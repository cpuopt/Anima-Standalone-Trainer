import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { KeepAlive, defineComponent, h, reactive, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import ArtifactsPanel from './ArtifactsPanel.vue'
let state: any
const mocks = vi.hoisted(()=>({api:vi.fn()}))
vi.mock('@/stores/editor',()=>({useEditorStore:()=>state}))
vi.mock('@/services/api',()=>({api:mocks.api,jobUrl:(name:string,suffix='')=>`/api/jobs/${encodeURIComponent(name)}${suffix}`}))
const passthrough={template:'<div><slot /></div>'}
const global={stubs:Object.fromEntries(['DialogRoot','DialogPortal','DialogOverlay','DialogContent','DialogTitle','DialogDescription','DialogClose'].map(name=>[name,passthrough]))}
const model={name:'model-000003.safetensors',path:'output/model-000003.safetensors',size:1024,mtime:1,version:'1024:1',ready:true,kind:'models',source:'training',label:'Epoch 3'}
const listing=(items:any[])=>({items,total:items.length,pageSize:40,models:1,samples:1,running:false,truncated:false})
beforeEach(()=>{state=reactive({name:'task #1',running:false});mocks.api.mockReset()})
afterEach(()=>{vi.useRealTimers()})
it('renders epoch model links and safely previews header metadata without loading model weights',async()=>{
  mocks.api.mockImplementation((url:string)=>Promise.resolve(url.includes('/preview?')?{metadata:{ss_epoch:'3',comment:'<script>unsafe</script>'},tensorCount:1,tensors:[]}:listing([model])))
  const wrapper=mount(ArtifactsPanel,{global});await flushPromises()
  expect(wrapper.text()).toContain('Epoch 3');expect(wrapper.find('a[download]').attributes('href')).toContain('/api/jobs/task%20%231/artifacts/file?')
  await wrapper.findAll('button').find(b=>b.text()==='预览信息')!.trigger('click');await flushPromises()
  expect(wrapper.find('.artifact-metadata').text()).toContain('<script>unsafe</script>');expect(wrapper.find('.artifact-metadata script').exists()).toBe(false)
  wrapper.unmount()
})
it('shows sample thumbnails, original preview and download links',async()=>{
  vi.useFakeTimers()
  const sample={...model,name:'sample.png',path:'output/sample/sample.png',kind:'samples'}
  mocks.api.mockImplementation((url:string)=>Promise.resolve(listing(url.includes('kind=samples')?[sample]:[model])))
  const wrapper=mount(ArtifactsPanel,{global});await flushPromises()
  await wrapper.findAll('button').find(b=>b.text().startsWith('Sample 图片'))!.trigger('click');await vi.advanceTimersByTimeAsync(250);await flushPromises()
  expect(wrapper.find('.artifact-grid img').attributes('src')).toContain('thumbnail=true')
  await wrapper.find('button[aria-label="预览 sample.png"]').trigger('click');await flushPromises()
  expect(wrapper.find('.artifact-full-image').attributes('src')).not.toContain('thumbnail=true')
  expect(wrapper.find('.artifact-image a').text()).toBe('下载图片');wrapper.unmount()
})
it('ignores stale task responses and never enables download for a writing file',async()=>{
  let finish:any
  mocks.api.mockImplementation((url:string)=>url.includes('task%20%231')?new Promise(resolve=>{finish=resolve}):Promise.resolve(listing([{...model,name:'new.safetensors',path:'output/new.safetensors',ready:false}])))
  const wrapper=mount(ArtifactsPanel,{global});state.name='next';await flushPromises();finish(listing([model]));await flushPromises()
  expect(wrapper.text()).not.toContain('model-000003');expect(wrapper.text()).toContain('new.safetensors');expect(wrapper.find('a[download]').exists()).toBe(false)
  expect(wrapper.findAll('button').find(b=>b.text()==='预览信息')!.attributes('disabled')).toBeDefined();wrapper.unmount()
})
it('polls only while the tab is active and releases timers/requests on unmount',async()=>{
  vi.useFakeTimers();mocks.api.mockResolvedValue(listing([]))
  const wrapper=mount(ArtifactsPanel,{props:{active:false},global});await flushPromises();expect(mocks.api).not.toHaveBeenCalled()
  await wrapper.setProps({active:true});await flushPromises();expect(mocks.api).toHaveBeenCalledTimes(1)
  await wrapper.setProps({active:false});await vi.advanceTimersByTimeAsync(30000);expect(mocks.api).toHaveBeenCalledTimes(1)
  wrapper.unmount();await vi.advanceTimersByTimeAsync(30000);expect(mocks.api).toHaveBeenCalledTimes(1)
})
it('stops polling when KeepAlive deactivates and resumes on reactivation',async()=>{
  vi.useFakeTimers();mocks.api.mockResolvedValue(listing([]))
  const show=ref(true)
  const Host=defineComponent({setup:()=>()=>h(KeepAlive,null,()=>show.value?h(ArtifactsPanel):null)})
  const wrapper=mount(Host,{global});await flushPromises();expect(mocks.api).toHaveBeenCalledTimes(1)
  show.value=false;await flushPromises()
  await vi.advanceTimersByTimeAsync(30000);expect(mocks.api).toHaveBeenCalledTimes(1)
  show.value=true;await flushPromises();expect(mocks.api).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(10000);await flushPromises();expect(mocks.api).toHaveBeenCalledTimes(3)
  wrapper.unmount()
})
it('renders per-model metadata checkboxes and appends strip_metadata only for unchecked fields',async()=>{
  const model2={...model,name:'model-000004.safetensors',path:'output/model-000004.safetensors',label:'Epoch 4'}
  mocks.api.mockImplementation((url:string)=>Promise.resolve(url.includes('/preview?')?{metadata:{ss_epoch:'3'},tensorCount:1,tensors:[]}:listing([model,model2])))
  const wrapper=mount(ArtifactsPanel,{global});await flushPromises()
  const rows=wrapper.findAll('tbody tr')
  expect(rows).toHaveLength(2)
  const row1Checks=rows[0]!.findAll('.artifact-meta-checks input[type="checkbox"]')
  const row2Checks=rows[1]!.findAll('.artifact-meta-checks input[type="checkbox"]')
  expect(row1Checks).toHaveLength(3)
  expect(row2Checks).toHaveLength(3)
  expect(row1Checks.every(c=>(c.element as HTMLInputElement).checked)).toBe(true)
  expect(rows[0]!.find('a[download]').attributes('href')).not.toContain('strip_metadata')

  // Uncheck ss_datasets[*].bucket_info and ss_tag_frequency on model 1 only
  await row1Checks[0]!.setValue(false)
  await row1Checks[2]!.setValue(false)
  const href1=rows[0]!.find('a[download]').attributes('href')!
  const params1=new URLSearchParams(href1.split('?')[1])
  expect(params1.get('strip_metadata')).toBe('ss_datasets[*].bucket_info,ss_tag_frequency')
  expect(rows[1]!.find('a[download]').attributes('href')).not.toContain('strip_metadata')

  // Preview dialog download link also honors model 1's unchecked metadata
  await rows[0]!.findAll('button').find(b=>b.text()==='预览信息')!.trigger('click');await flushPromises()
  const dialogHref=wrapper.find('.artifact-dialog a[download]').attributes('href')!
  expect(new URLSearchParams(dialogHref.split('?')[1]).get('strip_metadata')).toBe('ss_datasets[*].bucket_info,ss_tag_frequency')
  wrapper.unmount()
})
