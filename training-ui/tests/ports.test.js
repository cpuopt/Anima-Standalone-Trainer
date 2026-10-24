const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { checkPort, findAvailablePort } = require('../lib/ports');

function listen(server, options) {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(options, () => {
            server.removeListener('error', reject);
            resolve(server.address().port);
        });
    });
}
const close = server => new Promise(resolve => server.close(resolve));

test('rejects IPv4-only occupied ports instead of selecting an unrelated service', async () => {
    const other = net.createServer();
    const port = await listen(other, { host: '0.0.0.0', port: 0 });
    try {
        assert.equal(await checkPort(port), false);
        assert.equal(await findAvailablePort(port, 1), null);
        const available = await findAvailablePort(port, 10);
        assert.ok(available > port);
        assert.equal(await checkPort(available), true);
    } finally { await close(other); }
});

test('rejects IPv6-only occupied ports even when IPv4 is free', async t => {
    const other = net.createServer();
    let port;
    try { port = await listen(other, { host: '::', port: 0, ipv6Only: true }); }
    catch (error) {
        if (['EAFNOSUPPORT', 'EPROTONOSUPPORT', 'EADDRNOTAVAIL'].includes(error.code)) return t.skip('IPv6 unavailable');
        throw error;
    }
    try { assert.equal(await checkPort(port), false); }
    finally { await close(other); }
});

test('free port checks release their probes before returning', async () => {
    const reservation = net.createServer();
    const port = await listen(reservation, { host: '0.0.0.0', port: 0 });
    await close(reservation);
    assert.equal(await checkPort(port), true);
    const actual = net.createServer();
    try { await listen(actual, { host: '0.0.0.0', port }); }
    finally { await close(actual); }
});
