// Test actual Vue components using intercepted API responses; never starts real training or TensorBoard.
const {chromium}=require('C:/Program Files/WindowsApps/OpenAI.CodexPrimaryRuntime.v26-1112-737-0_26.1112.737.0_x64__3k8sg7r9htsxt/dependencies/node/node_modules/playwright');
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[],calls=[];
 page.on('pageerror',e=>errors.push(e.message));
 let running=false,failStop=false,frameLoads=0,theme='github-dark';
 const job='style_neco',base='/api/jobs/'+job;
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()).pathname;calls.push([req.method(),url]);
  let result=[];
  if(url==='/api/jobs')result=[{name:job,architecture:'anima',running:true}];
  else if(url==='/api/global-config')result={ui:{theme}};
  else if(url==='/api/architectures')result={anima:{label:'Anima'}};
  else if(url===base)result={name:job,architecture:'anima',config:{},dataset:{}};
  else if(url===base+'/prompts')result={prompts:[]};
  else if(url===base+'/train/status')result={running:true};
  else if(url===base+'/tensorboard/status')result={running,url:running?'/tensorboard/native-fixture/':undefined};
  else if(url===base+'/tensorboard'){running=true;result={url:'/tensorboard/native-fixture/'};}
  else if(url===base+'/tensorboard/stop'){
   if(failStop)return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'测试：服务停止失败'})});
   running=false;result={success:true};
  }
  return route.fulfill({contentType:'application/json',body:JSON.stringify(result)});
 });
 await page.route('**/tensorboard/native-fixture/**',route=>{
  frameLoads++;
  return route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><title>Native iframe fixture</title></head><body><h1>TensorBoard iframe 测试页面</h1><p>仅用于验证原生嵌入；不包含真实训练数据。</p><input aria-label="内嵌页面状态" value="保持筛选状态"></body></html>'});
 });
 await page.addInitScript(()=>{localStorage.setItem('lastJob','style_neco');localStorage.setItem('lastTab','tensorboard')});
 const folder=path.join(__dirname,'screenshots/implementation');fs.mkdirSync(folder,{recursive:true});
 await page.goto('http://127.0.0.1:5175/ui/');await page.waitForSelector('.tb-empty');
 await page.getByRole('button',{name:'启动 TensorBoard',exact:true}).waitFor({state:'visible'});
 await page.screenshot({path:path.join(folder,process.argv.includes('--final')?'desktop-empty.png':'desktop-empty-before.png'),fullPage:true});
 await page.getByRole('button',{name:'启动 TensorBoard',exact:true}).click();await page.waitForSelector('.tb-frame');
 const native=page.frameLocator('.tb-frame');await native.getByRole('textbox').fill('native filter preserved');
 const count=frameLoads;
 const width=await page.locator('.tb-frame').evaluate(el=>el.clientWidth);
 await page.getByRole('button',{name:'收起辅助栏',exact:true}).click();
 assert(await page.locator('#tb-assistance').isHidden());
 assert((await page.locator('.tb-frame').evaluate(el=>el.clientWidth))>width);
 assert.equal(frameLoads,count);assert.equal(await native.getByRole('textbox').inputValue(),'native filter preserved');
 await page.getByRole('button',{name:'刷新状态',exact:true}).filter({visible:true}).click();
 assert.equal(frameLoads,count);
 await page.getByRole('button',{name:'展开辅助栏',exact:true}).click();assert(await page.locator('#tb-assistance').isVisible());
 assert.equal(await native.getByRole('textbox').inputValue(),'native filter preserved');
 assert.equal(await native.locator('style,script,link[rel=stylesheet]').count(),0,'Parent must not inject content into iframe');
 await page.getByRole('button',{name:'重新加载页面',exact:true}).click();await native.getByRole('textbox').waitFor();
 assert(frameLoads>count);assert.equal(await native.getByRole('textbox').inputValue(),'保持筛选状态');
 failStop=true;await page.getByRole('button',{name:'停止服务',exact:true}).filter({visible:true}).click();
 await page.getByRole('alert').filter({hasText:'服务停止失败'}).waitFor();assert(await page.locator('.tb-frame').isVisible());
 failStop=false;await page.getByRole('button',{name:'停止服务',exact:true}).filter({visible:true}).click();await page.waitForSelector('.tb-empty');
 const checks=[];
 for(const [width,height] of [[1600,1000],[1920,1080],[1280,800],[375,812]]){
  await page.setViewportSize({width,height});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Overflow '+width);
  await page.screenshot({path:path.join(folder,`${width}-empty.png`),fullPage:true});checks.push({width,height,overflow:false});
 }
 await page.setViewportSize({width:1600,height:1000});
 await page.evaluate(()=>{document.documentElement.classList.remove('dark');document.documentElement.dataset.theme='github-light'});
 await page.waitForTimeout(250);
 await page.screenshot({path:path.join(folder,'light-empty.png'),fullPage:true});
 assert.equal(errors.length,0,errors.join('\n'));
 assert(calls.filter(([method])=>method==='POST').every(([,url])=>url===base+'/tensorboard'||url===base+'/tensorboard/stop'));
 fs.writeFileSync(path.join(folder,'verification.json'),JSON.stringify({checks,errors,frameLoads,passed:['collapse preserves native state','status does not reload iframe','explicit reload','failed stop retains iframe','stop does not affect training','no injected iframe scripts or styles'],fixture:true},null,2));
 await browser.close();console.log('PASS: actual Vue TensorBoard outer UI, responsive layouts, iframe preservation, reload, start/stop/error, no iframe injection.');
})().catch(e=>{console.error(e);process.exit(1)});
