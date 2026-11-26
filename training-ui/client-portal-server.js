const express = require('express');
const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { ClientPortalStore, extractPngMetadata } = require('./lib/client-portal-store');
const { JobArtifacts, progressLabel } = require('./lib/job-artifacts');
const { findAvailablePort } = require('./lib/ports');
const { streamSafetensorsResponse, stripMetadataObject } = require('./lib/safetensors-metadata');

const isWSL = process.platform === 'linux' && fs.existsSync('/proc/version') && /microsoft/i.test(fs.readFileSync('/proc/version', 'utf8'));
function defaultToNativePath(p) {
    if (!isWSL || typeof p !== 'string' || p.trim() === '') return p;
    return p.replace(/^([A-Za-z]):[\\\/]/, (_, d) => `/mnt/${d.toLowerCase()}/`).replace(/\\/g, '/');
}

function sendSafeTempZip(res, tmpDir, zipPath, downloadFilename) {
    let cleaned = false;
    const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    };
    res.once('finish', cleanup);
    res.once('close', cleanup);

    const stat = fs.statSync(zipPath);
    res.set({
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Type': 'application/zip',
        'Content-Length': String(stat.size)
    });
    res.attachment(downloadFilename);
    const stream = fs.createReadStream(zipPath);
    stream.on('error', err => {
        cleanup();
        if (!res.headersSent) res.status(500).json({ error: err.message });
        else res.destroy();
    });
    res.on('close', () => stream.destroy());
    stream.pipe(res);
}

