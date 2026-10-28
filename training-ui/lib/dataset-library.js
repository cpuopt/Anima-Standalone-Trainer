// Dataset imports are immutable: stage -> inspect -> atomically publish a new directory.
// No endpoint writes to a bound directory. Archive entries are streamed through stdout,
// never extracted by 7-Zip onto the host filesystem (including symlinks/hardlinks).
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { DATASET_IMAGE_EXTENSIONS } = require('./dataset-images');
const { localRequest: isLocalRequest } = require('./ui-access');

const LIMITS = Object.freeze({ files: 10000, fileBytes: 1024 ** 3, uploadBytes: 8 * 1024 ** 3,
    expandedBytes: 16 * 1024 ** 3, captionBytes: 1024 ** 2, pageSize: 60 });
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
    '.bmp': 'image/bmp', '.avif': 'image/avif', '.jxl': 'image/jxl' };
const TTL = 60 * 60 * 1000;
function fail(message, status = 400) { const e = Error(message); e.status = status; throw e; }
function relativePath(value) {
    if (typeof value !== 'string' || !value || value.length > 1000 || /^[\\/]/.test(value)) fail('无效的相对路径');
    const parts = value.replace(/\\/g, '/').split('/');
    if (parts.some(p => !p || p === '.' || p === '..' || /[\x00-\x1f\x7f<>:"|?*]/.test(p) || /[. ]$/.test(p) ||
        /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p))) fail('文件路径不安全：' + value);
    if (parts.length > 32) fail('目录层级过深');
    return parts.join('/');
}
function inside(root, file) {
    const rel = path.relative(root, file);
    return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}
function allowed(file) { return DATASET_IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase()) || /\.txt$/i.test(file); }
function archiveType(file) { const ext = path.extname(file).toLowerCase(); return ext === '.zip' ? 'zip' : ext === '.7z' ? '7z' : null; }
function localRequest(req) {
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return false;
    try {
        const host = new URL('http://' + req.headers.host);
        if (!['localhost', '127.0.0.1', '[::1]'].includes(host.hostname)) return false;
        if (req.headers.origin) {
            const origin = new URL(req.headers.origin);
            if (!['http:', 'https:'].includes(origin.protocol) || origin.host !== host.host) return false;
        }
        return true;
    } catch { return false; }
}
function parseArchiveList(text, limits = LIMITS) {
    const entries = [], seen = new Set(); let total = 0;
    for (const block of text.trim().split(/\r?\n\r?\n/)) {
        if (!block.trim()) continue;
        const fields = Object.create(null);
        for (const line of block.split(/\r?\n/)) {
            const match = /^([^=\r\n]+) = (.*)$/.exec(line);
            if (!match || Object.hasOwn(fields, match[1])) fail('压缩包目录格式异常（不支持含换行的文件名）');
            fields[match[1]] = match[2];
        }
        const raw = fields.Path;
        const directory = fields.Folder === '+' || /^D/.test(fields.Attributes || '');
        const name = relativePath(directory ? raw?.replace(/[\\/]$/, '') : raw);
        const key = name.toLowerCase();
        if (seen.has(key)) fail('压缩包中存在重复或大小写冲突路径：' + name);
        seen.add(key);
        if (fields.Encrypted === '+') fail('不支持加密压缩包，请先解密后上传');
        if (Object.keys(fields).some(k => /symbolic link|hard link|reparse/i.test(k)) ||
            /(^|\s)l[rwx-]{9}/.test(fields.Attributes || '')) fail('压缩包不允许链接文件');
        const size = Number(fields.Size);
        if (!Number.isSafeInteger(size) || size < 0 || size > limits.fileBytes) fail('压缩包单文件大小超过限制');
        total += size;
        if (total > limits.expandedBytes || entries.length >= limits.files) fail('压缩包解压大小或文件数量超过限制');
        entries.push({ raw, name, size, directory });
    }
    if (!entries.length) fail('压缩包为空或无法读取');
    return entries;
}

