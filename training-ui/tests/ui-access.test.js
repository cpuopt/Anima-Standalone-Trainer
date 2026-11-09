const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const express = require('express');
const WebSocket = require('ws');
const { once } = require('node:events');
const { UiAccess } = require('../lib/ui-access');
const { DatasetLibrary } = require('../lib/dataset-library');
const { mountFrontend } = require('../lib/frontend');
const { tensorboardProxy } = require('../lib/tensorboard-proxy');

async function fixture(t) {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'trainer-access-'));
    let time = Date.now();
    const file = path.join(temp, 'access-code'), access = new UiAccess({ file, now: () => time });
    const datasets = new DatasetLibrary({ root: path.join(temp, 'datasets') });
    const app = express(); access.mount(app);
    app.use('/tensorboard/:jobKey', tensorboardProxy(() => null));
    app.use(express.json()); datasets.mount(app);
    const dist = path.join(temp, 'dist'), legacy = path.join(temp, 'legacy');
    fs.mkdirSync(dist); fs.mkdirSync(legacy);
    fs.writeFileSync(path.join(dist, 'index.html'), '<h1>private app</h1>');
    fs.writeFileSync(path.join(dist, 'app.js'), 'private-code');
    fs.writeFileSync(path.join(legacy, 'private.txt'), 'private-file');
    mountFrontend(app, dist, legacy);
    app.get('/api/private', (_req, res) => res.json({ private: true }));
    app.post('/api/private', (_req, res) => res.json({ saved: true }));
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const port = server.address().port, host = `studio.local:${port}`, origin = 'http://' + host;
    const wss = new WebSocket.Server({ server, verifyClient: ({ req }) => access.websocketAllowed(req) });
    wss.on('connection', (socket, req) => access.track(socket, req));
    t.after(async () => {
        access.dispose(); for (const socket of wss.clients) socket.terminate();
        await new Promise(resolve => wss.close(resolve)); await new Promise(resolve => server.close(resolve)); await datasets.dispose();
        assert.equal(path.dirname(temp), os.tmpdir()); assert.match(path.basename(temp), /^trainer-access-/);
        fs.rmSync(temp, { recursive: true, force: true });
    });
    const request = (url, { method = 'GET', body, cookie, local = false, headers = {} } = {}) => new Promise((resolve, reject) => {
        const h = { Host: local ? `localhost:${port}` : host, ...headers };
        if (cookie) h.Cookie = cookie;
        if (body !== undefined) { h['Content-Type'] ||= 'application/json'; body = typeof body === 'string' ? body : JSON.stringify(body); h['Content-Length'] = Buffer.byteLength(body); }
        const req = http.request({ hostname: '127.0.0.1', port, path: url, method, headers: h }, res => {
            const chunks = []; res.on('data', b => chunks.push(b)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString(), json() { return JSON.parse(this.text); } }));
        }); req.on('error', reject); req.end(body);
    });
    const password = 'fixture-password';
    const login = async () => {
        const setup = !access.passwordHash;
        const result = await request('/api/access/' + (setup ? 'setup' : 'login'), { method: 'POST', body: { password, confirmPassword: password }, headers: { Origin: origin } });
        assert.equal(result.status, 200); return result.headers['set-cookie'][0].split(';')[0];
    };
    return { temp, access, datasets, request, login, host, origin, port, file, password, advance: ms => { time += ms; access.sweep(); } };
}

