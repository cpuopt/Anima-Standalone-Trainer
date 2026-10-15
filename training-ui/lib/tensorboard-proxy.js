const http = require('http');

// An ASCII prefix also supports job names containing spaces or non-ASCII text.
function tensorboardPath(name) {
  return '/tensorboard/' + Buffer.from(name, 'utf8').toString('base64url');
}

function cleanHeaders(headers) {
  const excluded = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
    'te', 'trailer', 'transfer-encoding', 'upgrade', ...(headers.connection || '').toLowerCase().split(/\s*,\s*/)]);
  return Object.fromEntries(Object.entries(headers).filter(([key]) => !excluded.has(key.toLowerCase())));
}

function tensorboardProxy(getProcess) {
  return (req, res) => {
    const key = req.params.jobKey;
    const name = Buffer.from(key, 'base64url').toString('utf8');
    const prefix = tensorboardPath(name);
    const tb = prefix === '/tensorboard/' + key ? getProcess(name) : null;
    if (!tb) return res.status(404).send('TensorBoard is not running for this job.');
    const queryAt = req.originalUrl.indexOf('?');
    const pathname = queryAt < 0 ? req.originalUrl : req.originalUrl.slice(0, queryAt);
    if (pathname === prefix) return res.redirect(308, prefix + '/' + (queryAt < 0 ? '' : req.originalUrl.slice(queryAt)));

    // The browser only talks to the WebUI origin. Internal ports are never targets
    // supplied by a request, and request bodies remain streams (before express.json).
    const headers = cleanHeaders(req.headers);
    const upstream = http.request({ hostname: '127.0.0.1', port: tb.port,
      method: req.method, path: req.originalUrl, headers }, response => {
      const responseHeaders = cleanHeaders(response.headers);
      if (responseHeaders.location) {
        try {
          const target = new URL(responseHeaders.location);
          if (['localhost', '127.0.0.1'].includes(target.hostname) || target.host === req.headers.host) {
            responseHeaders.location = target.pathname + target.search + target.hash;
          }
        } catch (_) { /* A relative Location already uses the public origin. */ }
      }
      res.writeHead(response.statusCode, responseHeaders);
      response.on('error', () => res.destroy());
      response.pipe(res);
    });
    upstream.on('error', () => {
      if (!res.headersSent) res.status(502).send('TensorBoard is unavailable. Stop it and launch it again.');
      else res.destroy();
    });
    upstream.setTimeout(120000, () => upstream.destroy(new Error('TensorBoard request timed out')));
    req.on('aborted', () => upstream.destroy());
    res.on('close', () => { if (!res.writableEnded) upstream.destroy(); });
    req.pipe(upstream);
  };
}

function waitForTensorboard(port, prefix, proc, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let done = false, retry, request;
    const finish = error => {
      if (done) return; done = true;
      clearTimeout(deadline); clearTimeout(retry); request?.destroy();
      proc.removeListener('error', failed); proc.removeListener('close', closed);
      error ? reject(error) : resolve();
    };
    const failed = error => finish(error);
    const closed = code => finish(Error(`TensorBoard exited before it was ready (exit ${code}). See the server log.`));
    const deadline = setTimeout(() => finish(Error('TensorBoard startup timed out. See the server log.')), timeoutMs);
    proc.once('error', failed); proc.once('close', closed);
    function probe() {
      if (done) return;
      request = http.get({ hostname: '127.0.0.1', port, path: prefix + '/' }, response => {
        response.resume();
        if (response.statusCode >= 200 && response.statusCode < 400) finish();
        else retry = setTimeout(probe, 150);
      });
      request.on('error', () => { if (!done) retry = setTimeout(probe, 150); });
      request.setTimeout(1000, () => request.destroy());
    }
    probe();
  });
}

module.exports = { tensorboardPath, tensorboardProxy, waitForTensorboard };
