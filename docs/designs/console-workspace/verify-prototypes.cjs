const {chromium}=require('C:/Program Files/WindowsApps/OpenAI.CodexPrimaryRuntime.v26-1112-737-0_26.1112.737.0_x64__3k8sg7r9htsxt/dependencies/node/node_modules/playwright');
const fs=require('fs'),path=require('path'),assert=require('assert');const {pathToFileURL}=require('url');
(async()=>{
 const b=await chromium.launch({headless:true,channel:'msedge'}),round=process.env.DESIGN_ROUND||'round-1';
 const out=path.join(__dirname,'screenshots',round);fs.mkdirSync(out,{recursive:true});const report=[];
 for(let n=1;n<=3;n++){
  const p=await b.newPage({viewport:{width:1440,height:900}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.goto(pathToFileURL(path.join(__dirname,'design-demos',`dir-${n}.html`)).href);
  await p.screenshot({path:path.join(out,`dir-${n}-desktop.png`)});
  assert(await p.locator('.log-line').count()>20);
  await p.locator('#log-search').fill('Qwen3');assert(await p.locator('.log-line').count()>0);assert(await p.locator('.log-line').count()<8);
  await p.locator('#log-search').fill('');await p.locator('[data-level="WARN"]').click();assert.equal(await p.locator('.log-line').count(),2);
  await p.locator('[data-level="ERROR"]').click();assert.equal(await p.locator('.log-line').count(),0);
  await p.locator('[data-level="ALL"]').click();await p.locator('#clear').click();assert.equal(await p.locator('.log-line').count(),0);await p.locator('#reset-demo').click();assert(await p.locator('.log-line').count()>20);
  await p.locator('#run-state').selectOption('idle');assert(await p.locator('#trace').isEnabled());await p.locator('#run-state').selectOption('running');assert(await p.locator('#trace').isDisabled());
  await p.locator('#run-state').selectOption('offline');assert((await p.locator('.connection').textContent()).includes('最后快照'));await p.locator('#run-state').selectOption('running');
  await p.locator('#gpu-count').selectOption('2');assert.equal(await p.locator('.gpu').count(),2);await p.locator('.toast').evaluate(el=>el.hidden=true);await p.screenshot({path:path.join(out,`dir-${n}-two-gpus.png`)});
  await p.locator('#gpu-count').selectOption('1');await p.locator('#snapshot').selectOption('no');assert.equal(await p.locator('.placement').count(),0);
  if(n===3){await p.locator('#diagnostics').click();assert(await p.locator('.monitor-column').isVisible())}
  await p.screenshot({path:path.join(out,`dir-${n}-no-snapshot.png`)});
  if(n===3){await p.locator('#snapshot').selectOption('yes');await p.screenshot({path:path.join(out,`dir-${n}-drawer.png`)});await p.locator('#drawer-close').click()}else await p.locator('#snapshot').selectOption('yes');
  if(n===1){const log=await p.locator('.log-panel').boundingBox();await p.locator('.memory-toggle').click();assert((await p.locator('.log-panel').boundingBox()).height>log.height);await p.locator('.memory-toggle').click()}
  for(const [label,w,h]of[['wide',1920,1080],['phone',390,844],['small-phone',375,812],['landscape',844,390]]){
   await p.setViewportSize({width:w,height:h});await p.locator('.toast').evaluate(el=>el.hidden=true);await p.screenshot({path:path.join(out,`dir-${n}-${label}.png`)});
   assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`horizontal overflow ${n}/${label}`);
   const log=await p.locator('.log-output').boundingBox();assert(log.height>60,`logs too short ${n}/${label}: ${log.height}`);
   if(label==='phone'&&(n===2||n===3)){await p.locator('#diagnostics').click();assert(await p.locator('.monitor-column').isVisible());assert(await p.locator('.memory-panel').isVisible());await p.screenshot({path:path.join(out,`dir-${n}-phone-drawer.png`)});await p.locator('#drawer-close').click()}
  }
  assert.equal(errors.length,0,errors.join('\n'));report.push({direction:n,passed:true,checks:['search','log-level filters','clear and restore','trace-lock','disconnect stale data','one/two GPUs','no snapshot','desktop/wide/phone/landscape','no horizontal overflow','no script errors']});
  await p.close();console.log('Direction',n,'passed');
 }
 await b.close();fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exit(1)});