async function sevenZip(args, { signal, output, maxBytes = 8 * 1024 ** 2, timeout = 120000 } = {}) {
    const executable = require('7zip-bin-full').path7z;
    const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '', size = 0; const chunks = [];
    const abort = () => child.kill();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) child.kill();
    const timer = setTimeout(abort, timeout); timer.unref();
    child.stderr.on('data', b => { if (stderr.length < 4096) stderr += b.toString(); });
    const done = new Promise((resolve, reject) => {
        child.on('error', reject);
        child.on('close', code => code === 0 ? resolve() : reject(Error('压缩包读取失败（损坏、加密或不支持的格式）' + (stderr.includes('Wrong password') ? '：需要密码' : ''))));
    });
    // Attach handlers immediately so pipeline failures never create unhandled rejections.
    done.catch(() => {});
    const counter = new Transform({ transform(chunk, _encoding, cb) {
        size += chunk.length;
        cb(size > maxBytes ? Error('解压输出超过大小限制') : null, chunk);
    } });
    try {
        if (output) await pipeline(child.stdout, counter, fs.createWriteStream(output, { flags: 'wx' }), { signal });
        else {
            counter.on('data', b => chunks.push(b));
            await pipeline(child.stdout, counter, { signal });
        }
        await done;
        if (signal?.aborted) fail('导入已取消');
        return { text: Buffer.concat(chunks).toString('utf8'), size };
    } finally {
        child.kill(); await done.catch(() => {});
        clearTimeout(timer); signal?.removeEventListener('abort', abort);
    }
}

