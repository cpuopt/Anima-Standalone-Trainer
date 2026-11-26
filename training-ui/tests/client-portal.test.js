const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const express = require('express');
const { UiAccess } = require('../lib/ui-access');
const { ClientPortalStore, mountClientPortalAdmin } = require('../lib/client-portal-store');
const { ClientPortalService } = require('../lib/client-portal-service');
const { createClientPortalApp } = require('../client-portal-server');

function makeSafetensors(metadata = { ss_epoch: '16', ss_network_dim: '32' }) {
    const header = Buffer.from(JSON.stringify({
        __metadata__: metadata,
        lora_weight: { dtype: 'BF16', shape: [2, 2], data_offsets: [0, 8] }
    }));
    const prefix = Buffer.alloc(8);
    prefix.writeBigUInt64LE(BigInt(header.length));
    return Buffer.concat([prefix, header, Buffer.alloc(8)]);
}

function makePngWithText(key, value) {
    // Minimal valid PNG signature + IHDR + tEXt + IEND (for metadata parser test)
    const sig = Buffer.from('89504e470d0a1a0a', 'hex');
    const chunk = (type, data) => {
        const len = Buffer.alloc(4);
        len.writeUInt32BE(data.length, 0);
        const typeBuf = Buffer.from(type, 'ascii');
        const crc = Buffer.alloc(4);
        return Buffer.concat([len, typeBuf, data, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(1, 0);
    ihdr.writeUInt32BE(1, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;
    const textData = Buffer.concat([Buffer.from(key, 'utf8'), Buffer.from([0]), Buffer.from(value, 'utf8')]);
    return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('tEXt', textData), chunk('IEND', Buffer.alloc(0))]);
}

async function setupFixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'anima-client-portal-test-'));
    const jobsDir = path.join(root, 'jobs');
    const dataDir = path.join(root, 'client-portal-data');
    const datasetDir = path.join(root, 'secret-host-dataset-folder');
    const jobName = 'cel_ink_job';
    const jobDir = path.join(jobsDir, jobName);

    await fs.mkdir(path.join(jobDir, 'output', 'sample'), { recursive: true });
    await fs.mkdir(path.join(jobDir, 'samples'), { recursive: true });
    await fs.mkdir(datasetDir, { recursive: true });

    // Sample images in job
    const pngBytes = makePngWithText('parameters', 'cel-ink watercolor girl, 28 steps, CFG 5.5');
    const sample1 = path.join(jobDir, 'output', 'sample', 'cel_00_20261121000000_e000016.png');
    const sample2 = path.join(jobDir, 'samples', 'manual_gen.png');
    await fs.writeFile(sample1, pngBytes);
    await fs.writeFile(sample2, pngBytes);

    // Saved LoRA checkpoints (2 models, one authorized later, one not authorized)
    const model16 = makeSafetensors({ ss_epoch: '16', ss_network_dim: '32' });
    const model08 = makeSafetensors({ ss_epoch: '8', ss_network_dim: '32' });
    const m16Path = path.join(jobDir, 'output', 'cel_ink-000016.safetensors');
    const m08Path = path.join(jobDir, 'output', 'cel_ink-000008.safetensors');
    await fs.writeFile(m16Path, model16);
    await fs.writeFile(m08Path, model08);
    const oldTime = new Date(Date.now() - 10000);
    await fs.utimes(m16Path, oldTime, oldTime);
    await fs.utimes(m08Path, oldTime, oldTime);

    // Dataset files
    await fs.writeFile(path.join(datasetDir, 'img_01.png'), pngBytes);
    await fs.writeFile(path.join(datasetDir, 'img_01.txt'), '1girl, watercolor');

    // Job config.toml and dataset.toml containing local host paths that must be sanitized
    const configToml = `
[training_arguments]
output_name = "cel_ink_job"
output_dir = "C:\\\\Users\\\\secret\\\\jobs\\\\cel_ink_job\\\\output"
logging_dir = "C:\\\\Users\\\\secret\\\\logs"
max_train_epochs = 16
learning_rate = 0.0001
optimizer_type = "AdamW8bit"
mixed_precision = "bf16"
dit_path = "D:\\\\Models\\\\anima_base.safetensors"

[network_arguments]
network_module = "networks.lora_anima"
network_dim = 32
network_alpha = 16
`;
    const datasetToml = `
[general]
min_bucket_reso = 512
max_bucket_reso = 1536
bucket_reso_steps = 64

[[datasets]]
resolution = [1024, 1024]
batch_size = 2
caption_extension = ".txt"

  [[datasets.subsets]]
  image_dir = ${JSON.stringify(datasetDir)}
  num_repeats = 1
`;
    await fs.writeFile(path.join(jobDir, 'config.toml'), configToml, 'utf8');
    await fs.writeFile(path.join(jobDir, 'dataset.toml'), datasetToml, 'utf8');

    // Admin app (simulating port 3000 trainer backend)
    const adminApp = express();
    const access = new UiAccess();
    access.mount(adminApp);
    adminApp.use(express.json({ limit: '50mb' }));
    const adminStore = new ClientPortalStore({ jobsDir, dataDir });
    const adminService = new ClientPortalService({ jobsDir, dataDir, host: '127.0.0.1' });
    mountClientPortalAdmin(adminApp, adminStore, { portalPort: 3100, service: adminService });
    const adminServer = adminApp.listen(0, '127.0.0.1');
    await new Promise(r => adminServer.on('listening', r));
    const adminBase = `http://127.0.0.1:${adminServer.address().port}`;

    const setup = await fetch(adminBase + '/api/access/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'trainer-pass', confirmPassword: 'trainer-pass' })
    });
    assert.equal(setup.status, 200);
    const cookie = setup.headers.get('set-cookie').split(';')[0];
    const adminFetch = (url, opts = {}) => fetch(adminBase + url, { ...opts, headers: { Cookie: cookie, ...(opts.headers || {}) } });

    // Independent client portal app (simulating port 3100 client server)
    const { app: portalApp } = createClientPortalApp({ jobsDir, dataDir });
    const portalServer = portalApp.listen(0, '127.0.0.1');
    await new Promise(r => portalServer.on('listening', r));
    const portalBase = `http://127.0.0.1:${portalServer.address().port}`;

    t.after(async () => {
        access.dispose();
        await adminService.stop();
        await new Promise(r => adminServer.close(r));
        await new Promise(r => portalServer.close(r));
        await fs.rm(root, { recursive: true, force: true });
    });

    return { root, jobsDir, dataDir, jobName, jobDir, datasetDir, model16, pngBytes, adminFetch, portalBase, adminService };
}

