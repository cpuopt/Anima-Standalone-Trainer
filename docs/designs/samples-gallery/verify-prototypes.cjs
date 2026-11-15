const {chromium}=require('C:/Program Files/WindowsApps/OpenAI.CodexPrimaryRuntime.v26-1112-737-0_26.1112.737.0_x64__3k8sg7r9htsxt/dependencies/node/node_modules/playwright');
const {pathToFileURL}=require('url');
const fs=require('fs');const path=require('path');const assert=require('assert');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 const report=[];const round=process.env.DESIGN_ROUND||'round-1';
 const folder=path.join(__dirname,'screenshots',round);fs.mkdirSync(folder,{recursive:true});
 for(let n=1;n<=3;n++){
  const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.join(__dirname,'design-demos',`dir-${n}.html`)).href);await page.waitForFunction(()=>document.querySelectorAll('.tile img').length===36&&[...document.querySelectorAll('.tile img')].every(i=>i.complete));
  await page.screenshot({path:path.join(folder,`dir-${n}-gallery.png`),fullPage:true});
  await page.locator('.tile').first().click();await page.waitForFunction(()=>document.querySelector('.stage img').naturalWidth>0&&Number(document.querySelector('.stage').dataset.scale)>0);
  await page.screenshot({path:path.join(folder,`dir-${n}-detail-portrait-image.png`)});
  const stage=page.locator('.stage');let r=await stage.boundingBox();
  const before=await stage.getAttribute('data-scale');const top=await page.evaluate(()=>document.querySelector('main').scrollTop);
  await page.mouse.move(r.x+r.width*.4,r.y+r.height*.45);await page.mouse.wheel(0,-120);await page.waitForTimeout(80);
  assert(Number(await stage.getAttribute('data-scale'))>Number(before),'wheel did not zoom');assert.equal(await page.evaluate(()=>document.querySelector('main').scrollTop),top,'image wheel scrolled gallery');
  const panBefore=await stage.getAttribute('data-pan');await page.mouse.down();await page.mouse.move(r.x+r.width*.4+65,r.y+r.height*.45+35);await page.mouse.up();assert.notEqual(await stage.getAttribute('data-pan'),panBefore,'drag did not pan');
  await page.locator('#fit').click();assert.equal(await stage.getAttribute('data-pan'),'0,0');
  await page.locator('#actual').click();assert.equal(Number(await stage.getAttribute('data-scale')),1);
  if(n===2)await page.locator('#info').click();
  let info=page.locator('.inspector');let ib=await info.boundingBox();const scale=await stage.getAttribute('data-scale');await page.mouse.move(ib.x+ib.width/2,ib.y+ib.height/2);await page.mouse.wheel(0,350);await page.waitForTimeout(80);assert.equal(await stage.getAttribute('data-scale'),scale,'metadata wheel zoomed image');
  await page.keyboard.press('Escape');assert(await page.locator('.viewer').isHidden());
  await page.locator('#search').fill('E06');assert.equal(await page.locator('.tile').count(),6);await page.locator('#search').fill('');
  await page.locator('#select').click();await page.locator('.tile').first().click();assert.equal(await page.locator('.tile.selected').count(),1);assert(await page.locator('.viewer').isHidden());await page.locator('#select').click();
  await page.locator('.tile[data-id="32"]').click();await page.waitForFunction(()=>document.querySelector('.stage img').naturalWidth>document.querySelector('.stage img').naturalHeight);await page.screenshot({path:path.join(folder,`dir-${n}-detail-landscape-image.png`)});
  for(const [label,w,h] of [['phone',390,844],['small-phone',375,812],['landscape',844,390],['tablet',768,1024]]){
   await page.setViewportSize({width:w,height:h});await page.waitForTimeout(100);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`horizontal overflow ${n}/${label}`);
   const fitResult=await page.evaluate(()=>{const s=document.querySelector('.stage'),img=s.querySelector('img'),k=+s.dataset.scale;return {w:img.naturalWidth*k,h:img.naturalHeight*k,sw:s.clientWidth,sh:s.clientHeight}});
   assert(fitResult.w<=fitResult.sw+1&&fitResult.h<=fitResult.sh+1,`image does not fit ${n}/${label}`);assert(fitResult.sh>120,`canvas too short ${n}/${label}`);
   await page.screenshot({path:path.join(folder,`dir-${n}-${label}-landscape-image.png`)});
   if(label==='phone'){
    await page.keyboard.press('Escape');await page.screenshot({path:path.join(folder,`dir-${n}-phone-gallery.png`),fullPage:true});
    await page.locator('.tile[data-id="30"]').click();await page.waitForFunction(()=>document.querySelector('.stage img').naturalHeight>document.querySelector('.stage img').naturalWidth);await page.screenshot({path:path.join(folder,`dir-${n}-phone-portrait-image.png`)});
    await page.keyboard.press('Escape');await page.locator('.tile[data-id="32"]').click();await page.waitForFunction(()=>document.querySelector('.stage img').naturalWidth>document.querySelector('.stage img').naturalHeight);
   }
  }
  assert.equal(errors.length,0,errors.join('\n'));report.push({direction:n,passed:true,checks:['wheel zoom','pan','fit','1:1','metadata independent wheel','escape','search','multiselect','horizontal and vertical images','390/375/844/768 responsive','no console errors']});
  await page.close();console.log('Direction',n,'passed');
 }
 fs.writeFileSync(path.join(folder,'verification.json'),JSON.stringify(report,null,2));await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
