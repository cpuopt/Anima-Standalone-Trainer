// Exercise the actual Vue app with isolated read-only fixture responses.
const {chromium}=require('C:/Program Files/WindowsApps/OpenAI.CodexPrimaryRuntime.v26-1112-737-0_26.1112.737.0_x64__3k8sg7r9htsxt/dependencies/node/node_modules/playwright');
const fs=require('fs');const path=require('path');const assert=require('assert');
(async()=>{
 const assets=JSON.parse(fs.readFileSync(path.join(__dirname,'design-demos/dir-1.html'),'utf8').match(/const ASSETS=([\s\S]*?);\s*const MODE=/)[1]);
 const job='sample-view',base='/api/jobs/'+job;
 const records=Array.from({length:36},(_,i)=>{const name=`preview_e${String(Math.floor(i/6)+1).padStart(6,'0')}_${String(i%3).padStart(2,'0')}_20261115120000_${i}.png`;return {name,path:base+'/samples/'+name,mtime:i}});
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url()).pathname;
  assert.equal(route.request().method(),'GET','UI verification must not mutate backend data');
  if(url.startsWith(base+'/samples/')){const i=records.findIndex(r=>r.path===url);const a=assets[[0,1,2,0,1,3][i%6]];return route.fulfill({contentType:'image/jpeg',body:Buffer.from(a.src.split(',')[1],'base64')})}
  const payload=url==='/api/jobs'?[{name:job,architecture:'anima'}]:url==='/api/global-config'?{ui:{theme:'github-dark'}}:url==='/api/architectures'?{anima:{label:'Anima'}}:url===base?{name:job,architecture:'anima',config:{},dataset:{}}:url===base+'/prompts'?{prompts:[]}:url===base+'/samples'?records:url.includes('/metadata/')?{parameters:'Test fixture: actual metadata endpoint\n'+('prompt: character study, clean background\n'.repeat(45))}:url.endsWith('/train/status')?{running:false}:[];
  return route.fulfill({contentType:'application/json',body:JSON.stringify(payload)});
 });
 await page.addInitScript(()=>{localStorage.setItem('lastJob','sample-view');localStorage.setItem('lastTab','samples')});
 await page.goto('http://127.0.0.1:5173/ui/');await page.waitForSelector('.sample-card');
 const folder=path.join(__dirname,'screenshots/implementation');fs.mkdirSync(folder,{recursive:true});
 const checks=[];
 for(const [width,height] of [[1440,900],[844,390],[1920,1080],[2560,1080],[390,844]]){
  await page.setViewportSize({width,height});
  await page.locator('.sample-filters button').first().click();await page.screenshot({path:path.join(folder,`${width}-all.png`)});
  for(const prompt of [1,2,3]){
   await page.locator('.sample-filters button').filter({hasText:`Prompt ${prompt}`}).click();
   await page.waitForFunction(()=>[...document.querySelectorAll('.sample-card img')].every(i=>i.complete));
   const bounds=await page.evaluate(()=>{const grid=document.querySelector('.sample-grid').getBoundingClientRect(),cards=[...document.querySelectorAll('.sample-card')].map(el=>el.getBoundingClientRect());return{left:Math.round(Math.min(...cards.map(c=>c.left))-grid.left),right:Math.round(grid.right-Math.max(...cards.map(c=>c.right))),overflow:document.documentElement.scrollWidth>innerWidth}});
   assert.equal(bounds.left,0,JSON.stringify({width,prompt,bounds}));assert.equal(bounds.right,0,JSON.stringify({width,prompt,bounds}));assert(!bounds.overflow);
   if(prompt===1)await page.screenshot({path:path.join(folder,`${width}-single.png`)});
   await page.locator('.sample-card').first().click();await page.waitForFunction(()=>document.querySelector('.viewer-stage img')?.naturalWidth>0&&+document.querySelector('.viewer-stage').dataset.scale>0);
   await page.waitForTimeout(70);
   const stage=page.locator('.viewer-stage'),r=await stage.boundingBox();assert(r.height>100&&r.width>100);
   const dims=await page.evaluate(()=>{const s=document.querySelector('.viewer-stage'),i=s.querySelector('img'),k=+s.dataset.scale;return{iW:i.naturalWidth*k,iH:i.naturalHeight*k,sW:s.clientWidth,sH:s.clientHeight}});
   assert(dims.iW<=dims.sW+1&&dims.iH<=dims.sH+1,JSON.stringify({width,prompt,dims}));
   const before=Number(await stage.getAttribute('data-scale'));await page.mouse.move(r.x+r.width*.45,r.y+r.height*.45);await page.mouse.wheel(0,-120);await page.waitForTimeout(30);assert(Number(await stage.getAttribute('data-scale'))>before);
   await page.mouse.down();await page.mouse.move(r.x+r.width*.45+30,r.y+r.height*.45+25);await page.mouse.up();assert.notEqual(await stage.getAttribute('data-pan'),'0,0');
   await page.getByRole('button',{name:'适应窗口',exact:true}).click();assert.equal(await stage.getAttribute('data-pan'),'0,0');
   if(prompt===1||width===844)await page.screenshot({path:path.join(folder,`${width}-detail-prompt-${prompt}.png`)});
   const zoomed=await stage.getAttribute('data-scale');const info=page.locator('.viewer-inspector'),ib=await info.boundingBox();await page.mouse.move(ib.x+ib.width/2,ib.y+ib.height/2);await page.mouse.wheel(0,300);await page.waitForTimeout(30);assert.equal(await stage.getAttribute('data-scale'),zoomed);assert(await info.evaluate(el=>el.scrollTop)>0);
   await page.getByRole('button',{name:'参数',exact:true}).click();assert(await info.isHidden());await page.getByRole('button',{name:'参数',exact:true}).click();assert(await info.isVisible());
   await page.keyboard.press('Escape');assert.equal(await page.locator('.sample-lightbox').count(),0);
   checks.push({width,height,prompt,passed:true});
  }
 }
 await page.locator('.sample-filters button').first().click();
 await page.getByRole('button',{name:'清除选择',exact:true}).click();
 await page.getByRole('button',{name:'多选',exact:true}).click();await page.locator('.sample-card').first().click();assert.equal(await page.locator('.sample-card.selected').count(),1);assert.equal(await page.locator('.sample-lightbox').count(),0);
 assert.equal(errors.length,0,errors.join('\n'));fs.writeFileSync(path.join(folder,'verification.json'),JSON.stringify({checks,errors},null,2));
 await browser.close();console.log('PASS: Vue app full-width galleries, responsive image fit, wheel/pan, metadata scroll, info toggle, multiselect; 15 prompt/viewport combinations; no page errors.');
})().catch(e=>{console.error(e);process.exit(1)});
