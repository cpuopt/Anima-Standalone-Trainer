const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { mountFrontend } = require('../lib/frontend');

test('Vue routing keeps legacy/API routes and missing assets distinct', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trainer-vue-'));
    fs.writeFileSync(path.join(directory, 'index.html'), '<h1>Vue</h1>');
    const app = express();
    mountFrontend(app, directory);
    app.get('/api/test', (req, res) => res.json({ ok: true }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.on('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
        assert.equal((await fetch(base + '/', { redirect: 'manual' })).headers.get('location'), '/ui/');
        assert.match(await (await fetch(base + '/legacy/')).text(), /Anima/);
        assert.deepEqual(await (await fetch(base + '/api/test')).json(), { ok: true });
        assert.match(await (await fetch(base + '/ui/deep/path')).text(), /Vue/);
        assert.equal((await fetch(base + '/ui/assets/missing.js')).status, 404);
        assert.equal((await fetch(base + '/ui', { redirect: 'manual' })).headers.get('location'), '/ui/');
        fs.unlinkSync(path.join(directory, 'index.html'));
        assert.equal((await fetch(base + '/ui/')).status, 503);
        assert.equal((await fetch(base + '/', { redirect: 'manual' })).headers.get('location'), '/legacy/');
    } finally {
        await new Promise(resolve => server.close(resolve));
        if (fs.existsSync(path.join(directory, 'index.html'))) fs.unlinkSync(path.join(directory, 'index.html'));
        fs.rmdirSync(directory);
    }
});
