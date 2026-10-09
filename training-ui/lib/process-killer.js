const { spawn } = require('child_process');

// POSIX children launched with detached:true own a process group. Track that group,
// since an Accelerate launcher can exit while its trainer still holds CUDA/pipes.
function killProcess(pid, gracefulMs = 8000, dependencies = {}) {
  const { platform = process.platform, sendSignal = process.kill.bind(process), spawnProcess = spawn,
    setTimer = setTimeout, clearTimer = clearTimeout, setPoll = setInterval, clearPoll = clearInterval } = dependencies;
  if (!Number.isInteger(pid) || pid <= 0) return Promise.resolve();
  return new Promise(resolve => {
    if (platform === 'win32') {
      const child = spawnProcess('taskkill', ['/PID', String(pid), '/F', '/T'], { windowsHide: true });
      child.on('close', resolve); child.on('error', resolve);
      return;
    }
    let target = -pid;
    try { sendSignal(target, 0); } catch (_) { target = pid; }
    const signal = sig => { try { sendSignal(target, sig); } catch (_) {} };
    if (gracefulMs <= 0) { signal('SIGKILL'); resolve(); return; }
    signal('SIGTERM');
    let timer, poll;
    const finish = () => { clearTimer(timer); clearPoll(poll); resolve(); };
    timer = setTimer(() => { signal('SIGKILL'); finish(); }, gracefulMs);
    poll = setPoll(() => {
      try { sendSignal(target, 0); } catch (err) { if (err.code === 'ESRCH') finish(); }
    }, 200);
  });
}

module.exports = { killProcess };
