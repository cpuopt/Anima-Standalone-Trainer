const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const COOKIE = 'anima_ui_session';
const SESSION_MS = 12 * 60 * 60 * 1000;
function originMatches(req) {
    try {
        if (!req.headers.host || /[\s,@/\\]/.test(req.headers.host)) return false;
        const host = new URL('http://' + req.headers.host);
        if (host.host !== req.headers.host.toLowerCase()) return false;
        if (req.headers['sec-fetch-site'] === 'cross-site') return false;
        if (!req.headers.origin) return true;
        const origin = new URL(req.headers.origin);
        // Scheme may differ behind an HTTPS terminator; never trust forwarded IP/host headers.
        return ['http:', 'https:'].includes(origin.protocol) && origin.host === host.host;
    } catch { return false; }
}
function localRequest(req) {
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) || !originMatches(req)) return false;
    try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL('http://' + req.headers.host).hostname); }
    catch { return false; }
}
class UiAccess {
    constructor({ file, now = Date.now, secureCookies = process.env.ANIMA_UI_SECURE_COOKIES === '1' }) {
        this.file = file; this.now = now; this.secureCookies = secureCookies;
        this.sessions = new Map(); this.attempts = new Map(); this.sockets = new Map();
        fs.mkdirSync(path.dirname(file), { recursive: true });
        if (fs.existsSync(file)) {
            if (fs.lstatSync(file).isSymbolicLink()) throw Error('Access-code file cannot be a symbolic link');
            this.code = fs.readFileSync(file, 'utf8').trim();
            if (!/^[a-f0-9]{48}$/.test(this.code)) throw Error('Invalid UI access-code file; remove it locally to regenerate');
        } else this.rotate();
        this.timer = setInterval(() => this.sweep(), 60000); this.timer.unref();
    }
    rotate() {
        const code = crypto.randomBytes(24).toString('hex');
        const temp = this.file + '.' + crypto.randomUUID() + '.tmp';
        fs.writeFileSync(temp, code + '\n', { mode: 0o600, flag: 'wx' });
        try { fs.renameSync(temp, this.file); } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
        this.code = code; this.sessions.clear(); this.attempts.clear();
        for (const socket of this.sockets.keys()) socket.close(4001, 'Access code reset');
    }
    sessionId(req) {
        const match = String(req.headers.cookie || '').match(/(?:^|;\s*)anima_ui_session=([a-f0-9]{64})(?:;|$)/);
        return match?.[1];
    }
    identity(req) {
        if (!originMatches(req)) return null;
        if (localRequest(req)) return { local: true, expiresAt: null };
        const id = this.sessionId(req), expiresAt = this.sessions.get(id);
        if (!expiresAt || expiresAt <= this.now()) { if (id) this.sessions.delete(id); return null; }
        return { local: false, expiresAt };
    }
    cookie(req, value, maxAge = SESSION_MS / 1000) {
        return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${this.secureCookies || req.socket.encrypted ? '; Secure' : ''}`;
    }
    sweep() {
        for (const [id, expiry] of this.sessions) if (expiry <= this.now()) this.sessions.delete(id);
        for (const [ip, entry] of this.attempts) if (entry.until <= this.now()) this.attempts.delete(ip);
        for (const [socket, req] of this.sockets) if (!this.identity(req)) socket.close(4001, 'Session expired');
    }
    track(socket, req) { this.sockets.set(socket, req); socket.once('close', () => this.sockets.delete(socket)); }
    websocketAllowed(req) { return !!this.identity(req) && (localRequest(req) || !!req.headers.origin); }
    loginPage(message = '') {
        const nonce = crypto.randomBytes(16).toString('hex');
        return { nonce, html: `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Training Studio · 登录</title><style nonce="${nonce}">body{color:#e6edf3;background:#0d1117;font:16px system-ui;display:grid;place-items:center;min-height:95vh;margin:0}main{max-width:400px;padding:32px;border:1px solid #30363d;border-radius:16px}input,button{box-sizing:border-box;width:100%;padding:12px;margin-top:16px;border:1px solid #505967;border-radius:8px;background:#161b22;color:inherit}button{background:#345bc7;cursor:pointer}p{color:#9ba8b8;line-height:1.6}.error{color:#ff9c9c}</style><main><h1>Training Studio</h1><p>请输入训练机器上的共享访问码。可在本机 localhost 界面的「全局设置 → 局域网访问」中查看。</p><form method="post" action="/api/access/login"><label for="code">共享访问码</label><input id="code" name="code" type="password" autocomplete="current-password" required maxlength="128" autofocus><button type="submit">登录</button></form><p class="error" role="alert">${message}</p><p>仅用于可信局域网。非可信网络请使用 HTTPS；访问码等同训练控制权限。</p></main></html>` };
    }
    page(res, status = 200, message = '') {
        const { nonce, html } = this.loginPage(message);
        return res.status(status).set({ 'Cache-Control': 'no-store', 'Content-Security-Policy': `default-src 'none'; style-src 'nonce-${nonce}'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`, 'X-Content-Type-Options': 'nosniff' }).type('html').send(html);
    }
    mount(app) {
        const sameOrigin = (req, res, next) => originMatches(req) && (localRequest(req) || !!req.headers.origin) ? next() : res.status(403).json({ error: '请求来源不匹配' });
        const localOnly = (req, res, next) => localRequest(req) ? next() : res.status(403).json({ error: '仅允许训练机器的 localhost 界面管理访问码' });
        app.get('/login', (req, res) => this.identity(req) ? res.redirect(302, '/ui/') : this.page(res));
        app.get('/api/access/status', (req, res) => res.set('Cache-Control', 'no-store').json({ authenticated: !!this.identity(req), local: localRequest(req), expiresAt: this.identity(req)?.expiresAt || null }));
        app.post('/api/access/login', sameOrigin, express.json({ limit: '2kb' }), express.urlencoded({ extended: false, limit: '2kb' }), (req, res) => {
            this.sweep();
            const ip = req.socket.remoteAddress, entry = this.attempts.get(ip) || { count: 0, until: this.now() + 15 * 60000 };
            const html = req.is('application/x-www-form-urlencoded');
            if (entry.count >= 5) {
                res.set('Retry-After', String(Math.ceil((entry.until - this.now()) / 1000)));
                return html ? this.page(res, 429, '尝试次数过多，请 15 分钟后重试') : res.status(429).json({ error: '尝试次数过多，请稍后重试' });
            }
            const code = typeof req.body?.code === 'string' ? req.body.code : '';
            const actual = crypto.createHash('sha256').update(code).digest(), expected = crypto.createHash('sha256').update(this.code).digest();
            if (!crypto.timingSafeEqual(actual, expected)) {
                if (this.attempts.size >= 1000 && !this.attempts.has(ip)) return res.status(429).json({ error: '登录请求过多' });
                entry.count++; this.attempts.set(ip, entry);
                return html ? this.page(res, 401, '访问码不正确') : res.status(401).json({ error: '访问码不正确' });
            }
            this.attempts.delete(ip);
            if (this.sessions.size >= 1000) this.sessions.delete(this.sessions.keys().next().value);
            const id = crypto.randomBytes(32).toString('hex'); this.sessions.set(id, this.now() + SESSION_MS);
            res.set({ 'Set-Cookie': this.cookie(req, id), 'Cache-Control': 'no-store' });
            return html ? res.redirect(303, '/ui/') : res.json({ authenticated: true });
        });
        app.post('/api/access/logout', sameOrigin, (req, res) => {
            const id = this.sessionId(req); this.sessions.delete(id);
            for (const [socket, request] of this.sockets) if (id && this.sessionId(request) === id) socket.close(4001, 'Logged out');
            res.set('Set-Cookie', this.cookie(req, '', 0)).json({ authenticated: false });
        });
        app.get('/api/access/code', localOnly, (_req, res) => res.set('Cache-Control', 'no-store').json({ code: this.code }));
        app.post('/api/access/reset', localOnly, (_req, res) => { this.rotate(); res.set('Cache-Control', 'no-store').json({ reset: true }); });
        // Must precede ALL API routes, proxies, parsers, and static/legacy mounts.
        app.use((req, res, next) => {
            if (!originMatches(req)) return res.status(403).json({ error: '请求来源不匹配' });
            const identity = this.identity(req);
            if (!identity) {
                res.set('Cache-Control', 'no-store');
                if (req.method === 'GET' && req.accepts('html') && !req.path.startsWith('/api/') && req.headers['sec-fetch-dest'] !== 'image') return res.redirect(302, '/login');
                return res.status(401).json({ error: '访问会话已过期，请在新标签页打开 /login 重新登录' });
            }
            if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !identity.local && !req.headers.origin) return res.status(403).json({ error: '写请求必须携带同源 Origin' });
            req.uiAccess = identity;
            res.set('Cache-Control', 'private, no-store');
            const writeHead = res.writeHead;
            res.writeHead = function (...args) {
                // Static sendFile/proxy handlers can replace earlier cache headers.
                const index = typeof args[1] === 'string' ? 2 : 1;
                if (Array.isArray(args[index])) {
                    const headers = [];
                    for (let i = 0; i < args[index].length; i += 2) if (!/^(cache-control|vary)$/i.test(args[index][i])) headers.push(args[index][i], args[index][i + 1]);
                    args[index] = headers;
                } else if (args[index] && typeof args[index] === 'object') {
                    args[index] = Object.fromEntries(Object.entries(args[index]).filter(([key]) => !/^(cache-control|vary)$/i.test(key)));
                }
                this.setHeader('Cache-Control', 'private, no-store');
                this.setHeader('Vary', 'Cookie');
                return writeHead.apply(this, args);
            };
            next();
        });
    }
    dispose() { clearInterval(this.timer); for (const s of this.sockets.keys()) s.close(1001, 'Server stopping'); }
}
module.exports = { UiAccess, localRequest, originMatches, SESSION_MS };
