const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const express = require('express');
const { tensorboardPath, tensorboardProxy, waitForTensorboard } = require('../lib/tensorboard-proxy');

async function listen(t, handler) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  return { server, port: server.address().port, url: `http://127.0.0.1:${server.address().port}` };
}
async function fixture(t, handler, name = 'cloud job 中文') {
  const upstream = await listen(t, handler), jobs = new Map([[name, { port: upstream.port }]]);
  const app = express();
  app.use('/tensorboard/:jobKey', tensorboardProxy(job => jobs.get(job)));
  app.use(express.json());
  const web = await listen(t, app), prefix = tensorboardPath(name);
  return { ...web, upstream, jobs, prefix };
}
test('same-origin proxy forwards assets and queries with the configured TensorBoard prefix', async t => {
  let received;
  const f = await fixture(t, (req, res) => {
    received = { path: req.url, host: req.headers.host };
    res.setHeader('Content-Type', 'application/javascript'); res.end('window.tensorboard = true;');
  });
  const response = await new Promise((resolve, reject) => {
    http.get(f.url + f.prefix + '/index.js?cache=1', { headers: { Host: 'training.example.com' } }, res => {
      let body = ''; res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
  assert.equal(response.status, 200); assert.equal(response.body, 'window.tensorboard = true;');
  assert.equal(received.path, f.prefix + '/index.js?cache=1');
  assert.equal(received.host, 'training.example.com');
});
test('TensorBoard POST bodies reach the upstream before JSON middleware consumes them', async t => {
  let body = '', contentType;
  const f = await fixture(t, (req, res) => {
    contentType = req.headers['content-type']; req.on('data', chunk => { body += chunk; });
    req.on('end', () => { res.setHeader('Content-Type', 'application/json'); res.end(body); });
  });
  const payload = JSON.stringify({ run: 'trial', tags: ['loss'] });
  const response = await fetch(f.url + f.prefix + '/data/plugin/hparams/session_groups', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload
  });
  assert.equal(await response.text(), payload); assert.equal(body, payload); assert.equal(contentType, 'application/json');
});
test('redirects remain on the WebUI origin and preserve trailing slash queries', async t => {
  let f;
  f = await fixture(t, (req, res) => { res.writeHead(302, { Location: `${f.upstream.url}${f.prefix}/#scalars` }); res.end(); });
  const slash = await fetch(f.url + f.prefix + '?view=1', { redirect: 'manual' });
  assert.equal(slash.status, 308); assert.equal(slash.headers.get('location'), f.prefix + '/?view=1');
  const redirect = await fetch(f.url + f.prefix + '/redirect', { redirect: 'manual' });
  assert.equal(redirect.headers.get('location'), f.prefix + '/#scalars');
});
test('stopped and unreachable TensorBoard jobs return useful errors without exposing an arbitrary proxy', async t => {
  const f = await fixture(t, (_req, res) => res.end('private'));
  const unknown = await fetch(f.url + tensorboardPath('other job') + '/');
  assert.equal(unknown.status, 404);
  await new Promise(resolve => f.upstream.server.close(resolve));
  const unavailable = await fetch(f.url + f.prefix + '/');
  assert.equal(unavailable.status, 502); assert.match(await unavailable.text(), /unavailable/);
});
test('startup waits for the prefixed page and rejects a failed child immediately', async t => {
  let count = 0;
  const upstream = await listen(t, (req, res) => {
    assert.equal(req.url, '/prefix/'); res.statusCode = ++count === 1 ? 503 : 200; res.end('ready');
  });
  await waitForTensorboard(upstream.port, '/prefix', new EventEmitter(), 3000);
  assert.ok(count >= 2);
  const proc = new EventEmitter();
  const startup = waitForTensorboard(upstream.port, '/prefix', proc, 3000);
  proc.emit('close', 1);
  await assert.rejects(startup, /exited before it was ready/);
});
