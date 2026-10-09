const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { killProcess } = require('../lib/process-killer');
const B = require('../lib/krea2-backend');

function posixHarness(groupExists = true) {
  const calls = []; let timer, poll, timerCleared = false, pollCleared = false;
  let groupAlive = groupExists;
  const absent = () => Object.assign(new Error('not running'), { code: 'ESRCH' });
  return { calls, timeout: () => timer(), tick: () => poll(), exitGroup: () => { groupAlive = false; },
    timerCleared: () => timerCleared, pollCleared: () => pollCleared,
    deps: { platform: 'linux', sendSignal: (pid, signal) => {
      calls.push([pid, signal]);
      // The launcher is already gone; a trainer may still be alive in its group.
      if (signal === 0 && (pid > 0 || !groupAlive)) throw absent();
    }, setTimer: fn => { timer = fn; return 1; }, setPoll: fn => { poll = fn; return 2; },
    clearTimer: () => { timerCleared = true; }, clearPoll: () => { pollCleared = true; } } };
}
test('Linux stop escalates against surviving trainer group after launcher exits', async () => {
  const h = posixHarness(); let completed = false;
  const stopped = killProcess(123, 8000, h.deps).then(() => { completed = true; });
  h.tick(); await Promise.resolve();
  assert.equal(completed, false); assert.equal(h.timerCleared(), false);
  h.timeout(); await stopped;
  assert.ok(h.calls.some(([pid, signal]) => pid === -123 && signal === 'SIGKILL'));
  assert.equal(h.pollCleared(), true);
});
test('Linux graceful exit cancels escalation only when the process group is gone', async () => {
  const h = posixHarness(), stopped = killProcess(123, 8000, h.deps);
  h.exitGroup(); h.tick(); await stopped;
  assert.equal(h.timerCleared(), true); assert.equal(h.pollCleared(), true);
  assert.ok(!h.calls.some(([, signal]) => signal === 'SIGKILL'));
});
test('non-group process fallback and immediate stop remain supported', async () => {
  const h = posixHarness(false);
  await killProcess(123, 0, h.deps);
  assert.deepEqual(h.calls, [[-123, 0], [123, 'SIGKILL']]);
});
test('Windows stops the entire process tree without a visible window', async () => {
  const p = new EventEmitter(); let launch;
  const stopped = killProcess(123, 8000, { platform: 'win32', spawnProcess: (...args) => { launch = args; return p; } });
  p.emit('close', 0); await stopped;
  assert.deepEqual(launch, ['taskkill', ['/PID', '123', '/F', '/T'], { windowsHide: true }]);
});
test('Krea pipeline owns a POSIX group for every stage and Windows keeps taskkill tree behavior', async () => {
  const launches = [];
  const job = B.pipeline({ rt: { python: 'python', cwd: '.' }, stages: [{phase:'training',args:[]}] }, {
    spawnProcess: (...args) => {
      launches.push(args); const p = new EventEmitter(); p.pid = 123;
      setImmediate(() => p.emit('close', 0)); return p;
    }
  });
  assert.equal(await job.start(), 'completed');
  assert.equal(launches[0][2].detached, process.platform !== 'win32');
});
