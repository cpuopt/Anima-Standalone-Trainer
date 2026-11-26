const path = require('node:path');

const STRIPPABLE_METADATA_FIELDS = [
    'ss_datasets[*].bucket_info',
    'ss_datasets[*].tag_frequency',
    'ss_tag_frequency'
];

const MAX_HEADER_BYTES = 64n * 1024n * 1024n;

function fail(message, status = 400) {
    const error = new Error(message);
    error.status = status;
    return error;
}

function sanitizeStripMetadata(input) {
    let rawList = [];
    if (Array.isArray(input)) {
        rawList = input.flatMap(item => String(item ?? '').split(','));
    } else if (typeof input === 'string') {
        rawList = input.split(',');
    }
    const requested = new Set(rawList.map(s => s.trim()).filter(Boolean));
    return STRIPPABLE_METADATA_FIELDS.filter(field => requested.has(field));
}

function stripMetadataObject(metadata, stripFields) {
    const fields = sanitizeStripMetadata(stripFields);
    if (!fields.length || !metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
        return { metadata, changed: false };
    }

    const fieldSet = new Set(fields);
    const next = { ...metadata };
    let changed = false;

    if (fieldSet.has('ss_tag_frequency') && Object.prototype.hasOwnProperty.call(next, 'ss_tag_frequency')) {
        delete next.ss_tag_frequency;
        changed = true;
    }

    const stripBucketInfo = fieldSet.has('ss_datasets[*].bucket_info');
    const stripDatasetTagFreq = fieldSet.has('ss_datasets[*].tag_frequency');
    if ((stripBucketInfo || stripDatasetTagFreq) && typeof next.ss_datasets === 'string') {
        try {
            const parsed = JSON.parse(next.ss_datasets);
            if (Array.isArray(parsed)) {
                let dsChanged = false;
                const updated = parsed.map(entry => {
                    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
                    const copy = { ...entry };
                    if (stripBucketInfo && Object.prototype.hasOwnProperty.call(copy, 'bucket_info')) {
                        delete copy.bucket_info;
                        dsChanged = true;
                    }
                    if (stripDatasetTagFreq && Object.prototype.hasOwnProperty.call(copy, 'tag_frequency')) {
                        delete copy.tag_frequency;
                        dsChanged = true;
                    }
                    return copy;
                });
                if (dsChanged) {
                    next.ss_datasets = JSON.stringify(updated);
                    changed = true;
                }
            }
        } catch {
            // Preserve malformed ss_datasets string untouched
        }
    }

    return { metadata: next, changed };
}

async function prepareSafetensorsStream(handle, stat, stripFields) {
    const fields = sanitizeStripMetadata(stripFields);
    if (!fields.length) {
        return { modified: false, totalSize: stat.size, dataStart: 0, payloadSize: stat.size, prefixAndHeader: null };
    }

    const prefix = Buffer.alloc(8);
    const first = await handle.read(prefix, 0, 8, 0);
    if (first.bytesRead !== 8) {
        throw fail('模型头不完整，文件可能仍在保存');
    }

    const length = prefix.readBigUInt64LE();
    if (length < 2n || length > MAX_HEADER_BYTES || length + 8n > BigInt(stat.size)) {
        throw fail('模型头不完整、过大或格式无效；请等待保存完成后重试');
    }

    const buffer = Buffer.alloc(Number(length));
    const read = await handle.read(buffer, 0, buffer.length, 8);
    if (read.bytesRead !== buffer.length) {
        throw fail('模型仍在变化，请刷新后重试', 409);
    }

    let data;
    try {
        data = JSON.parse(buffer.toString('utf8'));
    } catch {
        throw fail('模型头无法解析，文件可能尚未保存完成');
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw fail('无效的 Safetensors 头');
    }

    const { metadata: nextMetadata, changed } = stripMetadataObject(data.__metadata__, fields);
    if (!changed) {
        return { modified: false, totalSize: stat.size, dataStart: 0, payloadSize: stat.size, prefixAndHeader: null };
    }

    const newHeaderObj = { ...data, __metadata__: nextMetadata };
    const rawBuf = Buffer.from(JSON.stringify(newHeaderObj), 'utf8');
    const pad = (8 - (rawBuf.length % 8)) % 8;
    const paddedBuf = pad > 0 ? Buffer.concat([rawBuf, Buffer.alloc(pad, 0x20)]) : rawBuf;

    const newPrefix = Buffer.alloc(8);
    newPrefix.writeBigUInt64LE(BigInt(paddedBuf.length));
    const prefixAndHeader = Buffer.concat([newPrefix, paddedBuf]);

    const oldDataStart = 8 + Number(length);
    const payloadSize = stat.size - oldDataStart;
    const totalSize = prefixAndHeader.length + payloadSize;

    return {
        modified: true,
        totalSize,
        dataStart: oldDataStart,
        payloadSize,
        prefixAndHeader
    };
}

async function streamSafetensorsResponse(
    res,
    handle,
    stat,
    filePath,
    stripFields,
    { contentType = 'application/octet-stream', attachmentName = path.basename(filePath) } = {}
) {
    const isSafetensors = path.extname(filePath).toLowerCase() === '.safetensors';
    let plan;
    try {
        plan = await prepareSafetensorsStream(handle, stat, isSafetensors ? sanitizeStripMetadata(stripFields) : []);
    } catch (err) {
        await handle.close().catch(() => {});
        throw err;
    }

    res.type(contentType);
    if (attachmentName) res.attachment(attachmentName);
    res.set('Content-Length', String(plan.totalSize));

    if (plan.payloadSize === 0) {
        await handle.close().catch(() => {});
        res.end(plan.prefixAndHeader || undefined);
        return;
    }

    const stream = handle.createReadStream({ autoClose: true, start: plan.dataStart, end: stat.size - 1 });
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());

    if (plan.modified) {
        const canContinue = res.write(plan.prefixAndHeader);
        if (canContinue) {
            stream.pipe(res);
        } else {
            res.once('drain', () => {
                if (!res.destroyed) stream.pipe(res);
            });
        }
    } else {
        stream.pipe(res);
    }
}

module.exports = {
    STRIPPABLE_METADATA_FIELDS,
    MAX_HEADER_BYTES,
    sanitizeStripMetadata,
    stripMetadataObject,
    prepareSafetensorsStream,
    streamSafetensorsResponse
};
