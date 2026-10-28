const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { execFileSync } = require('node:child_process');
const express = require('express');
const { DatasetLibrary, relativePath, parseArchiveList } = require('../lib/dataset-library');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWP4//8/AAX+Av5Y8msOAAAAAElFTkSuQmCC', 'base64');

async function fixture(t, options = {}) {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'trainer-dataset-test-'));
    const library = new DatasetLibrary({ root: path.join(temp, 'datasets'), ...options });
    t.after(async () => {
        await library.dispose();
        // Only the checked, freshly-created fixture directory may be recursively removed.
        assert.equal(path.dirname(temp), os.tmpdir());
        assert.match(path.basename(temp), /^trainer-dataset-test-/);
        await fs.rm(temp, { recursive: true, force: true });
    });
    return { temp, library };
}
async function put(library, s, name, data = PNG) { await library.upload(s, Readable.from([data]), name); }
async function ready(library, s) { library.startPrepare(s); await s.operation; assert.equal(s.phase, 'ready', s.error); }
async function apiFixture(t, options) {
    const f = await fixture(t, options), app = express(); app.use(express.json()); f.library.mount(app);
    const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.on('listening', r));
    t.after(() => new Promise(r => server.close(r)));
    return { ...f, base: `http://127.0.0.1:${server.address().port}/api/datasets` };
}
function zip(entries) {
    // Minimal ZIP writer for malicious path/link/duplicate fixtures; independent of 7-Zip.
    const locals = [], centrals = []; let offset = 0;
    for (const entry of entries) {
        const name = Buffer.from(entry.name), data = Buffer.from(entry.data || '');
        let crc = 0xffffffff;
        for (const byte of data) { crc ^= byte; for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1; }
        crc = (crc ^ 0xffffffff) >>> 0;
        const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50); l.writeUInt16LE(20, 4); l.writeUInt16LE(0x800, 6);
        l.writeUInt32LE(crc, 14); l.writeUInt32LE(data.length, 18); l.writeUInt32LE(data.length, 22); l.writeUInt16LE(name.length, 26);
        const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50); c.writeUInt16LE(0x314, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x800, 8);
        c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(name.length, 28);
        c.writeUInt32LE(((entry.mode || 0o100644) << 16) >>> 0, 38); c.writeUInt32LE(offset, 42);
        locals.push(l, name, data); centrals.push(c, name); offset += l.length + name.length + data.length;
    }
    const central = Buffer.concat(centrals), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, central, end]);
}