function createClientPortalApp({
    jobsDir = path.join(__dirname, 'jobs'),
    dataDir = path.join(__dirname, 'client-portal-data'),
    publicDir = path.join(__dirname, 'client-portal', 'public'),
    toNativePath = defaultToNativePath
} = {}) {
    const app = express();
    const store = new ClientPortalStore({ jobsDir, dataDir, toNativePath });
    const artifacts = new JobArtifacts({ jobsDir });

    app.disable('x-powered-by');
    app.use(express.json({ limit: '2mb' }));

    app.use((req, res, next) => {
        res.set('X-Content-Type-Options', 'nosniff');
        if (req.path.startsWith('/api/')) {
            res.set('Cache-Control', 'no-store');
        }
        next();
    });

    app.use('/assets', express.static(path.join(publicDir, 'assets')));
    app.get(['/style.css', '/app.js'], (req, res, next) => {
        const file = path.join(publicDir, path.basename(req.path));
        if (fs.existsSync(file)) return res.sendFile(file);
        next();
    });

    app.get(['/', '/p/:token'], (_req, res) => {
        res.set('Cache-Control', 'no-store');
        res.sendFile(path.join(publicDir, 'index.html'));
    });

    function requireToken(req, res, next) {
        const client = store.getByToken(req.params.token);
        if (!client) {
            return res.status(404).json({ error: '访问链接无效或已被训练师关闭' });
        }
        req.portalClient = client;
        next();
    }

    const wrap = fn => async (req, res) => {
        try {
            await fn(req, res);
        } catch (err) {
            if (!res.headersSent) {
                res.status(err.status || 400).json({ error: err.message || '请求失败' });
            }
        }
    };

    app.get('/api/portal/:token', requireToken, (req, res) => {
        const client = req.portalClient;
        const p = client.permissions;
        const anyDelivery = Boolean(p.viewParams || p.downloadDataset || (p.downloadLora && p.allowedModels.length > 0));
        const tokenEnc = encodeURIComponent(client.token);

        res.json({
            clientName: client.clientName,
            title: client.title,
            note: client.note,
            stage: anyDelivery ? 'delivery' : 'preview',
            permissions: {
                viewParams: Boolean(p.viewParams),
                downloadDataset: Boolean(p.downloadDataset),
                downloadLora: Boolean(p.downloadLora)
            },
            previews: client.previews.map(item => ({
                id: item.id,
                name: item.originalName,
                group: item.group || '未分组',
                epoch: item.epoch || '精选',
                source: item.source || 'sample',
                size: item.size || 0,
                mtime: item.mtime || 0,
                url: `/api/portal/${tokenEnc}/previews/${encodeURIComponent(item.id)}`,
                downloadUrl: `/api/portal/${tokenEnc}/previews/${encodeURIComponent(item.id)}?download=1`
            }))
        });
    });

    app.get('/api/portal/:token/previews/:previewId', requireToken, wrap(async (req, res) => {
        const { filePath, preview } = store.resolvePreviewFile(req.portalClient.id, req.params.previewId);
        const ext = path.extname(filePath).toLowerCase();
        const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
        res.type(mime[ext] || 'application/octet-stream');
        if (req.query.download === '1' || req.query.download === 'true') {
            res.attachment(preview.originalName || path.basename(filePath));
        }
        res.sendFile(filePath);
    }));

    app.get('/api/portal/:token/previews/:previewId/metadata', requireToken, wrap(async (req, res) => {
        if (!req.portalClient.permissions.viewParams) {
            return res.status(403).json({ error: '当前未开通训练参数查阅权限' });
        }
        const { filePath } = store.resolvePreviewFile(req.portalClient.id, req.params.previewId);
        const meta = extractPngMetadata(filePath);
        res.json(meta || {});
    }));

    app.post('/api/portal/:token/previews/batch-download', requireToken, wrap(async (req, res) => {
        const ids = Array.isArray(req.body?.ids) && req.body.ids.length
            ? req.body.ids
            : req.portalClient.previews.map(p => p.id);
        const allowed = new Set(req.portalClient.previews.map(p => p.id));
        const filtered = [...new Set(ids)].filter(id => allowed.has(id));
        if (!filtered.length) return res.status(400).json({ error: '未选择有效预览图' });

        const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'anima-portal-prv-'));
        const zipPath = path.join(tmpDir, 'previews.zip');
        try {
            await store.packagePreviewsZip(req.portalClient.id, filtered, zipPath);
            sendSafeTempZip(res, tmpDir, zipPath, 'previews_pack.zip');
        } catch (err) {
            await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
            throw err;
        }
    }));

    app.get('/api/portal/:token/models', requireToken, wrap(async (req, res) => {
        const client = req.portalClient;
        if (!client.permissions.downloadLora) {
            return res.status(403).json({ error: '当前未开通模型下载权限' });
        }
        const allowedPaths = client.permissions.allowedModels || [];
        const items = [];
        for (let i = 0; i < allowedPaths.length; i++) {
            const rel = allowedPaths[i];
            try {
                const abs = await artifacts.target(client.jobName, rel);
                const stat = await fsp.stat(abs);
                const name = path.basename(abs);
                const prog = progressLabel(name);
                items.push({
                    index: i,
                    name,
                    label: prog.label,
                    size: stat.size,
                    mtime: stat.mtimeMs,
                    ready: stat.size > 0 && Date.now() - stat.mtimeMs >= 2000,
                    isSafetensors: path.extname(name).toLowerCase() === '.safetensors'
                });
            } catch {
                // Omit missing or inaccessible checkpoint rather than exposing filesystem errors
            }
        }
        res.json({ items });
    }));

    app.get('/api/portal/:token/models/:index/preview', requireToken, wrap(async (req, res) => {
        const client = req.portalClient;
        if (!client.permissions.downloadLora) {
            return res.status(403).json({ error: '当前未开通模型下载权限' });
        }
        const idx = Number(req.params.index);
        const rel = Number.isInteger(idx) && idx >= 0 ? client.permissions.allowedModels[idx] : null;
        if (!rel) return res.status(404).json({ error: '未找到指定模型' });

        const file = await artifacts.opened(client.jobName, rel);
        try {
            const isSafetensors = path.extname(file.target).toLowerCase() === '.safetensors';
            const details = isSafetensors
                ? await artifacts.header(file.handle, file.stat)
                : { metadata: {}, tensorCount: null, tensors: [], note: '此格式仅预览文件信息，不加载权重。' };
            if (isSafetensors && client.permissions.stripModelMetadata?.length) {
                details.metadata = stripMetadataObject(details.metadata, client.permissions.stripModelMetadata).metadata;
            }
            res.json({
                name: path.basename(file.target),
                size: file.stat.size,
                mtime: file.stat.mtimeMs,
                ...details
            });
        } finally {
            await file.handle.close();
        }
    }));

    app.get('/api/portal/:token/models/:index/download', requireToken, wrap(async (req, res) => {
        const client = req.portalClient;
        if (!client.permissions.downloadLora) {
            return res.status(403).json({ error: '当前未开通模型下载权限' });
        }
        const idx = Number(req.params.index);
        const rel = Number.isInteger(idx) && idx >= 0 ? client.permissions.allowedModels[idx] : null;
        if (!rel) return res.status(404).json({ error: '未找到指定模型' });

        const file = await artifacts.opened(client.jobName, rel);
        res.set({
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff'
        });
        await streamSafetensorsResponse(
            res,
            file.handle,
            file.stat,
            file.target,
            client.permissions.stripModelMetadata || [],
            {
                contentType: 'application/octet-stream',
                attachmentName: path.basename(file.target)
            }
        );
    }));

    app.get('/api/portal/:token/params', requireToken, wrap(async (req, res) => {
        if (!req.portalClient.permissions.viewParams) {
            return res.status(403).json({ error: '当前未开通训练参数查阅权限' });
        }
        res.json(store.readSanitizedParams(req.portalClient.jobName));
    }));

    app.get('/api/portal/:token/dataset', requireToken, wrap(async (req, res) => {
        if (!req.portalClient.permissions.downloadDataset) {
            return res.status(403).json({ error: '当前未开通数据集下载权限' });
        }
        res.json(store.inspectDataset(req.portalClient.jobName));
    }));

    app.get('/api/portal/:token/dataset/download', requireToken, wrap(async (req, res) => {
        if (!req.portalClient.permissions.downloadDataset) {
            return res.status(403).json({ error: '当前未开通数据集下载权限' });
        }
        const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'anima-portal-ds-'));
        const zipPath = path.join(tmpDir, 'dataset.zip');
        try {
            await store.packageDatasetZip(req.portalClient.jobName, zipPath);
            sendSafeTempZip(res, tmpDir, zipPath, 'dataset_archive.zip');
        } catch (err) {
            await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
            throw err;
        }
    }));

    return { app, store };
}

if (require.main === module) {
    const args = process.argv.slice(2);
    const portArg = args.find(a => a.startsWith('--port='));
    const requestedPort = portArg
        ? parseInt(portArg.split('=')[1], 10)
        : (parseInt(args[0], 10) || parseInt(process.env.CLIENT_PORTAL_PORT, 10) || 3100);

    const { app } = createClientPortalApp();
    const server = http.createServer(app);

    (async () => {
        const port = await findAvailablePort(requestedPort);
        if (!port) {
            console.error(`ERROR: No available port found in range ${requestedPort}-${requestedPort + 10}`);
            process.exit(1);
        }
        if (port !== requestedPort) {
            console.warn(`Port ${requestedPort} was busy, using ${port} instead.`);
        }
        server.listen(port, () => {
            console.log(`Anima Client Portal running at http://localhost:${port}`);
            console.log('Use client-specific /p/<token> links generated in Training Studio.');
        });
    })();
}

module.exports = { createClientPortalApp };
