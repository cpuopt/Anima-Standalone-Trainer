const { chromium } = require('C:/Program Files/WindowsApps/OpenAI.CodexPrimaryRuntime.v26-1112-737-0_26.1112.737.0_x64__3k8sg7r9htsxt/dependencies/node/node_modules/playwright');
const path=require('path'),fs=require('fs');
(async()=>{
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:1});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const root=__dirname;fs.mkdirSync(path.join(root,'screenshots'),{recursive:true});
for(let i=1;i<=6;i++){
 await page.goto('file:///'+path.join(root,'design-demos',`dir-${i}.html`).replaceAll('\\','/'));
 await page.screenshot({path:path.join(root,'screenshots',`dir-${i}${process.argv.includes('--final')?'':'-before'}.png`),fullPage:true});
 if(i>3)continue;
 await page.locator('#power').click();if(!await page.locator('.empty').isVisible())throw Error('Empty state missing '+i);
 await page.locator('#launch').click();if(!await page.locator('.charts').isVisible())throw Error('Charts not restored '+i);
 await page.locator('#filter').fill('unet');if(await page.locator('.chart:visible').count()!==1)throw Error('Filter '+i);
 await page.locator('#filter').fill('');
 if(i===3){await page.locator('.drawer-toggle').click();if(await page.locator('.rail').isVisible())throw Error('Drawer');await page.locator('.drawer-toggle').click();}
 await page.evaluate(()=>{document.querySelector('.toast').style.display='none';document.activeElement.blur()});
 await page.setViewportSize({width:375,height:812});
 await page.screenshot({path:path.join(root,'screenshots',`dir-${i}-mobile.png`),fullPage:true});
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Mobile overflow '+i);
 await page.setViewportSize({width:1600,height:1000});
}
await page.setViewportSize({width:1240,height:1300});await page.goto('file:///'+path.join(root,'design-demos','thumbs.html').replaceAll('\\','/'));await page.screenshot({path:path.join(root,'comparison.png'),fullPage:true});
console.log(JSON.stringify({errors,checked:'three primary designs: start/stop, empty state, filter, drawer, mobile overflow'}));await browser.close();if(errors.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exit(1)});
