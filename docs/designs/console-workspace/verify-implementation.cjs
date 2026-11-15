// Actual Vue UI, with isolated API/WebSocket fixtures. No real job mutations.
const {chromium}=require('C:/Program Files/WindowsApps/OpenAI.CodexPrimaryRuntime.v26-1112-737-0_26.1112.737.0_x64__3k8sg7r9htsxt/dependencies/node/node_modules/playwright');
const fs=require('fs'),path=require('path'),assert=require('assert');
(async()=>{
 const b=await chromium.launch({channel:'msedge',headless:true});const p=await b.newPage({viewport:{width:1440,height:900}});
 const folder=path.join(__dirname,'screenshots/implementation');fs.mkdirSync(folder,{recursive:true});
 const errors=[];p.on('pageerror',e=>errors.push(e.message));const sockets=[];
 const job='console-view',base='/api/jobs/'+job;let running=true;
 let hardware={cpu:22,cpuTemp:58,ram:{used:26.4*2**30,total:64*2**30},gpus:[{index:0,name:'CUDA Device',util:82,memUsed:17203,memTotal:24576,temp:67,powerDraw:238,powerLimit:320,activity:'训练'}],memoryProcesses:[{jobName:job,pid:18420,device:'cuda:0',stage:'train.before_epoch',ageMs:23000,allocated_bytes:13.4*2**30,reserved_bytes:15.1*2**30,cached_unused_bytes:1.7*2**30,peak_allocated_bytes:14*2**30,windows:{shared_bytes:0,dedicated_bytes:16.8*2**30},contents:{dit:{'cuda:0':3.9*2**30},network:{'cuda:0':.1*2**30},gradients:{'cuda:0':1.8*2**30},optimizer:{'cuda:0':4.3*2**30},qwen3:{cpu:1.1*2**30},vae:{cpu:.3*2**30}}}]};
 const initial=['13:00:00 INFO Starting Anima training','13:00:01 INFO Qwen3 loaded on CPU','13:00:02 INFO Anima DiT loaded on cuda:0',...Array.from({length:1700},(_,i)=>`13:00:03 INFO steps: ${i}/2000 | loss=0.0843 | lr=1e-4`),'13:01:00 INFO checkpoint saved','13:01:01 WARNING snapshot waiting for update','13:01:02 ERROR validation failed','  File train.py, line 1','ValueError: bad value'].join('\n');
 await p.route('**/api/**',route=>{
  assert.equal(route.request().method(),'GET');const url=new URL(route.request().url()).pathname;
  const data=url==='/api/jobs'?[{name:job,architecture:'anima'}]:url==='/api/global-config'?{ui:{theme:'github-light'}}:url==='/api/architectures'?{anima:{label:'Anima'}}:url===base?{name:job,architecture:'anima',config:{},dataset:{}}:url===base+'/prompts'?{prompts:[]}:url.endsWith('/train/status')?{running}:[];
  return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
 });
 await p.routeWebSocket('**',socket=>{sockets.push(socket);socket.onMessage(text=>{if(JSON.parse(String(text)).type==='subscribe'){socket.send(JSON.stringify({type:'hw_stats',data:hardware}));socket.send(JSON.stringify({type:'log',job,data:initial}))}})});
 await p.addInitScript(()=>{localStorage.setItem('lastJob','console-view');localStorage.setItem('lastTab','console')});
 await p.goto('http://127.0.0.1:5173/ui/');await p.waitForSelector('.console-log-line');await p.waitForFunction(()=>document.querySelectorAll('.console-gpu').length===1);
 await p.waitForTimeout(100);assert.equal(await p.locator('.console-log-line').count(),1500);
 await p.screenshot({path:path.join(folder,'1440-console.png')});
 await p.getByRole('button',{name:'错误',exact:true}).click();assert((await p.locator('.console-log-output').textContent()).includes('File train.py'));assert.equal(await p.locator('.console-log-line').count(),3);
 await p.getByRole('button',{name:'全部',exact:true}).click();await p.getByRole('searchbox',{name:'搜索日志'}).fill('checkpoint saved');assert.equal(await p.locator('.console-log-line').count(),1);await p.getByRole('searchbox',{name:'搜索日志'}).fill('');
 const exportEvent=p.waitForEvent('download');await p.getByRole('button',{name:'导出',exact:true}).click();const download=await exportEvent;const raw=fs.readFileSync(await download.path(),'utf8');assert(raw.includes('Starting Anima training'));assert(raw.includes('ValueError: bad value'));
 const follow=p.locator('.console-log-options label').filter({hasText:'自动跟随'}).locator('input');await follow.uncheck();const first=await p.locator('.console-log-line').first().textContent();sockets.forEach(s=>s.send(JSON.stringify({type:'log',job,data:'\n13:02:00 INFO NEWEST_OUTPUT'})));await p.waitForTimeout(60);assert.equal(await p.locator('.console-log-line').first().textContent(),first);assert(!(await p.locator('.console-log-output').textContent()).includes('NEWEST_OUTPUT'));
 await p.getByRole('button',{name:'回到最新',exact:true}).click();assert((await p.locator('.console-log-output').textContent()).includes('NEWEST_OUTPUT'));
 await p.locator('.console-event-list button').filter({hasText:'checkpoint saved'}).click();assert((await p.locator('.console-log-line.highlighted').textContent()).includes('checkpoint saved'));
 await p.getByRole('button',{name:'收起硬件监控',exact:true}).click();assert(await p.locator('.console-hardware').isHidden());await p.getByRole('button',{name:'展开硬件监控',exact:true}).click();assert(await p.locator('.console-hardware').isVisible());
 const placements=hardware.memoryProcesses;
 for(const [label,width,height]of[['wide',1920,1080],['tablet',1024,768],['landscape',844,390],['phone',390,844],['small-phone',375,812]]){
  await p.setViewportSize({width,height});await p.locator('.console-workbench').scrollIntoViewIfNeeded();await p.waitForTimeout(50);
  assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`horizontal overflow ${label}`);
  if(width>680){const left=await p.locator('.console-hardware').boundingBox(),right=await p.locator('.console-log-panel').boundingBox();assert(left.width<=322);assert(right.width>left.width)}
  await p.screenshot({path:path.join(folder,`${label}-console.png`)});
  if(width<=680){await p.getByRole('button',{name:'资源与显存明细',exact:true}).click();assert(await p.getByRole('dialog').isVisible());assert((await p.getByRole('dialog').textContent()).includes('DiT 主模型'));assert.equal(await p.evaluate(()=>document.body.style.overflow),'hidden');await p.screenshot({path:path.join(folder,`${label}-resources.png`)});await p.keyboard.press('Escape');assert.equal(await p.getByRole('dialog').count(),0);assert.notEqual(await p.evaluate(()=>document.body.style.overflow),'hidden')}
 }
 await p.setViewportSize({width:1440,height:900});await p.locator('.console-workbench').scrollIntoViewIfNeeded();
 hardware={...hardware,memoryProcesses:[]};sockets.forEach(s=>s.send(JSON.stringify({type:'hw_stats',data:hardware})));await p.waitForTimeout(50);assert.equal(await p.locator('.console-process').count(),0);assert((await p.locator('.console-memory').textContent()).includes('等待训练进程上报'));await p.screenshot({path:path.join(folder,'no-snapshot.png')});
 hardware={...hardware,memoryProcesses:placements,gpus:[...hardware.gpus,{...hardware.gpus[0],index:1,util:4,memUsed:1229,activity:null}]};sockets.forEach(s=>s.send(JSON.stringify({type:'hw_stats',data:hardware})));await p.waitForTimeout(50);assert.equal(await p.locator('.console-gpu').count(),2);await p.screenshot({path:path.join(folder,'two-gpus.png')});
 assert(await p.getByRole('checkbox',{name:'显存分配详细记录'}).isDisabled());running=false;sockets.forEach(s=>s.send(JSON.stringify({type:'status',job,data:'idle'})));await p.waitForTimeout(150);assert(await p.getByRole('checkbox',{name:'显存分配详细记录'}).isEnabled());
 assert.equal(errors.length,0,errors.join('\n'));fs.writeFileSync(path.join(folder,'verification.json'),JSON.stringify({passed:true,errors,checks:['1500-row display bound','all log export','search/severity/multiline error','paused window/live append','event jump','hardware collapse','narrow monitor/flexible logs','5 responsive sizes','mobile dialog/scroll restoration','empty snapshot','two GPUs','recording runtime lock']},null,2));await b.close();console.log('PASS: actual Vue console layout, log interactions, multi-GPU/memory states, desktop and mobile.');
})().catch(e=>{console.error(e);process.exit(1)});
