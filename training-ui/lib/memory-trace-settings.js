function memoryTraceUpdateError(previous, next, running) {
    const before = previous?.training_arguments || {};
    const after = next?.training_arguments || {};
    const defaults = { memory_trace: false, memory_trace_sync: false, memory_trace_every_n_steps: 50 };
    for (const [key, fallback] of Object.entries(defaults)) {
        const value = after[key] ?? fallback;
        if (key === 'memory_trace_every_n_steps' ? !Number.isInteger(value) || value < 1 : typeof value !== 'boolean')
            return `Invalid ${key}`;
        if (running && (before[key] ?? fallback) !== value)
            return '请先停止任务，再修改显存分配详细记录设置';
    }
    return null;
}
module.exports = { memoryTraceUpdateError };
