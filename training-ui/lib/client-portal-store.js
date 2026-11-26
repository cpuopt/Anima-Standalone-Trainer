const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const TOML = require('@iarna/toml');
const { path7z } = require('7zip-bin-full');
const { sanitizeStripMetadata } = require('./safetensors-metadata');

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const DATASET_IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.avif', '.jxl']);
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_UPLOAD_BATCH = 30;

function fail(message, status = 400) {
    const err = new Error(message);
    err.status = status;
    return err;
}

function within(root, target) {
    const rel = path.relative(root, target);
    return !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep);
}

function validTokenString(token) {
    return typeof token === 'string' && /^[A-Za-z0-9_-]{12,128}$/.test(token);
}

function validIdString(id) {
    return typeof id === 'string' && /^[a-zA-Z0-9_-]{4,64}$/.test(id);
}

function safeTimingEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

function sanitizeFilename(name, fallback = 'preview.png') {
    const base = path.basename(String(name || '')).replace(/[\x00-\x1f<>:"/\\|?*]/g, '_').trim();
    if (!base || base === '.' || base === '..') return fallback;
    return base.slice(0, 140);
}

function parsePreviewMeta(filename, relPath) {
    const base = String(filename || '');
    const epochMatch = base.match(/(?:^|[-_])e(\d+)(?:[-_.]|$)/i) || base.match(/-(\d{6})\.[^.]+$/);
    const epoch = epochMatch ? `E${Number(epochMatch[1]).toString().padStart(2, '0')}` : '精选';
    const promptMatch = base.match(/_(\d{2,})_\d{14}/);
    let group = '训练采样';
    if (promptMatch) {
        group = `Prompt ${Number(promptMatch[1]) + 1}`;
    } else if (String(relPath || '').startsWith('samples/')) {
        group = '独立生成样例';
    }
    return { epoch, group };
}

function extractPngMetadata(filePath) {
    try {
        const stat = fs.statSync(filePath);
        if (stat.size < 16 || stat.size > 64 * 1024 * 1024) return null;
        const buffer = fs.readFileSync(filePath);
        if (buffer.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') return null;
        let offset = 8;
        const metadata = {};
        while (offset + 12 <= buffer.length) {
            const length = buffer.readUInt32BE(offset);
            const type = buffer.slice(offset + 4, offset + 8).toString('ascii');
            if (offset + 12 + length > buffer.length) break;
            if (type === 'tEXt') {
                const data = buffer.slice(offset + 8, offset + 8 + length).toString('utf8');
                const nullIdx = data.indexOf('\u0000');
                if (nullIdx !== -1) {
                    metadata[data.slice(0, nullIdx)] = data.slice(nullIdx + 1);
                }
            } else if (type === 'IEND') {
                break;
            }
            offset += 12 + length;
        }
        return metadata;
    } catch {
        return null;
    }
}

function run7zZip(outZipPath, cwd, targets = ['.']) {
    return new Promise((resolve, reject) => {
        execFile(path7z, ['a', '-tzip', '-y', outZipPath, ...targets], { cwd, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, _stdout, stderr) => {
            if (err) return reject(fail(`打包归档失败: ${stderr || err.message}`, 500));
            resolve(outZipPath);
        });
    });
}

function linkOrCopy(src, dest) {
    try {
        fs.linkSync(src, dest);
    } catch {
        fs.copyFileSync(src, dest);
    }
}

function sanitizeModelPath(rel) {
    if (typeof rel !== 'string' || rel.length > 500) return null;
    const norm = rel.replace(/\\/g, '/').replace(/^\/+/, '');
    const parts = norm.split('/');
    if (parts[0] !== 'output' || parts.length < 2) return null;
    if (parts.some(p => !p || p === '.' || p === '..' || /[\x00-\x1f<>:"|?*]/.test(p))) return null;
    const ext = path.extname(norm).toLowerCase();
    if (!['.safetensors', '.ckpt', '.pt', '.pth', '.bin'].includes(ext)) return null;
    return norm;
}

class ClientPortalStore {
    constructor({ jobsDir, dataDir, toNativePath = x => x }) {
        this.jobsDir = path.resolve(jobsDir);
        this.dataDir = path.resolve(dataDir);
        this.previewsRoot = path.join(this.dataDir, 'previews');
        this.configFile = path.join(this.dataDir, 'clients.json');
        this.toNativePath = toNativePath;
    }

    ensureStorage() {
        fs.mkdirSync(this.dataDir, { recursive: true });
        fs.mkdirSync(this.previewsRoot, { recursive: true });
    }

    assertJob(name) {
        if (typeof name !== 'string' || !name.trim() || name === '.' || name === '..' || /[\x00-\x1f<>:"/\\|?*]/.test(name) || /[. ]$/.test(name)) {
            throw fail('任务名称无效', 400);
        }
        const jobDir = path.resolve(this.jobsDir, name);
        if (path.dirname(jobDir) !== this.jobsDir) throw fail('任务路径越界', 403);
        let stat;
        try { stat = fs.lstatSync(jobDir); } catch { throw fail('训练任务不存在', 404); }
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw fail('任务目录不可访问', 403);
        const realRoot = fs.realpathSync(this.jobsDir);
        const realJob = fs.realpathSync(jobDir);
        if (!within(realRoot, realJob)) throw fail('任务路径越界', 403);
        return realJob;
    }

    readDb() {
        if (!fs.existsSync(this.configFile)) return { version: 1, clients: [] };
        try {
            const raw = JSON.parse(fs.readFileSync(this.configFile, 'utf8'));
            const clients = Array.isArray(raw?.clients) ? raw.clients : [];
            return { version: 1, clients };
        } catch {
            return { version: 1, clients: [] };
        }
    }

    writeDb(db) {
        this.ensureStorage();
        const tmp = `${this.configFile}.tmp.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
        fs.writeFileSync(tmp, JSON.stringify({ version: 1, clients: db.clients }, null, 2), 'utf8');
        fs.renameSync(tmp, this.configFile);
    }

    normalizeClient(client) {
        const perms = client.permissions || {};
        return {
            id: client.id,
            token: client.token,
            jobName: client.jobName,
            clientName: client.clientName || '未命名客户',
            title: client.title || client.jobName,
            note: client.note || '',
            enabled: client.enabled !== false,
            previews: Array.isArray(client.previews) ? client.previews : [],
            permissions: {
                viewParams: Boolean(perms.viewParams),
                downloadDataset: Boolean(perms.downloadDataset),
                downloadLora: Boolean(perms.downloadLora),
                allowedModels: Array.isArray(perms.allowedModels)
                    ? [...new Set(perms.allowedModels.map(sanitizeModelPath).filter(Boolean))]
                    : [],
                stripModelMetadata: sanitizeStripMetadata(perms.stripModelMetadata)
            },
            createdAt: client.createdAt || Date.now(),
            updatedAt: client.updatedAt || Date.now()
        };
    }

    listByJob(jobName) {
        this.assertJob(jobName);
        const db = this.readDb();
        return db.clients
            .filter(c => c.jobName === jobName)
            .map(c => this.normalizeClient(c))
            .sort((a, b) => b.createdAt - a.createdAt);
    }

    getByJobAndId(jobName, clientId) {
        this.assertJob(jobName);
        if (!validIdString(clientId)) throw fail('客户标识无效', 400);
        const db = this.readDb();
        const found = db.clients.find(c => c.id === clientId && c.jobName === jobName);
        if (!found) throw fail('未找到该客户交付配置', 404);
        return this.normalizeClient(found);
    }

    getByToken(token) {
        if (!validTokenString(token)) return null;
        const db = this.readDb();
        let matched = null;
        for (const item of db.clients) {
            if (safeTimingEqual(item.token || '', token)) {
                matched = item;
            }
        }
        if (!matched || matched.enabled === false) return null;
        try {
            this.assertJob(matched.jobName);
        } catch {
            return null;
        }
        return this.normalizeClient(matched);
    }

    createClient(jobName, payload = {}) {
        this.assertJob(jobName);
        const clientName = String(payload.clientName || '').trim().slice(0, 80) || '新客户';
        const title = String(payload.title || '').trim().slice(0, 120) || `${jobName} · 成果预览`;
        const note = String(payload.note || '').trim().slice(0, 500);
        const now = Date.now();
        const record = this.normalizeClient({
            id: `cli_${crypto.randomBytes(6).toString('hex')}`,
            token: crypto.randomBytes(24).toString('base64url'),
            jobName,
            clientName,
            title,
            note,
            enabled: true,
            previews: [],
            permissions: {
                viewParams: false,
                downloadDataset: false,
                downloadLora: false,
                allowedModels: [],
                stripModelMetadata: []
            },
            createdAt: now,
            updatedAt: now
        });

        const db = this.readDb();
        db.clients.push(record);
        this.writeDb(db);
        fs.mkdirSync(path.join(this.previewsRoot, record.id), { recursive: true });
        return record;
    }

    updateClient(jobName, clientId, patch = {}) {
        this.assertJob(jobName);
        if (!validIdString(clientId)) throw fail('客户标识无效', 400);
        const db = this.readDb();
        const index = db.clients.findIndex(c => c.id === clientId && c.jobName === jobName);
        if (index === -1) throw fail('未找到该客户交付配置', 404);

        const current = this.normalizeClient(db.clients[index]);
        if (patch.clientName !== undefined) current.clientName = String(patch.clientName || '').trim().slice(0, 80) || current.clientName;
        if (patch.title !== undefined) current.title = String(patch.title || '').trim().slice(0, 120) || current.title;
        if (patch.note !== undefined) current.note = String(patch.note || '').trim().slice(0, 500);
        if (patch.enabled !== undefined) current.enabled = Boolean(patch.enabled);
        if (patch.rotateToken === true) current.token = crypto.randomBytes(24).toString('base64url');
        if (patch.permissions && typeof patch.permissions === 'object') {
            const p = patch.permissions;
            if (p.viewParams !== undefined) current.permissions.viewParams = Boolean(p.viewParams);
            if (p.downloadDataset !== undefined) current.permissions.downloadDataset = Boolean(p.downloadDataset);
            if (p.downloadLora !== undefined) current.permissions.downloadLora = Boolean(p.downloadLora);
            if (Array.isArray(p.allowedModels)) {
                current.permissions.allowedModels = [...new Set(p.allowedModels.map(sanitizeModelPath).filter(Boolean))];
            }
            if (p.stripModelMetadata !== undefined) {
                current.permissions.stripModelMetadata = sanitizeStripMetadata(p.stripModelMetadata);
            }
        }
        current.updatedAt = Date.now();
        db.clients[index] = current;
        this.writeDb(db);
        return current;
    }

    deleteClient(jobName, clientId) {
        this.assertJob(jobName);
        if (!validIdString(clientId)) throw fail('客户标识无效', 400);
        const db = this.readDb();
        const index = db.clients.findIndex(c => c.id === clientId && c.jobName === jobName);
        if (index === -1) throw fail('未找到该客户交付配置', 404);
        db.clients.splice(index, 1);
        this.writeDb(db);
        const dir = path.join(this.previewsRoot, clientId);
        if (within(this.previewsRoot, dir)) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
        return { success: true };
    }

    normalizeSampleRelPath(jobName, rawPath) {
        if (typeof rawPath !== 'string') throw fail('样例路径无效', 400);
        let rel = rawPath.trim();
        const apiPrefix = `/api/jobs/${encodeURIComponent(jobName)}/samples/`;
        const rawApiPrefix = `/api/jobs/${jobName}/samples/`;
        if (rel.startsWith(apiPrefix)) rel = decodeURIComponent(rel.slice(apiPrefix.length));
        else if (rel.startsWith(rawApiPrefix)) rel = rel.slice(rawApiPrefix.length);
        rel = rel.replace(/\\/g, '/').replace(/^\/+/, '');
        const parts = rel.split('/');
        if (!['samples', 'output'].includes(parts[0]) || parts.length < 2) throw fail(`非法的样例路径: ${rawPath}`, 403);
        if (parts.some(p => !p || p === '.' || p === '..' || /[\x00-\x1f<>:"|?*]/.test(p))) throw fail(`非法的样例路径: ${rawPath}`, 403);
        const ext = path.extname(rel).toLowerCase();
        if (!IMAGE_EXTS.has(ext)) throw fail(`不支持的图片格式: ${ext}`, 400);
        return rel;
    }

    copySamplesToClient(jobName, clientId, samplePaths) {
        const jobRoot = this.assertJob(jobName);
        if (!Array.isArray(samplePaths) || !samplePaths.length) throw fail('请至少选择一张样例图片', 400);
        const db = this.readDb();
        const index = db.clients.findIndex(c => c.id === clientId && c.jobName === jobName);
        if (index === -1) throw fail('未找到该客户交付配置', 404);
        const client = this.normalizeClient(db.clients[index]);
        const destDir = path.join(this.previewsRoot, client.id);
        fs.mkdirSync(destDir, { recursive: true });

        let added = 0;
        let skipped = 0;
        for (const rawPath of samplePaths) {
            const rel = this.normalizeSampleRelPath(jobName, rawPath);
            let cur = jobRoot;
            for (const part of rel.split('/')) {
                cur = path.join(cur, part);
                let lstat;
                try { lstat = fs.lstatSync(cur); } catch { throw fail(`样例文件不存在: ${rel}`, 404); }
                if (lstat.isSymbolicLink()) throw fail('不允许复制符号链接文件', 403);
            }
            const realSrc = fs.realpathSync(cur);
            if (!within(jobRoot, realSrc) || !fs.statSync(realSrc).isFile()) throw fail(`样例路径不可访问: ${rel}`, 403);

            const existing = client.previews.find(p => p.source === 'sample' && p.sourcePath === rel);
            if (existing) {
                const existingDest = path.join(destDir, existing.filename);
                if (fs.existsSync(existingDest)) {
                    skipped++;
                    continue;
                }
            }

            const origName = sanitizeFilename(path.basename(realSrc));
            const id = `prv_${crypto.randomBytes(6).toString('hex')}`;
            const storedFilename = `${id}_${origName}`;
            const destPath = path.join(destDir, storedFilename);
            fs.copyFileSync(realSrc, destPath);
            const stat = fs.statSync(destPath);
            const meta = parsePreviewMeta(origName, rel);

            if (existing) {
                existing.filename = storedFilename;
                existing.size = stat.size;
                existing.mtime = stat.mtimeMs;
            } else {
                client.previews.push({
                    id,
                    filename: storedFilename,
                    originalName: origName,
                    group: meta.group,
                    epoch: meta.epoch,
                    source: 'sample',
                    sourcePath: rel,
                    size: stat.size,
                    mtime: stat.mtimeMs
                });
            }
            added++;
        }

        client.updatedAt = Date.now();
        db.clients[index] = client;
        this.writeDb(db);
        return { added, skipped, client };
    }

    uploadPreviewsToClient(jobName, clientId, files) {
        this.assertJob(jobName);
        if (!Array.isArray(files) || !files.length) throw fail('请选择要上传的图片', 400);
        if (files.length > MAX_UPLOAD_BATCH) throw fail(`单次最多上传 ${MAX_UPLOAD_BATCH} 张图片`, 400);
        const db = this.readDb();
        const index = db.clients.findIndex(c => c.id === clientId && c.jobName === jobName);
        if (index === -1) throw fail('未找到该客户交付配置', 404);
        const client = this.normalizeClient(db.clients[index]);
        const destDir = path.join(this.previewsRoot, client.id);
        fs.mkdirSync(destDir, { recursive: true });

        const uploaded = [];
        for (const item of files) {
            const dataUrl = String(item?.dataUrl || '');
            const match = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=\s]+)$/i);
            if (!match) throw fail(`不支持的图片编码格式: ${item?.name || 'unknown'}`, 400);
            const mimeSubtype = match[1].toLowerCase();
            const buf = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
            if (!buf.length || buf.length > MAX_UPLOAD_BYTES) throw fail(`图片体积需在 1B - 25MB 之间: ${item?.name || 'unknown'}`, 400);

            const extMap = { png: '.png', jpeg: '.jpg', jpg: '.jpg', webp: '.webp' };
            let origName = sanitizeFilename(item?.name, `upload${extMap[mimeSubtype]}`);
            const ext = path.extname(origName).toLowerCase();
            if (!IMAGE_EXTS.has(ext)) origName += extMap[mimeSubtype];

            const id = `prv_${crypto.randomBytes(6).toString('hex')}`;
            const storedFilename = `${id}_${origName}`;
            const destPath = path.join(destDir, storedFilename);
            fs.writeFileSync(destPath, buf);
            const stat = fs.statSync(destPath);
            const customGroup = String(item?.group || '').trim().slice(0, 60) || '训练师精选上传';
            const customEpoch = String(item?.epoch || '').trim().slice(0, 20) || '精选';
            const entry = {
                id,
                filename: storedFilename,
                originalName: origName,
                group: customGroup,
                epoch: customEpoch,
                source: 'upload',
                sourcePath: null,
                size: stat.size,
                mtime: stat.mtimeMs
            };
            client.previews.push(entry);
            uploaded.push(entry);
        }

        client.updatedAt = Date.now();
        db.clients[index] = client;
        this.writeDb(db);
        return { uploaded: uploaded.length, client };
    }

    removePreview(jobName, clientId, previewId) {
        this.assertJob(jobName);
        if (!validIdString(clientId) || !validIdString(previewId)) throw fail('参数无效', 400);
        const db = this.readDb();
        const index = db.clients.findIndex(c => c.id === clientId && c.jobName === jobName);
        if (index === -1) throw fail('未找到该客户交付配置', 404);
        const client = this.normalizeClient(db.clients[index]);
        const pIdx = client.previews.findIndex(p => p.id === previewId);
        if (pIdx === -1) throw fail('预览图不存在', 404);

        const [removed] = client.previews.splice(pIdx, 1);
        const clientDir = path.join(this.previewsRoot, client.id);
        const filePath = path.resolve(clientDir, removed.filename);
        if (within(clientDir, filePath) && fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        client.updatedAt = Date.now();
        db.clients[index] = client;
        this.writeDb(db);
        return client;
    }

    resolvePreviewFile(clientId, previewId) {
        if (!validIdString(clientId) || !validIdString(previewId)) throw fail('预览图标识无效', 400);
        const db = this.readDb();
        const rawClient = db.clients.find(c => c.id === clientId);
        if (!rawClient) throw fail('客户配置不存在', 404);
        const preview = (rawClient.previews || []).find(p => p.id === previewId);
        if (!preview) throw fail('预览图不存在', 404);

        const clientDir = path.resolve(this.previewsRoot, clientId);
        const target = path.resolve(clientDir, preview.filename);
        if (!within(clientDir, target)) throw fail('预览图路径越界', 403);
        let lstat;
        try { lstat = fs.lstatSync(target); } catch { throw fail('预览图文件已丢失', 404); }
        if (lstat.isSymbolicLink() || !lstat.isFile()) throw fail('预览图文件不可访问', 403);
        return { filePath: target, preview, stat: lstat };
    }

    readSanitizedParams(jobName) {
        const jobRoot = this.assertJob(jobName);
        const configPath = path.join(jobRoot, 'config.toml');
        const datasetPath = path.join(jobRoot, 'dataset.toml');
        let rawConfig = {};
        let rawDataset = {};
        if (fs.existsSync(configPath)) {
            rawConfig = TOML.parse(fs.readFileSync(configPath, 'utf8'));
        }
        if (fs.existsSync(datasetPath)) {
            rawDataset = TOML.parse(fs.readFileSync(datasetPath, 'utf8'));
        }

        const sanitized = {};
        const redactKey = new Set([
            'output_dir', 'logging_dir', 'train_data_dir', 'reg_data_dir',
            'sample_prompts', 'dataset_config', 'resume', 'network_weights', 'output_name'
        ]);
        const pathValueToBasename = val => {
            if (typeof val !== 'string') return val;
            if (!val.trim()) return '';
            if (/[\\/]/.test(val) || /^[A-Za-z]:/.test(val)) return path.basename(val);
            return val;
        };

        for (const [section, body] of Object.entries(rawConfig)) {
            if (!body || typeof body !== 'object' || Array.isArray(body)) continue;
            const outSection = {};
            for (const [k, v] of Object.entries(body)) {
                if (redactKey.has(k)) continue;
                if (k.endsWith('_path') || k.endsWith('_dir')) {
                    outSection[k] = pathValueToBasename(v);
                } else {
                    outSection[k] = v;
                }
            }
            if (Object.keys(outSection).length) sanitized[section] = outSection;
        }

        const dsGeneral = rawDataset.general && typeof rawDataset.general === 'object' ? { ...rawDataset.general } : {};
        const dsList = Array.isArray(rawDataset.datasets) ? rawDataset.datasets.map((d, idx) => ({
            index: idx + 1,
            resolution: d.resolution,
            batch_size: d.batch_size,
            caption_extension: d.caption_extension,
            subsets: Array.isArray(d.subsets) ? d.subsets.map((s, sIdx) => ({
                subset_id: `subset_${sIdx + 1}`,
                num_repeats: s.num_repeats,
                flip_aug: s.flip_aug,
                shuffle_caption: s.shuffle_caption,
                keep_tokens: s.keep_tokens,
                caption_prefix: s.caption_prefix || ''
            })) : []
        })) : [];

        const sanitizedForToml = { ...sanitized };
        if (Object.keys(dsGeneral).length || dsList.length) {
            sanitizedForToml.dataset_summary = {
                general: dsGeneral,
                datasets: dsList
            };
        }

        const t = sanitized.training_arguments || {};
        const n = sanitized.network_arguments || {};
        const a = sanitized.anima_arguments || sanitized.krea2_arguments || sanitized.moss_arguments || {};
        const architecture = rawConfig.architecture
            || (rawConfig.moss_arguments ? 'moss_image' : rawConfig.krea2_arguments ? 'krea2' : 'anima');

        const sections = [
            {
                title: '架构与网络结构',
                items: [
                    ['训练架构', architecture],
                    ['网络模块', n.network_module ?? '—'],
                    ['Rank (Dim) / Alpha', `${n.network_dim ?? '—'} / ${n.network_alpha ?? '—'}`],
                    ['Network Dropout', n.network_dropout ?? '0'],
                    ['仅训练 UNet / DiT', n.network_train_unet_only !== undefined ? String(n.network_train_unet_only) : '—']
                ]
            },
            {
                title: '优化器与学习率调度',
                items: [
                    ['优化器', t.optimizer_type ?? '—'],
                    ['UNet / DiT 学习率', t.learning_rate ?? '—'],
                    ['Text Encoder 学习率', t.text_encoder_lr ?? '—'],
                    ['调度器', t.lr_scheduler ?? '—'],
                    ['Warmup / Cycles', `${t.lr_warmup_steps ?? 0} (${t.lr_warmup_unit || 'steps'}) · ${t.lr_scheduler_num_cycles ?? 1}`]
                ]
            },
            {
                title: '训练步程与精度',
                items: [
                    ['最大训练轮次', t.max_train_epochs ?? '—'],
                    ['保存频率', t.save_every_n_epochs ? `每 ${t.save_every_n_epochs} Epoch` : '—'],
                    ['混合精度 / 保存格式', `${t.mixed_precision ?? '—'} / ${t.save_model_as ?? 'safetensors'}`],
                    ['Gradient Accum', t.gradient_accumulation_steps ?? 1],
                    ['随机种子', t.seed ?? '—']
                ]
            },
            {
                title: '分桶分辨率与架构专项参数',
                items: [
                    ['分桶分辨率范围', dsGeneral.min_bucket_reso && dsGeneral.max_bucket_reso ? `${dsGeneral.min_bucket_reso} – ${dsGeneral.max_bucket_reso} (step ${dsGeneral.bucket_reso_steps || 64})` : '—'],
                    ['目标分辨率 / Batch', dsList[0] ? `${JSON.stringify(dsList[0].resolution)} · BS ${dsList[0].batch_size}` : '—'],
                    ['采样方法 / Flow Shift', `${a.timestep_sample_method || a.timestep_sampling || '—'} · ${a.discrete_flow_shift ?? '—'}`],
                    ['Weighting Scheme', a.weighting_scheme ?? '—']
                ]
            }
        ];

        return {
            architecture,
            sections,
            raw: sanitized,
            toml: TOML.stringify(sanitizedForToml)
        };
    }

    resolveDatasetDirs(jobName) {
        const jobRoot = this.assertJob(jobName);
        const datasetPath = path.join(jobRoot, 'dataset.toml');
        if (!fs.existsSync(datasetPath)) return [];
        const parsed = TOML.parse(fs.readFileSync(datasetPath, 'utf8'));
        const dirs = [];
        const seen = new Set();
        const datasets = Array.isArray(parsed.datasets) ? parsed.datasets : [];
        for (const ds of datasets) {
            const captionExt = typeof ds.caption_extension === 'string' && ds.caption_extension ? ds.caption_extension : '.txt';
            const subsets = Array.isArray(ds.subsets) ? ds.subsets : [];
            for (const sub of subsets) {
                const rawDir = sub.image_dir || sub.image_directory;
                if (!rawDir || typeof rawDir !== 'string') continue;
                const nativeDir = path.resolve(this.toNativePath(rawDir.replace(/^['"]+|['"]+$/g, '')));
                if (seen.has(nativeDir)) continue;
                seen.add(nativeDir);
                let lstat;
                try { lstat = fs.lstatSync(nativeDir); } catch { continue; }
                if (!lstat.isDirectory() || lstat.isSymbolicLink()) continue;
                dirs.push({ dir: nativeDir, captionExt });
            }
        }
        return dirs;
    }

    inspectDataset(jobName) {
        const dirs = this.resolveDatasetDirs(jobName);
        let imageCount = 0;
        let captionCount = 0;
        let totalBytes = 0;
        const exts = new Set();

        for (const { dir, captionExt } of dirs) {
            let entries;
            try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
            for (const entry of entries) {
                if (!entry.isFile() || entry.isSymbolicLink()) continue;
                const ext = path.extname(entry.name).toLowerCase();
                if (!DATASET_IMAGE_EXTS.has(ext)) continue;
                const fullImg = path.join(dir, entry.name);
                const imgStat = fs.statSync(fullImg);
                imageCount++;
                totalBytes += imgStat.size;
                exts.add(ext.replace('.', '').toUpperCase());

                const stem = path.basename(entry.name, path.extname(entry.name));
                const capPath = path.join(dir, stem + captionExt);
                if (fs.existsSync(capPath)) {
                    const capStat = fs.lstatSync(capPath);
                    if (capStat.isFile() && !capStat.isSymbolicLink()) {
                        captionCount++;
                        totalBytes += capStat.size;
                    }
                }
            }
        }

        return {
            available: dirs.length > 0 && imageCount > 0,
            subsetsCount: dirs.length,
            imageCount,
            captionCount,
            captionCoverage: imageCount ? Math.round((captionCount / imageCount) * 100) : 0,
            totalBytes,
            formats: [...exts]
        };
    }

    async packagePreviewsZip(clientId, previewIds, outZipPath) {
        if (!Array.isArray(previewIds) || !previewIds.length) throw fail('请选择至少一张预览图', 400);
        const staging = await fsp.mkdtemp(path.join(os.tmpdir(), 'anima-prv-zip-'));
        const usedNames = new Set();
        try {
            for (const pid of previewIds) {
                const { filePath, preview } = this.resolvePreviewFile(clientId, pid);
                const ext = path.extname(preview.originalName || filePath);
                const base = path.basename(preview.originalName || filePath, ext);
                let targetName = `${base}${ext}`;
                let n = 2;
                while (usedNames.has(targetName.toLowerCase())) {
                    targetName = `${base}_${n++}${ext}`;
                }
                usedNames.add(targetName.toLowerCase());
                linkOrCopy(filePath, path.join(staging, targetName));
            }
            await run7zZip(outZipPath, staging, ['.']);
            return outZipPath;
        } finally {
            await fsp.rm(staging, { recursive: true, force: true }).catch(() => {});
        }
    }

    async packageDatasetZip(jobName, outZipPath) {
        const dirs = this.resolveDatasetDirs(jobName);
        if (!dirs.length) throw fail('当前任务未配置可读的数据集目录', 404);
        const staging = await fsp.mkdtemp(path.join(os.tmpdir(), 'anima-ds-zip-'));
        let fileCount = 0;
        try {
            for (let i = 0; i < dirs.length; i++) {
                const { dir, captionExt } = dirs[i];
                const subDir = dirs.length === 1 ? staging : path.join(staging, `subset_${i + 1}`);
                await fsp.mkdir(subDir, { recursive: true });
                const entries = await fsp.readdir(dir, { withFileTypes: true });
                for (const entry of entries) {
                    if (!entry.isFile() || entry.isSymbolicLink()) continue;
                    const ext = path.extname(entry.name).toLowerCase();
                    if (!DATASET_IMAGE_EXTS.has(ext) && ext !== captionExt.toLowerCase()) continue;
                    linkOrCopy(path.join(dir, entry.name), path.join(subDir, entry.name));
                    fileCount++;
                }
            }
            if (!fileCount) throw fail('数据集目录中未找到可打包的图像或标注文件', 404);
            await run7zZip(outZipPath, staging, ['.']);
            return outZipPath;
        } finally {
            await fsp.rm(staging, { recursive: true, force: true }).catch(() => {});
        }
    }
}

function mountClientPortalAdmin(app, store, { portalPort = Number(process.env.CLIENT_PORTAL_PORT) || 3100, service = null } = {}) {
    const route = fn => async (req, res) => {
        try {
            await fn(req, res);
        } catch (err) {
            if (!res.headersSent) {
                res.status(err.status || 400).json({ error: err.message || '请求失败' });
            }
        }
    };

    app.get('/api/client-portal/service', route((_req, res) => {
        if (!service) return res.status(501).json({ error: '独立客户服务管理器未启用' });
        res.set('Cache-Control', 'no-store');
        res.json(service.status());
    }));

    app.post('/api/client-portal/service/start', route(async (req, res) => {
        if (!service) return res.status(501).json({ error: '独立客户服务管理器未启用' });
        res.json(await service.start(req.body?.port));
    }));

    app.post('/api/client-portal/service/stop', route(async (_req, res) => {
        if (!service) return res.status(501).json({ error: '独立客户服务管理器未启用' });
        res.json(await service.stop());
    }));

    app.get('/api/jobs/:name/client-portal', route((req, res) => {
        res.set('Cache-Control', 'no-store');
        const svcStatus = service ? service.status() : null;
        res.json({
            portalPort: svcStatus?.port || svcStatus?.requestedPort || portalPort,
            service: svcStatus,
            clients: store.listByJob(req.params.name)
        });
    }));

    app.post('/api/jobs/:name/client-portal', route((req, res) => {
        const client = store.createClient(req.params.name, req.body || {});
        res.status(201).json({ client });
    }));

    app.put('/api/jobs/:name/client-portal/:clientId', route((req, res) => {
        const client = store.updateClient(req.params.name, req.params.clientId, req.body || {});
        res.json({ client });
    }));

    app.delete('/api/jobs/:name/client-portal/:clientId', route((req, res) => {
        res.json(store.deleteClient(req.params.name, req.params.clientId));
    }));

    app.post('/api/jobs/:name/client-portal/:clientId/previews/sync-samples', route((req, res) => {
        res.json(store.copySamplesToClient(req.params.name, req.params.clientId, req.body?.paths));
    }));

    app.post('/api/jobs/:name/client-portal/:clientId/previews/upload', route((req, res) => {
        res.json(store.uploadPreviewsToClient(req.params.name, req.params.clientId, req.body?.files));
    }));

    app.delete('/api/jobs/:name/client-portal/:clientId/previews/:previewId', route((req, res) => {
        const client = store.removePreview(req.params.name, req.params.clientId, req.params.previewId);
        res.json({ client });
    }));

    app.get('/api/jobs/:name/client-portal/:clientId/previews/:previewId/image', route((req, res) => {
        store.getByJobAndId(req.params.name, req.params.clientId);
        const { filePath } = store.resolvePreviewFile(req.params.clientId, req.params.previewId);
        const ext = path.extname(filePath).toLowerCase();
        const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
        res.type(mime[ext] || 'application/octet-stream');
        res.sendFile(filePath);
    }));
}

module.exports = {
    ClientPortalStore,
    mountClientPortalAdmin,
    extractPngMetadata,
    parsePreviewMeta,
    sanitizeModelPath
};
