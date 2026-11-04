const fs = require('fs');
const path = require('path');

function alive(pid) {
    try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

// Read only tiny atomic status snapshots, never scan/tail the growing JSONL logs.
function readMemoryStatuses(jobsRoot, jobs, isAlive = alive, now = Date.now()) {
    const result = [];
    for (const [jobName, job] of jobs) {
        if (job.type !== 'training') continue;
        const directory = path.join(jobsRoot, jobName, 'logs');
        try {
            for (const entry of fs.readdirSync(directory)) {
                if (!/^memory_status_pid\d+\.json$/.test(entry)) continue;
                try {
                    const file = path.join(directory, entry);
                    if (fs.statSync(file).size > 1024 * 1024) continue;
                    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
                    const timestamp = Number(record.time_ns) / 1e6;
                    if (!Number.isSafeInteger(record.pid) || record.pid <= 0 ||
                        entry !== `memory_status_pid${record.pid}.json` || !isAlive(record.pid) ||
                        !Number.isFinite(timestamp) || timestamp < job.startTime || timestamp > now + 5000) continue;
                    result.push({ ...record, jobName, ageMs: Math.max(0, now - timestamp) });
                } catch (_) { /* process exiting or replacing snapshot */ }
            }
        } catch (_) { /* backend does not publish snapshots yet */ }
    }
    return result;
}

module.exports = { readMemoryStatuses };