test('admin manages previews by copying to isolated directory and uploading manually without touching job samples', async t => {
    const { jobName, jobDir, dataDir, pngBytes, adminFetch, portalBase } = await setupFixture(t);
    const base = `/api/jobs/${encodeURIComponent(jobName)}/client-portal`;

    // Unauthenticated access to admin API must be rejected
    const unauth = await fetch(portalBase + '/api/portal/invalid_token_123456');
    assert.equal(unauth.status, 404);

    // Create client
    const createRes = await adminFetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientName: 'Atelier K', title: '星尘水彩预览', note: '第一批审片' })
    });
    assert.equal(createRes.status, 201);
    const { client } = await createRes.json();
    assert.ok(client.id.startsWith('cli_'));
    assert.ok(client.token.length >= 24);

    // Copy sample image from training job into isolated client-portal-data/previews
    const syncRes = await adminFetch(`${base}/${client.id}/previews/sync-samples`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: [`/api/jobs/${jobName}/samples/output/sample/cel_00_20261121000000_e000016.png`] })
    });
    assert.equal(syncRes.status, 200);
    const syncBody = await syncRes.json();
    assert.equal(syncBody.added, 1);
    assert.equal(syncBody.client.previews.length, 1);
    const copiedPreview = syncBody.client.previews[0];
    assert.equal(copiedPreview.group, 'Prompt 1');
    assert.equal(copiedPreview.epoch, 'E16');

    // Verify physical copy exists in isolated directory
    const isolatedCopyPath = path.join(dataDir, 'previews', client.id, copiedPreview.filename);
    const stat = await fs.stat(isolatedCopyPath);
    assert.equal(stat.size, pngBytes.length);

    // Manual upload of another preview image
    const uploadRes = await adminFetch(`${base}/${client.id}/previews/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            files: [{
                name: 'showcase.png',
                group: '训练师精选上传',
                dataUrl: `data:image/png;base64,${pngBytes.toString('base64')}`
            }]
        })
    });
    assert.equal(uploadRes.status, 200);
    const uploadBody = await uploadRes.json();
    assert.equal(uploadBody.uploaded, 1);
    assert.equal(uploadBody.client.previews.length, 2);

    // Remove copied preview from client portal: must NOT delete original training sample
    const delPreviewRes = await adminFetch(`${base}/${client.id}/previews/${copiedPreview.id}`, { method: 'DELETE' });
    assert.equal(delPreviewRes.status, 200);
    const origSampleExists = await fs.stat(path.join(jobDir, 'output', 'sample', 'cel_00_20261121000000_e000016.png')).then(() => true, () => false);
    assert.equal(origSampleExists, true);
    const isolatedCopyExists = await fs.stat(isolatedCopyPath).then(() => true, () => false);
    assert.equal(isolatedCopyExists, false);
});

test('client portal strictly isolates unpaid stage and enforces granular paid permissions', async t => {
    const { jobName, datasetDir, model16, pngBytes, adminFetch, portalBase } = await setupFixture(t);
    const adminBase = `/api/jobs/${encodeURIComponent(jobName)}/client-portal`;

    const { client } = await (await adminFetch(adminBase, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientName: 'Buyer A', title: '交付测试' })
    })).json();

    await adminFetch(`${adminBase}/${client.id}/previews/sync-samples`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: ['output/sample/cel_00_20261121000000_e000016.png', 'samples/manual_gen.png'] })
    });

    const tok = encodeURIComponent(client.token);

    // --- Stage 1: Unpaid Preview Only ---
    const htmlRes = await fetch(`${portalBase}/p/${tok}`);
    assert.equal(htmlRes.status, 200);
    assert.match(await htmlRes.text(), /Anima Client/);

    const overviewRes = await fetch(`${portalBase}/api/portal/${tok}`);
    assert.equal(overviewRes.status, 200);
    const overview = await overviewRes.json();
    assert.equal(overview.stage, 'preview');
    assert.deepEqual(overview.permissions, { viewParams: false, downloadDataset: false, downloadLora: false });
    assert.equal(overview.previews.length, 2);
    // Ensure internal jobName and server paths are never leaked
    const rawJson = JSON.stringify(overview);
    assert.equal(rawJson.includes(jobName), false);
    assert.equal(rawJson.includes('safetensors'), false);
    assert.equal(rawJson.includes(datasetDir), false);

    // Previews are viewable and downloadable
    const imgRes = await fetch(`${portalBase}${overview.previews[0].url}`);
    assert.equal(imgRes.status, 200);
    assert.deepEqual(Buffer.from(await imgRes.arrayBuffer()), pngBytes);

    // Batch ZIP download works in Stage 1
    const batchZipRes = await fetch(`${portalBase}/api/portal/${tok}/previews/batch-download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: overview.previews.map(p => p.id) })
    });
    assert.equal(batchZipRes.status, 200);
    assert.equal(batchZipRes.headers.get('content-type'), 'application/zip');
    const zipBytes = Buffer.from(await batchZipRes.arrayBuffer());
    assert.equal(zipBytes.slice(0, 2).toString(), 'PK');

    // All protected Stage 2 endpoints MUST return 403
    assert.equal((await fetch(`${portalBase}/api/portal/${tok}/models`)).status, 403);
    assert.equal((await fetch(`${portalBase}/api/portal/${tok}/models/0/download`)).status, 403);
    assert.equal((await fetch(`${portalBase}/api/portal/${tok}/models/0/preview`)).status, 403);
    assert.equal((await fetch(`${portalBase}/api/portal/${tok}/params`)).status, 403);
    assert.equal((await fetch(`${portalBase}/api/portal/${tok}/dataset`)).status, 403);
    assert.equal((await fetch(`${portalBase}/api/portal/${tok}/dataset/download`)).status, 403);
    assert.equal((await fetch(`${portalBase}/api/portal/${tok}/previews/${overview.previews[0].id}/metadata`)).status, 403);

    // --- Stage 2a: Authorize ONLY specified LoRA model (cel_ink-000016.safetensors) ---
    await adminFetch(`${adminBase}/${client.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            permissions: {
                viewParams: false,
                downloadDataset: false,
                downloadLora: true,
                allowedModels: ['output/cel_ink-000016.safetensors']
            }
        })
    });

    const modelsRes = await fetch(`${portalBase}/api/portal/${tok}/models`);
    assert.equal(modelsRes.status, 200);
    const modelsData = await modelsRes.json();
    assert.equal(modelsData.items.length, 1);
    assert.equal(modelsData.items[0].name, 'cel_ink-000016.safetensors');

    // Authorized model preview & download succeed
    const mPreview = await (await fetch(`${portalBase}/api/portal/${tok}/models/0/preview`)).json();
    assert.equal(mPreview.tensorCount, 1);
    assert.equal(mPreview.metadata.ss_epoch, '16');

    const mDownload = await fetch(`${portalBase}/api/portal/${tok}/models/0/download`);
    assert.equal(mDownload.status, 200);
    assert.deepEqual(Buffer.from(await mDownload.arrayBuffer()), model16);

    // Unassigned model index returns 404; params and dataset still 403
    assert.equal((await fetch(`${portalBase}/api/portal/${tok}/models/1/download`)).status, 404);
    assert.equal((await fetch(`${portalBase}/api/portal/${tok}/params`)).status, 403);
    assert.equal((await fetch(`${portalBase}/api/portal/${tok}/dataset/download`)).status, 403);

    // --- Stage 2b: Authorize params and dataset as well ---
    await adminFetch(`${adminBase}/${client.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            permissions: {
                viewParams: true,
                downloadDataset: true,
                downloadLora: true,
                allowedModels: ['output/cel_ink-000016.safetensors']
            }
        })
    });

    const paramsRes = await fetch(`${portalBase}/api/portal/${tok}/params`);
    assert.equal(paramsRes.status, 200);
    const paramsJson = await paramsRes.json();
    const paramsStr = JSON.stringify(paramsJson);
    assert.equal(paramsStr.includes('C:\\Users\\secret'), false);
    assert.equal(paramsStr.includes(datasetDir), false);
    assert.match(paramsJson.toml, /network_dim = 32/);
    assert.match(paramsJson.toml, /anima_base\.safetensors/);

    const metaRes = await fetch(`${portalBase}/api/portal/${tok}/previews/${overview.previews[0].id}/metadata`);
    assert.equal(metaRes.status, 200);
    assert.match((await metaRes.json()).parameters, /cel-ink watercolor/);

    const dsInfo = await (await fetch(`${portalBase}/api/portal/${tok}/dataset`)).json();
    assert.equal(dsInfo.imageCount, 1);
    assert.equal(dsInfo.captionCount, 1);
    assert.equal(dsInfo.captionCoverage, 100);

    const dsZipRes = await fetch(`${portalBase}/api/portal/${tok}/dataset/download`);
    assert.equal(dsZipRes.status, 200);
    assert.equal(dsZipRes.headers.get('content-type'), 'application/zip');
    assert.equal(Buffer.from(await dsZipRes.arrayBuffer()).slice(0, 2).toString(), 'PK');

    // Disabling client immediately cuts off access
    await adminFetch(`${adminBase}/${client.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false })
    });
    assert.equal((await fetch(`${portalBase}/api/portal/${tok}`)).status, 404);
});

test('trainer UI API starts and stops the independent client portal service on its own port', async t => {
    const { jobName, adminFetch } = await setupFixture(t);
    const adminBase = `/api/jobs/${encodeURIComponent(jobName)}/client-portal`;

    const { client } = await (await adminFetch(adminBase, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientName: 'Live Control Client', title: '动态启停测试' })
    })).json();

    const initStatus = await (await adminFetch('/api/client-portal/service')).json();
    assert.equal(initStatus.running, false);
    assert.equal(initStatus.port, null);

    // Reject invalid port
    const badStart = await adminFetch('/api/client-portal/service/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 80 })
    });
    assert.equal(badStart.status, 400);

    // Start independent service on ephemeral port 0
    const startRes = await adminFetch('/api/client-portal/service/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 0 })
    });
    assert.equal(startRes.status, 200);
    const started = await startRes.json();
    assert.equal(started.running, true);
    assert.ok(Number.isInteger(started.port) && started.port > 0);

    // Job overview reflects live port
    const listRes = await (await adminFetch(adminBase)).json();
    assert.equal(listRes.portalPort, started.port);
    assert.equal(listRes.service.running, true);

    // Independent port serves client API directly
    const portalRes = await fetch(`http://127.0.0.1:${started.port}/api/portal/${encodeURIComponent(client.token)}`);
    assert.equal(portalRes.status, 200);
    const portalBody = await portalRes.json();
    assert.equal(portalBody.clientName, 'Live Control Client');

    // Stop independent service via trainer UI API
    const stopRes = await adminFetch('/api/client-portal/service/stop', { method: 'POST' });
    assert.equal(stopRes.status, 200);
    const stopped = await stopRes.json();
    assert.equal(stopped.running, false);
    assert.equal(stopped.port, null);

    await assert.rejects(() => fetch(`http://127.0.0.1:${started.port}/api/portal/${encodeURIComponent(client.token)}`));
});