class DatasetLibrary {
    constructor({ root, isBusy = () => false, toNativePath = v => v, limits = {} }) {
        this.root = path.resolve(root); this.staging = path.join(this.root, '.staging');
        this.isBusy = isBusy; this.toNativePath = toNativePath; this.limits = { ...LIMITS, ...limits };
        this.sessions = new Map(); this.bindings = new Map();
        this.authorizationFile = path.join(this.root, '.authorized-roots.json');
        this.thumbnails = new Map(); this.thumbnailTasks = new Map(); this.thumbnailActive = 0; this.thumbnailQueue = [];
        this.timer = setInterval(() => { void this.expire().catch(() => {}); }, 60000); this.timer.unref();
    }
    assertIdle() { if (this.isBusy()) fail('训练运行中，请停止训练后再导入数据集', 409); }
    async initialize() {
        await fsp.mkdir(this.staging, { recursive: true });
        for (const dir of [this.root, this.staging]) if ((await fsp.lstat(dir)).isSymbolicLink()) fail('数据集存储目录不能是链接');
        if (!this.initialized) {
            // Only remove checked, generated, expired children; never user datasets.
            for (const entry of await fsp.readdir(this.staging, { withFileTypes: true })) {
                if (!entry.isDirectory() || !/^import-[a-zA-Z0-9]+$/.test(entry.name)) continue;
                const target = path.resolve(this.staging, entry.name);
                if (path.dirname(target) !== this.staging || !inside(this.staging, target)) continue;
                if ([...this.sessions.values()].some(s => s.stage === target)) continue;
                if (Date.now() - (await fsp.lstat(target)).mtimeMs > 24 * 60 * 60 * 1000) await fsp.rm(target, { recursive: true, force: true });
            }
            this.initialized = true;
        }
    }
    async authorizedRoots() {
        try {
            const stat = await fsp.lstat(this.authorizationFile); if (stat.isSymbolicLink()) fail('授权文件不能是链接');
            const data = JSON.parse(await fsp.readFile(this.authorizationFile, 'utf8'));
            if (!Array.isArray(data) || data.some(p => typeof p !== 'string' || !path.isAbsolute(p))) fail('数据集目录授权文件格式异常');
            return data;
        } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
    }
    async authorize(directory, remove = false) {
        await this.initialize();
        const roots = await this.authorizedRoots();
        const native = this.toNativePath(String(directory || '').trim());
        if (!path.isAbsolute(native)) fail('授权目录必须是绝对路径');
        const canonical = remove ? native : await fsp.realpath(native);
        if (!remove && !(await fsp.stat(canonical)).isDirectory()) fail('授权路径不是目录');
        const next = roots.filter(p => p !== canonical); if (!remove) next.push(canonical);
        const temporary = this.authorizationFile + '.' + crypto.randomUUID() + '.tmp';
        await fsp.writeFile(temporary, JSON.stringify(next, null, 2), { flag: 'wx', mode: 0o600 });
        try { await fsp.rename(temporary, this.authorizationFile); } finally { await fsp.unlink(temporary).catch(() => {}); }
        return next;
    }
    async isAuthorized(root) {
        if (inside(this.staging, root)) return false;
        return inside(this.root, root) && !inside(this.staging, root) && root !== this.root ||
            (await this.authorizedRoots()).some(authorized => inside(authorized, root));
    }
    get(id) {
        const s = this.sessions.get(id); if (!s) fail('导入会话已过期，请重新选择文件', 404);
        s.touched = Date.now(); return s;
    }
    view(s) { return { id: s.id, phase: s.phase, processed: s.processed || 0, error: s.error, summary: s.summary, limits: this.limits }; }
    async create() {
        this.assertIdle(); await this.initialize(); await this.expire();
        if (this.sessions.size >= 8) fail('导入会话过多，请关闭其他导入窗口', 429);
        const stage = await fsp.mkdtemp(path.join(this.staging, 'import-'));
        await fsp.mkdir(path.join(stage, 'incoming')); await fsp.mkdir(path.join(stage, 'content'));
        const s = { id: crypto.randomUUID(), stage, phase: 'uploading', touched: Date.now(), bytes: 0,
            files: new Set(), controller: new AbortController() };
        this.sessions.set(s.id, s); return this.view(s);
    }
    async upload(s, req, file) {
        this.assertIdle(); if (s.phase !== 'uploading' || s.operation || s.uploading) fail('当前导入不可上传', 409);
        file = relativePath(file);
        if (!allowed(file) && !archiveType(file)) fail('只允许图片、TXT、ZIP 或 7z 文件');
        if (s.files.has(file.toLowerCase())) fail('重复文件（不会覆盖）：' + file, 409);
        if (s.files.size >= this.limits.files) fail('文件数量超过限制');
        const target = path.join(s.stage, 'incoming', ...file.split('/'));
        // Reserve before the first await; simultaneous PUTs must not bypass quotas.
        s.uploading = true;
        let size = 0;
        const counter = new Transform({ transform: (b, _e, cb) => {
            size += b.length; s.touched = Date.now();
            cb(size > this.limits.fileBytes || s.bytes + size > this.limits.uploadBytes ? Error('上传大小超过限制') : null, b);
        } });
        s.operation = (async () => {
            await fsp.mkdir(path.dirname(target), { recursive: true });
            await pipeline(req, counter, fs.createWriteStream(target, { flags: 'wx' }), { signal: s.controller.signal });
        })();
        try { await s.operation; s.bytes += size; s.files.add(file.toLowerCase()); }
        catch (e) { await fsp.unlink(target).catch(() => {}); throw e; }
        finally { s.operation = null; s.uploading = false; }
    }
    async walk(root, { supportedOnly = false } = {}) {
        const result = []; let count = 0, bytes = 0;
        const visit = async (dir, prefix = '') => {
            const entries = await fsp.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (++count > this.limits.files) fail('目录文件数量超过限制');
                if (entry.isSymbolicLink()) fail('数据集目录不能包含链接文件');
                const rel = relativePath(prefix + entry.name);
                if (entry.isDirectory()) await visit(path.join(dir, entry.name), rel + '/');
                else if (entry.isFile()) {
                    if (supportedOnly && !allowed(rel)) continue;
                    const stat = await fsp.stat(path.join(dir, entry.name)); bytes += stat.size;
                    if (bytes > this.limits.expandedBytes || stat.size > this.limits.fileBytes) fail('数据集大小超过限制');
                    result.push({ name: rel, size: stat.size });
                } else fail('数据集中存在非普通文件');
            }
        };
        await visit(root); return result;
    }
    summarize(files, captionExtension = '.txt') {
        if (!/^\.[a-zA-Z0-9]{1,12}$/.test(captionExtension)) fail('Caption 扩展名无效');
        const names = new Map(files.map(f => [f.name, f]));
        const images = files.filter(f => DATASET_IMAGE_EXTENSIONS.has(path.extname(f.name).toLowerCase()));
        const groups = new Map(); let missing = 0; const paired = new Set();
        for (const image of images) {
            const caption = image.name.slice(0, -path.extname(image.name).length) + captionExtension;
            image.caption = names.has(caption) ? caption : null;
            if (image.caption) paired.add(caption); else missing++;
            const dir = path.posix.dirname(image.name);
            groups.set(dir, (groups.get(dir) || 0) + 1);
        }
        const captions = files.filter(f => f.name.endsWith(captionExtension));
        return { images: images.length, captions: captions.length, missing, orphan: captions.filter(f => !paired.has(f.name)).length,
            bytes: files.reduce((sum, f) => sum + f.size, 0), groups: [...groups].map(([directory, images]) => ({ directory, images })).sort((a, b) => a.directory.localeCompare(b.directory)), entries: images };
    }
    startPrepare(s) {
        this.assertIdle(); if (s.phase !== 'uploading' || s.operation) fail('当前导入不可解压', 409);
        if (!s.files.size) fail('请先选择文件');
        s.phase = 'preparing';
        s.operation = this.prepare(s).then(summary => { if (s.phase !== 'cancelled') { s.summary = summary; s.phase = 'ready'; } })
            .catch(e => { if (s.phase !== 'cancelled') { s.error = e.message; s.phase = 'error'; } })
            .finally(() => { s.operation = null; s.touched = Date.now(); });
        return this.view(s);
    }
    async prepare(s) {
        const incoming = path.join(s.stage, 'incoming'), content = path.join(s.stage, 'content');
        const files = await this.walk(incoming);
        const archives = files.filter(f => archiveType(f.name)); let skipped = 0;
        const timer = setTimeout(() => s.controller.abort(), 30 * 60 * 1000); timer.unref();
        try {
            if (archives.length) {
                if (archives.length !== 1 || files.length !== 1) fail('每次请单独上传一个 ZIP / 7z；不能与其他文件混合');
                const archive = path.join(incoming, ...archives[0].name.split('/'));
                const kind = archiveType(archives[0].name);
                const password = '-p' + crypto.randomUUID();
                const result = await sevenZip(['l', '-slt', '-ba', '-sccUTF-8', '-t' + kind, password, '--', archive], { signal: s.controller.signal });
                const entries = parseArchiveList(result.text, this.limits);
                let total = 0;
                for (const entry of entries) {
                    if (s.controller.signal.aborted) fail('导入已取消或超时');
                    if (entry.directory) continue;
                    if (archiveType(entry.name)) fail('不支持嵌套压缩包，请展开后再上传');
                    if (!allowed(entry.name) || entry.name.split('/').includes('__MACOSX')) { skipped++; continue; }
                    const target = path.join(content, ...entry.name.split('/'));
                    await fsp.mkdir(path.dirname(target), { recursive: true });
                    // Only exact selected entries go to stdout. The archiver cannot create
                    // host paths, links, devices, ADS, or overwrite any existing dataset.
                    const output = await sevenZip(['x', '-so', '-y', '-bd', '-bsp0', '-bso0', '-bse2', '-spd', '-mmt=2', '-t' + kind,
                        password, '-i!' + entry.raw, '--', archive], { signal: s.controller.signal, output: target, maxBytes: Math.min(entry.size, this.limits.expandedBytes - total) });
                    if (output.size !== entry.size) fail('解压大小不匹配：' + entry.name);
                    total += output.size; s.processed = (s.processed || 0) + 1; s.touched = Date.now();
                }
            } else {
                for (const file of files) {
                    if (s.controller.signal.aborted) fail('导入已取消');
                    const target = path.join(content, ...file.name.split('/'));
                    await fsp.mkdir(path.dirname(target), { recursive: true });
                    await fsp.rename(path.join(incoming, ...file.name.split('/')), target);
                }
            }
            if (s.controller.signal.aborted) fail('导入已取消');
            const summary = this.summarize(await this.walk(content));
            if (!summary.images) fail('未找到可训练的图片，不能导入');
            const { entries, ...counts } = summary;
            return { ...counts, skipped };
        } finally { clearTimeout(timer); }
    }
    async commit(s) {
        this.assertIdle(); if (s.phase !== 'ready' || s.operation) fail('请等待检查完成后再导入', 409);
        s.phase = 'committing';
        const final = path.join(this.root, 'dataset-' + s.id);
        // UUID destination is new. Publishing never merges into a user's existing folder.
        s.operation = fsp.rename(path.join(s.stage, 'content'), final);
        try { await s.operation; }
        catch (e) { s.phase = 'ready'; throw e; }
        finally { s.operation = null; }
        s.phase = 'committed';
        const directories = s.summary.groups.map(g => ({ path: path.join(final, ...(g.directory === '.' ? [] : g.directory.split('/'))), images: g.images }));
        // A failed staging cleanup must not make a successfully published import look failed.
        await this.remove(s).catch(() => {}); return { directories, summary: s.summary };
    }
    async remove(s) {
        this.sessions.delete(s.id); s.phase = 'cancelled'; s.controller.abort();
        await s.operation?.catch(() => {});
        const resolved = path.resolve(s.stage);
        if (!inside(this.staging, resolved) || path.dirname(resolved) !== this.staging || !path.basename(resolved).startsWith('import-')) fail('临时目录路径异常');
        await fsp.rm(resolved, { recursive: true, force: true });
    }
    async expire() {
        for (const s of this.sessions.values()) if (Date.now() - s.touched > TTL) await this.remove(s);
        for (const [id, b] of this.bindings) if (Date.now() - b.touched > TTL) this.bindings.delete(id);
    }
    async bind(directory, { local = true } = {}) {
        const native = this.toNativePath(String(directory || '').trim().replace(/^"|"$/g, ''));
        if (!native || !path.isAbsolute(native)) fail('请输入服务器上的绝对目录路径');
        const root = await fsp.realpath(native);
        if (!(await fsp.stat(root)).isDirectory()) fail('路径不是目录');
        if (!local && !await this.isAuthorized(root)) fail('该服务器目录未获授权，请在训练机器 localhost 设置中授权根目录', 403);
        if (this.bindings.size >= 100) { await this.expire(); if (this.bindings.size >= 100) this.bindings.delete(this.bindings.keys().next().value); }
        const id = crypto.randomUUID(); this.bindings.set(id, { root, touched: Date.now() }); return { id, path: root };
    }
    binding(id) {
        const b = this.bindings.get(id); if (!b) fail('预览已过期，请重新打开', 404);
        b.touched = Date.now(); return b;
    }
    async boundPath(id, relative = '') {
        const b = this.binding(id);
        const target = relative ? path.join(b.root, ...relativePath(relative).split('/')) : b.root;
        // Check each component: links inside the root are not accepted either.
        let current = b.root;
        for (const part of path.relative(b.root, target).split(path.sep).filter(Boolean)) {
            current = path.join(current, part);
            if ((await fsp.lstat(current)).isSymbolicLink()) fail('不允许预览链接文件', 403);
        }
        const real = await fsp.realpath(target);
        if (!inside(b.root, real)) fail('预览路径超出数据集目录', 403);
        return real;
    }
    async list(id, { directory = '', query = '', missing = false, page = 0, captionExtension = '.txt', kind = 'images' } = {}) {
        const folder = await this.boundPath(id, directory);
        const children = await fsp.readdir(folder, { withFileTypes: true });
        if (children.length > this.limits.files) fail('目录条目超过限制，请按子目录浏览');
        const prefix = directory ? relativePath(directory) + '/' : '';
        const files = children.filter(e => e.isFile()).map(e => ({ name: e.name, size: 0 }));
        const summary = this.summarize(files, captionExtension);
        const entries = kind === 'captions' ? files.filter(f => /\.txt$/i.test(f.name)).map(f => ({ ...f, caption: f.name, kind: 'text' })) : summary.entries.map(f => ({ ...f, kind: 'image' }));
        const filtered = entries.filter(e => e.name.toLowerCase().includes(query.toLowerCase()) && (!missing || !e.caption)).sort((a, b) => a.name.localeCompare(b.name));
        const offset = Math.max(0, Math.floor(Number(page) || 0)) * this.limits.pageSize;
        return { directory, folders: children.filter(e => e.isDirectory()).map(e => ({ name: e.name, path: prefix + e.name })).sort((a, b) => a.name.localeCompare(b.name)),
            images: summary.images, captions: summary.captions, missing: summary.missing, orphan: summary.orphan, total: filtered.length,
            pageSize: this.limits.pageSize, items: filtered.slice(offset, offset + this.limits.pageSize).map(e => ({ name: e.name, kind: e.kind, path: prefix + e.name, caption: e.caption ? prefix + e.caption : null })) };
    }
    async thumbnail(target) {
        const stat = await fsp.stat(target);
        const key = target + ':' + stat.mtimeMs + ':' + stat.size;
        if (this.thumbnails.has(key)) {
            const cached = this.thumbnails.get(key); this.thumbnails.delete(key); this.thumbnails.set(key, cached); return cached;
        }
        if (this.thumbnailTasks.has(key)) return this.thumbnailTasks.get(key);
        if (this.thumbnailQueue.length >= 120) fail('缩略图队列繁忙，请稍后刷新', 429);
        const task = (async () => {
            if (this.thumbnailActive >= 2) await new Promise(resolve => this.thumbnailQueue.push(resolve));
            else this.thumbnailActive++;
            try {
                const sharp = require('sharp');
                const buffer = await sharp(target, { limitInputPixels: 64 * 1024 ** 2, animated: false })
                    .timeout({ seconds: 10 }).resize(256, 256, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 75 }).toBuffer();
                this.thumbnails.set(key, buffer);
                if (this.thumbnails.size > 128) this.thumbnails.delete(this.thumbnails.keys().next().value);
                return buffer;
            } finally {
                const next = this.thumbnailQueue.shift(); if (next) next(); else this.thumbnailActive--;
            }
        })();
        this.thumbnailTasks.set(key, task);
        try { return await task; } finally { this.thumbnailTasks.delete(key); }
    }
    mount(app) {
        app.use('/api/datasets', (req, res, next) => req.uiAccess || localRequest(req) ? next() : res.status(403).json({ error: '数据集文件管理需要已认证的同源访问' }));
        const route = fn => async (req, res) => { try { await fn(req, res); } catch (e) { if (!res.headersSent && !res.destroyed) res.status(e.status || 400).json({ error: e.message }); } };
        app.post('/api/datasets/imports', route(async (_req, res) => res.json(await this.create())));
        app.get('/api/datasets/imports/:id', route((req, res) => res.json(this.view(this.get(req.params.id)))));
        app.put('/api/datasets/imports/:id/file', route(async (req, res) => { await this.upload(this.get(req.params.id), req, req.query.path); res.json({ ok: true }); }));
        app.post('/api/datasets/imports/:id/prepare', route((req, res) => res.status(202).json(this.startPrepare(this.get(req.params.id)))));
        app.post('/api/datasets/imports/:id/commit', route(async (req, res) => res.json(await this.commit(this.get(req.params.id)))));
        app.delete('/api/datasets/imports/:id', route(async (req, res) => { const s = this.sessions.get(req.params.id); if (s?.phase === 'committing') fail('正在原子发布，请稍候', 409); if (s) await this.remove(s); res.json({ ok: true }); }));
        const localOnly = (req, res, next) => isLocalRequest(req) ? next() : res.status(403).json({ error: '目录授权仅限 localhost 管理' });
        app.get('/api/datasets/authorized-roots', localOnly, route(async (_req, res) => res.json({ roots: await this.authorizedRoots() })));
        app.post('/api/datasets/authorized-roots', localOnly, route(async (req, res) => res.json({ roots: await this.authorize(req.body?.path, req.body?.remove === true) })));
        app.post('/api/datasets/bind', route(async (req, res) => res.json(await this.bind(req.body?.path, { local: isLocalRequest(req) }))));
        app.use('/api/datasets/roots/:id', async (req, res, next) => {
            try {
                const b = this.binding(req.params.id);
                if (!isLocalRequest(req) && !await this.isAuthorized(b.root)) fail('目录授权已撤销或路径未授权', 403);
                next();
            } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
        });
        app.get('/api/datasets/roots/:id', route(async (req, res) => res.json(await this.list(req.params.id, { directory: req.query.directory, query: String(req.query.query || ''), missing: req.query.missing === 'true', page: req.query.page, captionExtension: req.query.captionExtension, kind: req.query.kind }))));
        app.get('/api/datasets/roots/:id/file', route(async (req, res) => {
            const target = await this.boundPath(req.params.id, req.query.path);
            if (!allowed(target) || !(await fsp.stat(target)).isFile()) fail('不支持预览该文件');
            res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" });
            if (/\.txt$/i.test(target)) {
                const handle = await fsp.open(target, 'r');
                try {
                    const stat = await handle.stat(); if (stat.size > this.limits.captionBytes) fail('TXT 超过 1 MiB，无法预览');
                    const buffer = Buffer.alloc(Math.min(stat.size, this.limits.captionBytes));
                    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
                    res.type('text/plain').send(buffer.subarray(0, bytesRead).toString('utf8'));
                } finally { await handle.close(); }
            } else if (req.query.thumbnail === 'true') {
                try {
                    const buffer = await this.thumbnail(target);
                    res.type('image/webp').send(buffer);
                } catch { fail('此格式无法生成缩略图，可尝试查看原图', 415); }
            } else res.type(MIME[path.extname(target).toLowerCase()]).sendFile(target, err => { if (err && !res.headersSent) res.status(404).end(); });
        }));
    }
    async dispose() { clearInterval(this.timer); for (const s of this.sessions.values()) await this.remove(s); }
}
module.exports = { DatasetLibrary, relativePath, parseArchiveList, LIMITS, inside };
