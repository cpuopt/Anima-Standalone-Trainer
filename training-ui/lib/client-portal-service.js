const http = require('node:http');
const path = require('node:path');
const { createClientPortalApp } = require('../client-portal-server');
const { findAvailablePort } = require('./ports');

function fail(message, status = 400) {
    const err = new Error(message);
    err.status = status;
    return err;
}

function parsePort(raw, fallback) {
    if (raw === undefined || raw === null || raw === '') return fallback;
    const num = Number(raw);
    if (!Number.isInteger(num) || (num !== 0 && (num < 1024 || num > 65535))) {
        throw fail('端口号必须是 1024–65535 之间的整数', 400);
    }
    return num;
}

class ClientPortalService {
    constructor({
        jobsDir,
        dataDir,
        publicDir,
        toNativePath,
        host,
        defaultPort = Number(process.env.CLIENT_PORTAL_PORT) || 3100
    } = {}) {
        this.jobsDir = jobsDir;
        this.dataDir = dataDir;
        this.publicDir = publicDir || path.join(__dirname, '..', 'client-portal', 'public');
        this.toNativePath = toNativePath;
        this.host = host;
        this.requestedPort = parsePort(defaultPort, 3100);
        this.server = null;
        this.port = null;
        this.startedAt = null;
        this.lastError = null;
        this._queue = Promise.resolve();
    }

    status() {
        const running = Boolean(this.server && this.server.listening);
        return {
            running,
            port: running ? this.port : null,
            requestedPort: this.requestedPort,
            startedAt: running ? this.startedAt : null,
            lastError: this.lastError
        };
    }

    _enqueue(fn) {
        const next = this._queue.then(fn, fn);
        this._queue = next.catch(() => {});
        return next;
    }

    start(rawPort) {
        return this._enqueue(async () => {
            const targetPort = parsePort(rawPort, this.requestedPort);
            if (this.server && this.server.listening) {
                const unchanged = rawPort === undefined || rawPort === null || rawPort === ''
                    || targetPort === this.port
                    || (targetPort === this.requestedPort && targetPort !== 0);
                if (unchanged) return this.status();
                await this._stopNow();
            }

            let bindPort = targetPort;
            if (targetPort !== 0) {
                bindPort = await findAvailablePort(targetPort);
                if (!bindPort) {
                    const msg = `端口 ${targetPort}-${Math.min(targetPort + 9, 65535)} 均已被占用，无法启动客户服务`;
                    this.lastError = msg;
                    throw fail(msg, 409);
                }
            }

            const { app } = createClientPortalApp({
                jobsDir: this.jobsDir,
                dataDir: this.dataDir,
                publicDir: this.publicDir,
                toNativePath: this.toNativePath
            });
            const srv = http.createServer(app);

            try {
                await new Promise((resolve, reject) => {
                    const onError = err => {
                        srv.removeListener('listening', onListening);
                        reject(err);
                    };
                    const onListening = () => {
                        srv.removeListener('error', onError);
                        resolve();
                    };
                    srv.once('error', onError);
                    srv.once('listening', onListening);
                    if (this.host) srv.listen(bindPort, this.host);
                    else srv.listen(bindPort);
                });
            } catch (err) {
                this.lastError = err.message;
                try { srv.close(); } catch {}
                throw fail(`启动客户服务失败: ${err.message}`, 500);
            }

            this.server = srv;
            this.port = srv.address().port;
            this.requestedPort = targetPort === 0 ? this.port : targetPort;
            this.startedAt = Date.now();
            this.lastError = null;

            srv.on('close', () => {
                if (this.server === srv) {
                    this.server = null;
                    this.port = null;
                    this.startedAt = null;
                }
            });

            return this.status();
        });
    }

    async _stopNow() {
        const srv = this.server;
        this.server = null;
        this.port = null;
        this.startedAt = null;
        if (!srv) return this.status();
        if (typeof srv.closeAllConnections === 'function') {
            try { srv.closeAllConnections(); } catch {}
        }
        await new Promise(resolve => {
            try {
                srv.close(() => resolve());
            } catch {
                resolve();
            }
        });
        return this.status();
    }

    stop() {
        return this._enqueue(() => this._stopNow());
    }

    forceCloseSync() {
        const srv = this.server;
        this.server = null;
        this.port = null;
        this.startedAt = null;
        if (!srv) return;
        try { srv.closeAllConnections?.(); } catch {}
        try { srv.close(); } catch {}
    }
}

module.exports = { ClientPortalService };