test('strips configured safetensors metadata fields on client portal model download and preview', async t => {
    const { jobName, jobDir, adminFetch, portalBase } = await setupFixture(t);
    const adminBase = `/api/jobs/${encodeURIComponent(jobName)}/client-portal`;

    const tensorBytes = Buffer.from([9, 8, 7, 6, 5, 4, 3, 2]);
    const headerBuf = Buffer.from(JSON.stringify({
        __metadata__: {
            ss_epoch: '20',
            ss_tag_frequency: JSON.stringify({ d: { tagA: 5 } }),
            ss_datasets: JSON.stringify([
                {
                    subsets: [{ image_dir: 'd', class_tokens: 'my_trig' }],
                    bucket_info: { buckets: { '1024,1024': 5 } },
                    tag_frequency: { d: { tagA: 5 } }
                }
            ])
        },
        lora_weight: { dtype: 'BF16', shape: [2, 2], data_offsets: [0, 8] }
    }));
    const prefix = Buffer.alloc(8);
    prefix.writeBigUInt64LE(BigInt(headerBuf.length));
    const rawModel = Buffer.concat([prefix, headerBuf, tensorBytes]);
    const modelPath = path.join(jobDir, 'output', 'cel_ink-000020.safetensors');
    await fs.writeFile(modelPath, rawModel);
    const oldTime = new Date(Date.now() - 10000);
    await fs.utimes(modelPath, oldTime, oldTime);

    const { client } = await (await adminFetch(adminBase, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientName: 'Strip Client', title: '元数据脱敏测试' })
    })).json();

    const putRes = await adminFetch(`${adminBase}/${client.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            permissions: {
                viewParams: false,
                downloadDataset: false,
                downloadLora: true,
                allowedModels: ['output/cel_ink-000020.safetensors'],
                stripModelMetadata: [
                    'ss_datasets[*].bucket_info',
                    'ss_datasets[*].tag_frequency',
                    'ss_tag_frequency'
                ]
            }
        })
    });
    assert.equal(putRes.status, 200);
    const putBody = await putRes.json();
    assert.deepEqual(putBody.client.permissions.stripModelMetadata, [
        'ss_datasets[*].bucket_info',
        'ss_datasets[*].tag_frequency',
        'ss_tag_frequency'
    ]);

    const tok = encodeURIComponent(client.token);
    const previewRes = await fetch(`${portalBase}/api/portal/${tok}/models/0/preview`);
    assert.equal(previewRes.status, 200);
    const previewJson = await previewRes.json();
    assert.equal('ss_tag_frequency' in previewJson.metadata, false);
    const previewDs = JSON.parse(previewJson.metadata.ss_datasets);
    assert.equal('bucket_info' in previewDs[0], false);
    assert.equal('tag_frequency' in previewDs[0], false);
    assert.deepEqual(previewDs[0].subsets, [{ image_dir: 'd', class_tokens: 'my_trig' }]);

    const dlRes = await fetch(`${portalBase}/api/portal/${tok}/models/0/download`);
    assert.equal(dlRes.status, 200);
    const dlBuf = Buffer.from(await dlRes.arrayBuffer());
    assert.equal(Number(dlRes.headers.get('content-length')), dlBuf.length);
    const dlHeaderLen = Number(dlBuf.readBigUInt64LE(0));
    const dlHeader = JSON.parse(dlBuf.subarray(8, 8 + dlHeaderLen).toString('utf8'));
    assert.equal(dlHeader.__metadata__.ss_epoch, '20');
    assert.equal('ss_tag_frequency' in dlHeader.__metadata__, false);
    const dlDs = JSON.parse(dlHeader.__metadata__.ss_datasets);
    assert.equal('bucket_info' in dlDs[0], false);
    assert.equal('tag_frequency' in dlDs[0], false);
    assert.deepEqual(dlDs[0].subsets, [{ image_dir: 'd', class_tokens: 'my_trig' }]);
    assert.deepEqual(dlBuf.subarray(8 + dlHeaderLen), tensorBytes);

    // Disk file remains unmodified
    assert.deepEqual(await fs.readFile(modelPath), rawModel);
});
