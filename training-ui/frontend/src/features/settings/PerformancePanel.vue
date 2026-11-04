<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { api } from '@/services/api'
const environment=ref('anima-lumina'), gpu=ref(0), size=ref('all'), task=ref<any>(null)
const repeats=ref<number|string>(5)
const validRepeats=computed(()=>typeof repeats.value==='number'&&Number.isInteger(repeats.value)&&repeats.value>=1&&repeats.value<=50)
const busy=ref(false), blocked=ref(false), pending=ref(false), error=ref('')
const labels:Record<string,string>={running:'测试中',stopping:'停止中',stopped:'已停止',completed:'已完成',failed:'失败',skipped:'不支持 / 已跳过'}
let timer:ReturnType<typeof setTimeout>|undefined, disposed=false
const controller=new AbortController()
async function poll(){
  try{const r=await api('/api/benchmarks/tensor',{signal:controller.signal});if(disposed)return;task.value=r.task;busy.value=r.busy;blocked.value=r.blocked}
  catch(e:any){if(!disposed)error.value=e.message}
  finally{if(!disposed)timer=setTimeout(poll,1500)}
}
async function start(){
  if(!validRepeats.value){error.value='测试轮数必须为 1–50 的整数';return}
  pending.value=true;error.value=''
  try{task.value=await api('/api/benchmarks/tensor',{method:'POST',body:{environment:environment.value,gpu:Number(gpu.value),sizes:size.value==='all'?[2048,4096,8192]:[Number(size.value)],repeats:repeats.value}});busy.value=true}
  catch(e:any){error.value=e.message}finally{pending.value=false}
}
async function stop(){pending.value=true;try{task.value=await api('/api/benchmarks/tensor/stop',{method:'POST'})}catch(e:any){error.value=e.message}finally{pending.value=false}}
function download(){const url=URL.createObjectURL(new Blob([JSON.stringify(task.value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='tensor-benchmark.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function number(value:any){return typeof value==='number'?value.toFixed(2):'—'}
onMounted(poll);onBeforeUnmount(()=>{disposed=true;controller.abort();clearTimeout(timer)})
</script>
<template>
  <section class="rounded-lg border p-4 space-y-4" aria-label="性能测试">
    <h3 class="font-semibold">性能测试 · GPU 张量计算</h3>
    <p class="text-sm text-muted-foreground">PyTorch / cuBLAS 稠密 GEMM，覆盖 BF16、FP16、TF32、FP32（IEEE 基线）、FP8 与 INT8。预热 10 次，CUDA Event 计时，多轮耗时取算术平均；吞吐量 = 2 × N³ / 平均秒数 / 10¹²，浮点使用 TFLOPS，INT8 使用 TOPS，同时保留中位数。每轮自适应 5–200 次，不包含分配和数据传输。</p>
    <p class="text-xs text-muted-foreground">FP8：E4M3 输入、BF16 输出、逐张量缩放系数为 1，关闭快速累加；INT8：INT8 输入、INT32 累加及输出。均测试预先准备数据的原生矩阵乘法，不包含量化、类型转换和反量化。FP8 需要 SM 8.9 或更新 GPU；接口或内核不可用时显示跳过原因。</p>
    <p class="text-xs text-muted-foreground">使用已安装模型环境，不额外安装依赖。测试会持续占用 GPU，请先停止训练、采样并卸载驻留模型。结果受矩阵规模、功耗、温度及其他程序影响；为非稀疏实测值，不代表完整训练速度或厂商峰值。Tensor Core 内核由 cuBLAS 选择，未通过 profiler 核实。</p>
    <div class="flex flex-wrap gap-3 items-end">
      <label class="text-sm">模型环境<select v-model="environment" class="block rounded border p-2" :disabled="busy||pending"><option value="anima-lumina">Anima / Lumina</option><option value="krea2">Krea 2</option><option value="moss">MOSS-Image</option></select></label>
      <label class="text-sm">GPU 编号（CUDA 逻辑编号）<input v-model.number="gpu" type="number" min="0" max="63" class="block rounded border p-2 w-44" :disabled="busy||pending"/></label>
      <label class="text-sm">矩阵规模 N<select v-model="size" class="block rounded border p-2" :disabled="busy||pending"><option value="all">2048 / 4096 / 8192</option><option v-for="n in [2048,4096,8192]" :key="n" :value="String(n)">{{n}} × {{n}}</option></select></label>
      <label class="text-sm">测试轮数<input v-model.number="repeats" aria-describedby="benchmark-rounds-help" type="number" min="1" max="50" step="1" class="block rounded border p-2 w-28" :disabled="busy||pending"/></label>
      <button class="btn bg-primary text-primary-foreground" :disabled="busy||pending||blocked||!validRepeats" @click="start">开始性能测试</button>
      <button v-if="busy" class="btn" :disabled="pending||task?.status==='stopping'" @click="stop">停止测试</button>
      <button v-if="task" class="btn" @click="download">导出 JSON</button>
    </div>
    <p id="benchmark-rounds-help" class="text-xs text-muted-foreground">默认 5 轮，每种精度与矩阵规模分别取平均。可输入 1–50 的整数；需要更稳定的比较可设为 10 轮，耗时随轮数增加。</p>
    <p v-if="!validRepeats" role="alert" class="text-destructive text-sm">测试轮数必须为 1–50 的整数</p>
    <p v-if="blocked" class="text-sm">训练、采样或环境操作正在运行，暂时无法开始测试。</p>
    <p v-if="error||task?.error" role="alert" class="text-destructive whitespace-pre-wrap">{{error||task?.error}}</p>
    <p v-if="task" role="status" class="text-sm">{{labels[task.status]||task.status}} · {{task.results?.length||0}} / {{(task.sizes?.length||0)*(task.modes?.length||6)}} 项 · 每项 {{task.repeats||5}} 轮<span v-if="task.progress"> · {{task.progress.mode.toUpperCase()}} / N={{task.progress.size}}<span v-if="task.progress.round"> · 第 {{task.progress.round}} / {{task.progress.repeats}} 轮</span></span></p>
    <p v-if="task?.metadata" class="text-sm">{{task.metadata.gpu}} · {{number(task.metadata.vram_bytes/1024**3)}} GiB · SM {{task.metadata.capability.join('.')}} · PyTorch {{task.metadata.torch}} · CUDA {{task.metadata.cuda}} · Python {{task.metadata.python}}</p>
    <div v-if="task?.results?.length" class="overflow-x-auto">
      <table class="w-full text-sm text-left">
        <caption class="text-left text-xs text-muted-foreground pb-2">{{task.started}} · {{task.environment}} · GPU {{task.gpu}} · 每项 {{task.repeats||5}} 轮 · 方阵 A × B = C（各 N × N）</caption>
        <thead><tr><th class="p-2">精度</th><th class="p-2">N</th><th class="p-2">吞吐量（平均耗时）</th><th class="p-2">平均耗时 ms</th><th class="p-2">中位耗时 ms</th><th class="p-2">范围 ms</th><th class="p-2">轮数 × 每轮次数</th><th class="p-2">状态 / 原因</th></tr></thead>
        <tbody><tr v-for="r in task.results" :key="`${r.mode}-${r.size}`" class="border-t">
          <td class="p-2">{{r.mode==='fp8'?'FP8 E4M3':r.mode.toUpperCase()}}</td><td class="p-2">{{r.size}}</td><td class="p-2 font-semibold">{{number(r.throughput??r.tops??r.tflops)}} <span v-if="r.status==='completed'">{{r.unit||(r.mode==='int8'?'TOPS':'TFLOPS')}}</span></td><td class="p-2">{{number(r.mean_ms)}}</td><td class="p-2">{{number(r.median_ms)}}</td><td class="p-2">{{number(r.min_ms)}} – {{number(r.max_ms)}}</td><td class="p-2">{{r.repeats||'—'}} × {{r.iterations||'—'}}</td><td class="p-2 break-words">{{labels[r.status]||r.status}}<span v-if="r.reason">：{{r.reason}}</span></td>
        </tr></tbody>
      </table>
    </div>
  </section>
</template>