test('portable path validation rejects traversal, absolute paths, ADS and device names', () => {
    for (const name of ['../x.png', '/x.png', '\\server\\x.png', 'C:\\x.png', 'a/../x.txt', 'a//b.png', 'a.txt:stream', 'NUL.png', 'x./a.txt', 'a\n.txt']) assert.throws(() => relativePath(name));
    assert.equal(relativePath('人物\\子集\\图 01.png'), '人物/子集/图 01.png');
});
test('archive manifest rejects duplicates, encryption, links, unsafe names and bombs', () => {
    const item = (name, rest = '') => `Path = ${name}\nSize = 10\nFolder = -\n${rest}`;
    for (const text of [item('../x.png'), item('a.png') + '\n' + item('A.png'), item('a.png', 'Encrypted = +\n'), item('a.png', 'Symbolic Link = ../x\n'), item('a.png', 'garbage\n')]) assert.throws(() => parseArchiveList(text));
    assert.throws(() => parseArchiveList(item('a.png'), { fileBytes: 5, files: 10, expandedBytes: 100 }));
    assert.throws(() => parseArchiveList(item('a.png') + '\n' + item('b.png'), { fileBytes: 10, files: 10, expandedBytes: 15 }));
});
test('folder import keeps image-caption pairs, creates independent subset paths and never overwrites a source', async t => {
    const { library } = await fixture(t);
    const { id } = await library.create(), s = library.get(id);
    await put(library, s, '人物/one/a.png'); await put(library, s, '人物/one/a.txt', '角色, 白色背景');
    await put(library, s, '人物/two/b.webp'); await put(library, s, '人物/two/orphan.txt', '<script>not html</script>');
    await assert.rejects(put(library, s, '人物/ONE/A.PNG'), /重复/);
    await ready(library, s);
    assert.deepEqual([s.summary.images, s.summary.captions, s.summary.missing, s.summary.orphan], [2, 2, 1, 1]);
    const published = await library.commit(s);
    assert.equal(published.directories.length, 2); assert.equal(library.sessions.size, 0);
    assert.equal(await fs.readFile(path.join(published.directories[0].path, 'a.txt'), 'utf8'), '角色, 白色背景');
    assert.deepEqual(await fs.readdir(library.staging), []);
    const binding = await library.bind(published.directories[0].path);
    const list = await library.list(binding.id); assert.equal(list.items[0].caption, 'a.txt');
    assert.equal((await library.list(binding.id, { missing: true })).items.length, 0);
    assert.equal((await library.list(binding.id, { kind: 'captions' })).items[0].kind, 'text');
});
for (const type of ['zip', '7z']) test(`real ${type.toUpperCase()} extraction preserves unicode and nested folders`, async t => {
    const { library, temp } = await fixture(t);
    const source = path.join(temp, 'source'); await fs.mkdir(path.join(source, '训练图'), { recursive: true });
    await fs.writeFile(path.join(source, '训练图', 'a.png'), PNG); await fs.writeFile(path.join(source, '训练图', 'a.txt'), '中文 Caption');
    await fs.writeFile(path.join(source, 'ignore.json'), '{}');
    const archive = path.join(temp, 'dataset.' + type);
    execFileSync(require('7zip-bin-full').path7z, ['a', '-t' + type, archive, '.'], { cwd: source, windowsHide: true, stdio: 'pipe' });
    const s = library.get((await library.create()).id); await put(library, s, 'dataset.' + type, await fs.readFile(archive));
    await ready(library, s); assert.equal(s.summary.images, 1); assert.equal(s.summary.skipped, 1);
    const result = await library.commit(s); assert.equal(result.directories.length, 1);
    assert.deepEqual(await fs.readFile(path.join(result.directories[0].path, 'a.png')), PNG);
    assert.equal(await fs.readFile(path.join(result.directories[0].path, 'a.txt'), 'utf8'), '中文 Caption');
});
test('ZIP traversal, links, case collisions and nested archives fail without publishing', async t => {
    const { library, temp } = await fixture(t);
    const fixtures = [ [{ name: '../escaped.png', data: PNG }], [{ name: 'a.png', data: '../escaped', mode: 0o120777 }],
        [{ name: 'a.png' }, { name: 'A.png' }], [{ name: 'nested.7z' }, { name: 'a.png' }] ];
    for (const entries of fixtures) {
        const s = library.get((await library.create()).id); await put(library, s, 'bad.zip', zip(entries));
        library.startPrepare(s); await s.operation; assert.equal(s.phase, 'error', JSON.stringify(entries));
        await assert.rejects(library.commit(s)); await library.remove(s);
    }
    assert.deepEqual(await fs.readdir(library.root), ['.staging']);
    await assert.rejects(fs.stat(path.join(temp, 'escaped.png')));
});
test('encrypted / corrupt archives and unsupported empty datasets are actionable failures', async t => {
    const { library, temp } = await fixture(t);
    await fs.writeFile(path.join(temp, 'a.png'), PNG);
    const archive = path.join(temp, 'encrypted.7z');
    execFileSync(require('7zip-bin-full').path7z, ['a', '-psecret', '-mhe=on', archive, path.join(temp, 'a.png')], { windowsHide: true, stdio: 'pipe' });
    for (const [name, data] of [['bad.zip', Buffer.from('not zip')], ['encrypted.7z', await fs.readFile(archive)], ['a.txt', Buffer.from('only caption')]]) {
        const s = library.get((await library.create()).id); await put(library, s, name, data);
        library.startPrepare(s); await s.operation; assert.equal(s.phase, 'error'); assert.ok(s.error); await library.remove(s);
    }
});
test('upload and extraction quotas, concurrent mutation and training locks are enforced', async t => {
    let busy = false;
    const { library } = await fixture(t, { isBusy: () => busy, limits: { fileBytes: 100, uploadBytes: 120, expandedBytes: 100, files: 5 } });
    const s = library.get((await library.create()).id);
    await assert.rejects(put(library, s, 'big.png', Buffer.alloc(101)), /大小/);
    const first = put(library, s, 'one.png', Buffer.alloc(70));
    await assert.rejects(put(library, s, 'two.png', Buffer.alloc(70)), /不可上传/); await first;
    await assert.rejects(put(library, s, 'two.png', Buffer.alloc(70)), /大小/);
    busy = true; await assert.rejects(library.create(), /训练/); assert.throws(() => library.startPrepare(s), /训练/);
    busy = false; await ready(library, s); busy = true; await assert.rejects(library.commit(s), /训练/);
    busy = false; await library.remove(s); assert.deepEqual(await fs.readdir(library.staging), []);
});
test('cancelled uploads and failed preparations remove staging data; sessions expire', async t => {
    const { library } = await fixture(t);
    const s = library.get((await library.create()).id);
    const stream = new Readable({ read() {} }); stream.push(PNG);
    const pending = library.upload(s, stream, 'a.png'); pending.catch(() => {});
    await library.remove(s); await assert.rejects(pending);
    await assert.rejects(fs.stat(s.stage)); assert.throws(() => library.get(s.id));
    const expired = library.get((await library.create()).id); expired.touched = 0; await library.expire();
    await assert.rejects(fs.stat(expired.stage));
});
test('startup cleans only generated staging directories older than 24h, not datasets or fresh uploads', async t => {
    const { library } = await fixture(t);
    await fs.mkdir(library.staging, { recursive:true });
    const old = path.join(library.staging, 'import-old123'), fresh = path.join(library.staging, 'import-new123');
    const unrelated = path.join(library.staging, 'user-folder'), published = path.join(library.root, 'dataset-keep');
    for (const dir of [old, fresh, unrelated, published]) await fs.mkdir(dir);
    const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000); await fs.utimes(old, yesterday, yesterday); await fs.utimes(unrelated, yesterday, yesterday);
    await library.initialize(); await assert.rejects(fs.stat(old));
    for (const dir of [fresh, unrelated, published]) assert.equal((await fs.stat(dir)).isDirectory(), true);
});
test('HTTP endpoints gate origins, stream uploads, paginate, render image/TXT safely and deny escapes', async t => {
    const { base, library, temp } = await apiFixture(t, { limits: { pageSize: 1, captionBytes: 10 } });
    const post = (suffix, body, headers = {}) => fetch(base + suffix, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body || {}) });
    assert.equal((await post('/imports', {}, { Origin: 'https://evil.example' })).status, 403);
    const badHostStatus = await new Promise((resolve, reject) => {
        const request = require('node:http').request(base + '/imports', { method: 'POST', headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); });
        request.on('error', reject); request.end();
    });
    assert.equal(badHostStatus, 403);
    const session = await (await post('/imports')).json();
    for (const [name, body] of [['a.png', PNG], ['a.txt', '<b>x</b>'], ['b.jpg', PNG], ['large.txt', 'x'.repeat(11)]]) {
        const result = await fetch(`${base}/imports/${session.id}/file?path=${name}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body }); assert.equal(result.status, 200);
    }
    assert.equal((await post(`/imports/${session.id}/prepare`)).status, 202); await library.get(session.id).operation;
    const imported = await (await post(`/imports/${session.id}/commit`)).json();
    const binding = await (await post('/bind', { path: imported.directories[0].path })).json();
    const root = `${base}/roots/${binding.id}`;
    const page = await (await fetch(root)).json(); assert.equal(page.total, 2); assert.equal(page.items.length, 1);
    assert.equal((await (await fetch(root + '?page=1')).json()).items[0].name, 'b.jpg');
    const txt = await fetch(root + '/file?path=a.txt'); assert.match(txt.headers.get('content-type'), /text\/plain/); assert.equal(await txt.text(), '<b>x</b>'); assert.equal(txt.headers.get('x-content-type-options'), 'nosniff');
    assert.equal((await fetch(root + '/file?path=large.txt')).status, 400);
    const thumb = await fetch(root + '/file?path=a.png&thumbnail=true'); assert.equal(thumb.status, 200, await thumb.clone().text()); assert.match(thumb.headers.get('content-type'), /image\/webp/);
    const image = await fetch(root + '/file?path=a.png'); assert.deepEqual(Buffer.from(await image.arrayBuffer()), PNG);
    assert.equal((await fetch(root + '/file?path=..%2Fsecret.txt')).status, 400);
    assert.equal((await fetch(root + '?directory=..')).status, 400);
    await fs.writeFile(path.join(temp, 'secret.txt'), 'secret');
    try { await fs.symlink(path.join(temp, 'secret.txt'), path.join(imported.directories[0].path, 'link.txt')); }
    catch (e) { if (!['EPERM', 'EACCES'].includes(e.code)) throw e; return; }
    assert.equal((await fetch(root + '/file?path=link.txt')).status, 403);
});
