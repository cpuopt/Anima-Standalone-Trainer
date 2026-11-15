const {chromium}=require('C:/Program Files/WindowsApps/OpenAI.CodexPrimaryRuntime.v26-1112-737-0_26.1112.737.0_x64__3k8sg7r9htsxt/dependencies/node/node_modules/playwright');
const fs=require('fs');
(async()=>{
 fs.mkdirSync(__dirname+'/refs',{recursive:true});
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 for(const [name,url] of [['eagle','https://eagle.cool/'],['darktable','https://docs.darktable.org/usermanual/development/en/lighttable/overview/']]){
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  try{await page.goto(url,{waitUntil:'domcontentloaded',timeout:25000});await page.waitForTimeout(1500);await page.screenshot({path:__dirname+'/refs/'+name+'.jpg',type:'jpeg',quality:85});console.log(name,'captured');}catch(e){console.log(name,e.message)}
  await page.close();
 }
 await browser.close();
})();