test('all pages, APIs, static files, legacy and TensorBoard are gated before their handlers', async t => {
    const { request, login } = await fixture(t);
    for (const url of ['/ui/', '/ui/app.js', '/legacy/private.txt', '/tensorboard/job/', '/api/private']) {
        const denied = await request(url); assert.equal(denied.status, url.startsWith('/api/') ? 401 : 302); assert.doesNotMatch(denied.text, /private-code|private-file|private app/);
    }
    const cookie = await login();
    assert.match((await request('/ui/', { cookie })).text, /private app/);
    const asset = await request('/ui/app.js', { cookie }); assert.equal(asset.text, 'private-code'); assert.equal(asset.headers['cache-control'], 'private, no-store');
    assert.equal((await request('/legacy/private.txt', { cookie })).text, 'private-file');
    assert.notEqual((await request('/tensorboard/job/', { cookie })).status, 401);
    assert.equal((await request('/api/private', { cookie })).status, 200);
});
test('localhost also requires authentication and ignores forwarded headers', async t => {
    const { request, origin } = await fixture(t);
    assert.equal((await request('/api/private', { local: true })).status, 401);
    assert.equal((await request('/api/private', { headers: { 'X-Forwarded-For': '127.0.0.1', 'X-Forwarded-Host': 'localhost' } })).status, 401);
    assert.equal((await request('/api/private', { local: true, headers: { Origin: origin } })).status, 403);
    assert.equal((await request('/api/private', { local: true, headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    const status = (await request('/api/access/status', { local: true })).json(); assert.equal(status.local, true); assert.equal(status.authenticated, false); assert.equal(status.setupRequired, true);
});
test('login uses HttpOnly Strict cookies, process lifetime sessions, same-origin writes and logout', async t => {
    const { request, origin, access, advance, login, password } = await fixture(t);
    await login();
    const result = await request('/api/access/login', { method: 'POST', body: { password }, headers: { Origin: origin } });
    const setCookie = result.headers['set-cookie'][0], cookie = setCookie.split(';')[0];
    assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /SameSite=Strict/); assert.doesNotMatch(setCookie, /Max-Age|Expires/i); assert.doesNotMatch(setCookie, /Secure/);
    assert.equal((await request('/api/private', { method: 'POST', cookie, body: {} })).status, 403);
    assert.equal((await request('/api/private', { method: 'POST', cookie, body: {}, headers: { Origin: origin } })).status, 200);
    assert.equal((await request('/api/private', { method: 'POST', cookie, body: {}, headers: { Origin: 'https://evil.example' } })).status, 403);
    access.secureCookies = true;
    assert.match((await request('/api/access/login', { method: 'POST', body: { password }, headers: { Origin: origin } })).headers['set-cookie'][0], /; Secure/);
    advance(365 * 24 * 60 * 60 * 1000); assert.equal((await request('/api/private', { cookie })).status, 200);
    const relogin = await request('/api/access/login', { method: 'POST', body: { password }, headers: { Origin: origin } });
    const nextCookie = relogin.headers['set-cookie'][0].split(';')[0];
    assert.equal((await request('/api/access/logout', { method: 'POST', cookie: nextCookie, headers: { Origin: origin } })).status, 200);
    assert.equal((await request('/api/private', { cookie: nextCookie })).status, 401);
});
test('first visit sets a process-only password, rejects replacement and validates confirmation', async t => {
    const { request, login, password, file, origin } = await fixture(t);
    const page = await request('/login', { local: true }); assert.match(page.text, /confirmPassword/);
    const setup = body => request('/api/access/setup', { method: 'POST', body, headers: { Origin: origin } });
    assert.equal((await setup({ password: '', confirmPassword: '' })).status, 400);
    assert.equal((await setup({ password, confirmPassword: 'different' })).status, 400);
    const results = await Promise.all([setup({password, confirmPassword:password}), setup({password:'other', confirmPassword:'other'})]);
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    assert.equal((await request('/api/access/status')).json().setupRequired, false);
    const cookie = await login();
    assert.equal((await request('/api/private', {local:true, cookie})).status, 200);
    assert.equal((await request('/api/access/code', {local:true, cookie})).status, 404);
    assert.equal((await request('/api/access/reset', {local:true, cookie, method:'POST'})).status, 404);
    assert.equal(fs.existsSync(file), false);
    fs.writeFileSync(file, 'legacy-persisted-code');
    const restarted = new UiAccess({file}); t.after(() => restarted.dispose());
    assert.equal(restarted.passwordHash, null);
    assert.equal(restarted.identity({headers:{host:'localhost',cookie}, socket:{remoteAddress:'127.0.0.1'}}), null);
});

test('localhost can set a password and form login is throttled without expiring the password', async t => {
    const { request, password, origin, advance } = await fixture(t);
    assert.equal((await request('/api/access/setup', {local:true, method:'POST', body:{password,confirmPassword:password}})).status, 200);
    for (let i = 0; i < 5; i++) assert.equal((await request('/api/access/login', { method:'POST', body:{password:'wrong'}, headers:{Origin:origin} })).status, 401);
    assert.equal((await request('/api/access/login', {method:'POST', body:{password}, headers:{Origin:origin}})).status, 429);
    advance(15 * 60000 + 1);
    const form = await request('/api/access/login', {method:'POST', body:'password='+password, headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded'}});
    assert.equal(form.status, 303); assert.equal(form.headers.location, '/ui/');
});

test('WebSocket upgrades require a session and same-origin; logout closes existing connections', async t => {
    const { port, host, origin, login, request } = await fixture(t);
    const connect = headers => new Promise(resolve => {
        const socket = new WebSocket(`ws://127.0.0.1:${port}/`, { headers, handshakeTimeout: 2000 });
        socket.once('open', () => resolve(socket)); socket.once('error', () => resolve(null));
    });
    assert.equal(await connect({ Host: host, Origin: origin }), null);
    const cookie = await login();
    assert.equal(await connect({ Host: host, Cookie: cookie, Origin: 'http://evil.example' }), null);
    assert.equal(await connect({ Host: host, Cookie: cookie }), null);
    const socket = await connect({ Host: host, Cookie: cookie, Origin: origin }); assert.ok(socket);
    const closed = once(socket, 'close');
    await request('/api/access/logout', { method: 'POST', cookie, headers:{Origin:origin} });
    assert.equal((await closed)[0], 4001);
});
test('LAN directory access requires local authorization, revocation is immediate and imports remain available', async t => {
    const { temp, request, login, origin } = await fixture(t), cookie = await login();
    const folder = path.join(temp, 'private'); fs.mkdirSync(folder); fs.writeFileSync(path.join(folder, 'a.txt'), 'hello');
    const post = (url, body, local = false) => request(url, { method: 'POST', body, cookie, local, headers: local ? {} : { Origin: origin } });
    assert.equal((await post('/api/datasets/bind', { path: folder })).status, 403);
    assert.equal((await post('/api/datasets/authorized-roots', { path: folder })).status, 403);
    assert.equal((await post('/api/datasets/authorized-roots', { path: folder }, true)).status, 200);
    const binding = (await post('/api/datasets/bind', { path: folder })).json();
    assert.equal((await request(`/api/datasets/roots/${binding.id}/file?path=a.txt`, { cookie })).text, 'hello');
    assert.equal((await post('/api/datasets/authorized-roots', { path: folder, remove: true }, true)).status, 200);
    assert.equal((await request(`/api/datasets/roots/${binding.id}/file?path=a.txt`, { cookie })).status, 403);
    assert.equal((await post('/api/datasets/imports')).status, 200);
});
