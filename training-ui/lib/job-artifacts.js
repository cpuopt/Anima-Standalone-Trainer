const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const MODELS = new Set(['.safetensors', '.ckpt', '.pt', '.pth', '.bin']);
const IMAGES = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.avif', '.jxl']);
const PAGE_SIZE = 40, MAX_ENTRIES = 20000;
function fail(message, status = 400) { const error = Error(message); error.status = status; throw error; }
function within(root, target) { const rel = path.relative(root, target); return !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep); }
function progressLabel(filename) {
    const base = filename.replace(/\.[^.]+$/, '');
    const step = base.match(/(?:[-_]step|[-_]s)(\d+)(?:[-_]|$)/i);
    if (step) return { step: Number(step[1]), label: `Step ${Number(step[1])}` };
    const epoch = base.match(/(?:[-_]epoch|[-_]e)(\d+)(?:[-_]|$)/i) || base.match(/-(\d{6})$/);
    if (epoch) return { epoch: Number(epoch[1]), label: `Epoch ${Number(epoch[1])}` };
    return { label: '未标注轮次 / 最终产出' };
}
class JobArtifacts {
    constructor({ jobsDir, isRunning = () => false, thumbnail }) {
        this.jobsDir = path.resolve(jobsDir); this.isRunning = isRunning; this.thumbnail = thumbnail;
    }
    async job(name) {
        if (typeof name !== 'string' || !name.trim() || name === '.' || name === '..' || /[\x00-\x1f<>:"/\\|?*]/.test(name) || /[. ]$/.test(name)) fail('任务名称无效');
        const job = path.resolve(this.jobsDir, name);
        if (path.dirname(job) !== this.jobsDir) fail('任务路径越界', 403);
        const stat = await fsp.lstat(job).catch(() => fail('任务不存在', 404));
        if (!stat.isDirectory() || stat.isSymbolicLink()) fail('任务目录不可访问', 403);
        const root = await fsp.realpath(this.jobsDir), real = await fsp.realpath(job);
        if (!within(root, real)) fail('任务路径越界', 403);
        return real;
    }
    async target(name, relative) {
        const root = await this.job(name);
        if (typeof relative !== 'string' || relative.length > 2000) fail('产出路径无效');
        const parts = relative.split('/');
        if (!['output', 'samples'].includes(parts[0]) || parts.length < 2 || parts.some(p => !p || p === '.' || p === '..' || /[\\\x00-\x1f<>:"|?*]/.test(p) || /[. ]$/.test(p))) fail('产出路径越界', 403);
        const extension = path.extname(relative).toLowerCase();
        if (!IMAGES.has(extension) && !(parts[0] === 'output' && MODELS.has(extension))) fail('不支持的产出文件类型', 403);
        let current = root;
        for (const part of parts) {
            current = path.join(current, part);
            const stat = await fsp.lstat(current).catch(() => fail('文件已移除，请刷新列表', 404));
            if (stat.isSymbolicLink()) fail('不允许访问链接产出', 403);
        }
        const real = await fsp.realpath(current);
        if (!within(root, real) || !(await fsp.stat(real)).isFile()) fail('文件不可访问', 403);
        return real;
    }
    async list(name, { kind = 'models', query = '', page = 0, source = 'all' } = {}) {
        if (!['models', 'samples'].includes(kind)) fail('产出类型无效');
        const root = await this.job(name), files = []; let visited = 0, truncated = false;
        const walk = async (directory, relative, depth = 0) => {
            if (depth > 16) { truncated = true; return; }
            let entries;
            try { entries = await fsp.opendir(directory); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
            for await (const entry of entries) {
                if (++visited > MAX_ENTRIES) { truncated = true; break; }
                if (entry.isSymbolicLink()) continue;
                const rel = relative + '/' + entry.name, full = path.join(directory, entry.name);
                if (entry.isDirectory()) {
                    // Training optimizer/resume states and TensorBoard events are not model exports.
                    if (/(?:^|[-_])state$/i.test(entry.name) || ['tensorboard', 'logs'].includes(entry.name)) continue;
                    await walk(full, rel, depth + 1);
                } else if (entry.isFile()) {
                    const extension = path.extname(entry.name).toLowerCase();
                    const type = IMAGES.has(extension) ? 'samples' : relative.startsWith('output') && MODELS.has(extension) ? 'models' : null;
                    if (!type) continue;
                    let stat; try { stat = await fsp.stat(full); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
                    files.push({ kind: type, name: entry.name, path: rel, size: stat.size, mtime: stat.mtimeMs,
                        version: `${stat.size}:${stat.mtimeMs}`, ready: stat.size > 0 && Date.now() - stat.mtimeMs >= 2000,
                        source: rel.startsWith('samples/') ? 'generation' : 'training', ...progressLabel(entry.name) });
                }
                if (truncated && visited > MAX_ENTRIES) break;
            }
        };
        for (const dir of ['output', 'samples']) {
            const full = path.join(root, dir);
            const stat = await fsp.lstat(full).catch(e => { if (e.code !== 'ENOENT') throw e; return null; });
            if (stat?.isDirectory() && !stat.isSymbolicLink()) await walk(full, dir);
        }
        const filtered = files.filter(f => f.kind === kind && (source === 'all' || f.source === source) && f.path.toLowerCase().includes(String(query).toLowerCase())).sort((a, b) => b.mtime - a.mtime || b.name.localeCompare(a.name, undefined, { numeric: true }));
        const offset = Math.max(0, Math.floor(Number(page) || 0)) * PAGE_SIZE;
        return { items: filtered.slice(offset, offset + PAGE_SIZE), total: filtered.length, pageSize: PAGE_SIZE,
            models: files.filter(f => f.kind === 'models').length, samples: files.filter(f => f.kind === 'samples').length,
            running: this.isRunning(name), truncated };
    }
    async header(handle, stat) {
        const prefix = Buffer.alloc(8); const first = await handle.read(prefix, 0, 8, 0);
        if (first.bytesRead !== 8) fail('模型头不完整，文件可能仍在保存');
        const length = prefix.readBigUInt64LE();
        if (length < 2n || length > 8n * 1024n * 1024n || length + 8n > BigInt(stat.size)) fail('模型头不完整、过大或格式无效；请等待保存完成后重试');
        const buffer = Buffer.alloc(Number(length)), read = await handle.read(buffer, 0, buffer.length, 8);
        if (read.bytesRead !== buffer.length) fail('模型仍在变化，请刷新后重试', 409);
        let data; try { data = JSON.parse(buffer.toString('utf8')); } catch { fail('模型头无法解析，文件可能尚未保存完成'); }
        if (!data || typeof data !== 'object' || Array.isArray(data)) fail('无效的 Safetensors 头');
        const tensors = Object.entries(data).filter(([key]) => key !== '__metadata__');
        return { metadata: data.__metadata__ || {}, tensorCount: tensors.length,
            tensors: tensors.slice(0, 100).map(([name, value]) => ({ name, dtype: value?.dtype, shape: value?.shape })), tensorsTruncated: tensors.length > 100 };
    }
    async opened(name, relative, version) {
        const target = await this.target(name, relative);
        const handle = await fsp.open(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
        try {
            const stat = await handle.stat();
            if (!stat.isFile()) fail('文件不可访问', 403);
            if (!stat.size || Date.now() - stat.mtimeMs < 2000 || version && version !== `${stat.size}:${stat.mtimeMs}`) fail('产出正在写入或已变化，请稍后刷新再试', 409);
            return { target, handle, stat };
        } catch (e) { await handle.close(); throw e; }
    }
    mount(app) {
        const route = fn => async (req, res) => { try { await fn(req, res); } catch (e) { if (!res.headersSent) res.status(e.status || 400).json({ error: e.message }); } };
        app.get('/api/jobs/:name/artifacts', route(async (req, res) => res.json(await this.list(req.params.name, req.query))));
        app.get('/api/jobs/:name/artifacts/preview', route(async (req, res) => {
            const file = await this.opened(req.params.name, req.query.path, req.query.version);
            try {
                const details = path.extname(file.target).toLowerCase() === '.safetensors' ? await this.header(file.handle, file.stat) :
                    { metadata: {}, tensorCount: null, tensors: [], note: '此格式仅预览文件信息，不加载或反序列化权重。' };
                res.json({ name: path.basename(file.target), size: file.stat.size, mtime: file.stat.mtimeMs, ...details });
            } finally { await file.handle.close(); }
        }));
        app.get('/api/jobs/:name/artifacts/file', route(async (req, res) => {
            const file = await this.opened(req.params.name, req.query.path, req.query.version);
            const image = IMAGES.has(path.extname(file.target).toLowerCase());
            res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
            if (req.query.thumbnail === 'true' && image && this.thumbnail) {
                try { res.type('image/webp').send(await this.thumbnail(file.target)); }
                catch { fail('无法生成缩略图，请查看原图', 415); }
                finally { await file.handle.close(); }
                return;
            }
            // Stream the already opened descriptor: no whole-model buffering or second path lookup.
            const extension = path.extname(file.target).toLowerCase();
            const mime = { '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.bmp':'image/bmp', '.avif':'image/avif', '.jxl':'image/jxl' };
            res.type(image ? mime[extension] : 'application/octet-stream');
            if (req.query.download === 'true' || !image) res.attachment(path.basename(file.target));
            res.set('Content-Length', String(file.stat.size));
            const stream = file.handle.createReadStream({ autoClose: true, start: 0, end: file.stat.size - 1 });
            stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res);
        }));
    }
}
module.exports = { JobArtifacts, progressLabel };
