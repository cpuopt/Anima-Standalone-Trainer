const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const express = require('express');
const { JobArtifacts, progressLabel } = require('../lib/job-artifacts');
const { UiAccess } = require('../lib/ui-access');
const http = require('node:http');

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trainer-artifacts-')), jobs = path.join(root, 'jobs'), job = path.join(jobs, '任务 #1');
    await fs.mkdir(job, {recursive:true});
    const library = new JobArtifacts({ jobsDir: jobs, isRunning: () => true });
    async function write(relative, data='checkpoint', stable=true) {
        const file = path.join(job, ...relative.split('/')); await fs.mkdir(path.dirname(file), {recursive:true}); await fs.writeFile(file, data);
        if (stable) { const old = new Date(Date.now()-10000); await fs.utimes(file, old, old); }
        return file;
    }
    const app = express(), access = new UiAccess({file:path.join(root, 'code')}); access.mount(app); library.mount(app);
    const server = app.listen(0, '127.0.0.1'); await new Promise(r=>server.on('listening',r));
    const base = `http://127.0.0.1:${server.address().port}/api/jobs/${encodeURIComponent('任务 #1')}/artifacts`;
    t.after(async()=>{
        access.dispose(); await new Promise(r=>server.close(r));
        assert.equal(path.dirname(root),os.tmpdir()); assert.match(path.basename(root),/^trainer-artifacts-/); await fs.rm(root,{recursive:true,force:true});
    });
    return {root, jobs, job, library, write, base, server};
}
function safetensors(metadata={ss_epoch:'3',ss_steps:'60'}) {
    const header = Buffer.from(JSON.stringify({__metadata__:metadata,weight:{dtype:'F32',shape:[1],data_offsets:[0,4]}}));
    const prefix = Buffer.alloc(8); prefix.writeBigUInt64LE(BigInt(header.length)); return Buffer.concat([prefix,header,Buffer.alloc(4)]);
}
test('epoch and step labels follow actual trainer naming, without inventing unmarked rounds',()=>{
    assert.equal(progressLabel('my-name-000003.safetensors').label,'Epoch 3');
    assert.equal(progressLabel('my-name-step00000060.ckpt').step,60);
    assert.equal(progressLabel('output_e000002_20261028000000.png').epoch,2);
    assert.equal(progressLabel('final.safetensors').epoch,undefined);
});
test('lists all saved epochs, final models and training/manual samples; excludes optimizer states and unsafe types',async t=>{
    const {write,library}=await fixture(t);
    for(const relative of ['output/my-000001.safetensors','output/my-000002.safetensors','output/my.ckpt','output/sample/my_e000001.png','samples/manual.webp','output/my-000002-state/optimizer.bin','output/tensorboard/events.bin','output/secret.txt']) await write(relative);
    const models=await library.list('任务 #1'); assert.equal(models.models,3); assert.equal(models.samples,2); assert.equal(models.running,true);
    assert.equal(models.items.every(f=>f.ready),true); assert.ok(models.items.some(f=>f.epoch===2));
    const samples=await library.list('任务 #1',{kind:'samples',source:'training'}); assert.equal(samples.total,1); assert.match(samples.items[0].path,/^output\/sample\//);
    const manual=await library.list('任务 #1',{kind:'samples',source:'generation'}); assert.equal(manual.items[0].name,'manual.webp');
    const filtered=await library.list('任务 #1',{query:'000002'}); assert.equal(filtered.total,1);
});
test('HTTP preview reads only bounded safetensors headers; download bytes and Unicode disposition are correct',async t=>{
    const {write,base}=await fixture(t); const data=safetensors(); await write('output/模型-000003.safetensors',data);
    const listing=await(await fetch(base)).json(), item=listing.items[0]; const q=new URLSearchParams({path:item.path,version:item.version});
    const preview=await(await fetch(base+'/preview?'+q)).json(); assert.equal(preview.tensorCount,1); assert.equal(preview.metadata.ss_epoch,'3'); assert.deepEqual(preview.tensors[0].shape,[1]);
    const download=await fetch(base+'/file?'+q+'&download=true'); assert.equal(download.status,200); assert.match(download.headers.get('content-disposition'),/attachment/); assert.match(download.headers.get('content-disposition'),/filename\*/); assert.equal(Number(download.headers.get('content-length')),data.length); assert.deepEqual(Buffer.from(await download.arrayBuffer()),data);
    await write('output/sample/a.png',Buffer.from('fixture-image'));
    const image=await fetch(base+'/file?path=output%2Fsample%2Fa.png'); assert.match(image.headers.get('content-type'),/image\/png/); assert.equal(image.headers.get('content-disposition'),null);
    await write('output/checkpoint.ckpt','never unpickle this');
    const ckpt=await(await fetch(base+'/preview?path=output%2Fcheckpoint.ckpt')).json(); assert.equal(ckpt.tensorCount,null); assert.match(ckpt.note,/不加载/);
});
test('fresh, zero-byte, changed, malformed and oversized headers fail safely',async t=>{
    const {write,base}=await fixture(t);
    await write('output/fresh.safetensors',safetensors(),false); await write('output/empty.safetensors','');
    for(const file of ['fresh','empty']) assert.equal((await fetch(base+`/file?path=output%2F${file}.safetensors`)).status,409);
    await write('output/stable.safetensors',safetensors());
    assert.equal((await fetch(base+'/file?path=output%2Fstable.safetensors&version=stale')).status,409);
    for(const [name,content] of [['bad',Buffer.from('bad')],['huge',Buffer.from([255,255,255,255,255,255,255,255])]]) {
        await write(`output/${name}.safetensors`,content); assert.equal((await fetch(base+`/preview?path=output%2F${name}.safetensors`)).status,400);
    }
});
test('missing jobs, traversal, symlink roots/files and non-artifact paths cannot be read',async t=>{
    const {write,base,library,root,job}=await fixture(t); await write('output/model.pt'); await write('secret.txt','private');
    for(const p of ['../secret.txt','output/../secret.txt','output/a:secret.pt','samples/m.pt','/output/model.pt','output\\model.pt']) {
        assert.notEqual((await fetch(base+'/file?'+new URLSearchParams({path:p}))).status,200);
    }
    for(const name of ['..','.','../outside']) await assert.rejects(library.list(name));
    await assert.rejects(library.list('missing'));
    assert.equal((await fetch(base+'/file?path=output%2Fmissing.pt')).status,404);
    const outside=path.join(root,'outside.pt'); await fs.writeFile(outside,'secret');
    try { await fs.symlink(outside,path.join(job,'output','link.pt')); } catch(e) { if(['EPERM','EACCES'].includes(e.code)) {t.diagnostic('Windows symlink creation not permitted; path validation assertions still ran'); return;} throw e; }
    assert.equal((await fetch(base+'/file?path=output%2Flink.pt')).status,403);
    assert.equal((await library.list('任务 #1')).items.some(f=>f.name==='link.pt'),false);
});
test('new artifact list, preview and download require the global LAN session',async t=>{
    const {server}=await fixture(t);
    for(const suffix of ['', '/preview?path=output/a.pt','/file?path=output/a.pt']) {
        const status=await new Promise((resolve,reject)=>{
            const req=http.get({host:'127.0.0.1',port:server.address().port,path:'/api/jobs/job/artifacts'+suffix,headers:{Host:`studio.local:${server.address().port}`}},res=>{res.resume();resolve(res.statusCode)});req.on('error',reject);
        }); assert.equal(status,401);
    }
});
