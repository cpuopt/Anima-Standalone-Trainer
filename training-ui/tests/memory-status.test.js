const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readMemoryStatuses } = require('../lib/memory-status');
test('excludes dead processes, previous launches, corrupted files and idle jobs', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-status-'));
    try {
        const dir = path.join(root, 'job', 'logs'); fs.mkdirSync(dir, { recursive: true });
        for (const [pid,time] of [[11,2000], [12,2000], [13,1000]])
            fs.writeFileSync(path.join(dir, `memory_status_pid${pid}.json`), JSON.stringify({pid,time_ns:time * 1e6}));
        fs.writeFileSync(path.join(dir, 'memory_status_pid14.json'), 'partial');
        const jobs = new Map([['job', {type:'training',startTime:1500}]]);
        const result = readMemoryStatuses(root, jobs, pid => pid !== 12, 2500);
        assert.equal(result.length, 1); assert.equal(result[0].pid, 11); assert.equal(result[0].ageMs, 500);
        assert.deepEqual(readMemoryStatuses(root, new Map(), () => true, 2500), []);
    } finally { fs.rmSync(root, { recursive:true, force:true }); }
});
