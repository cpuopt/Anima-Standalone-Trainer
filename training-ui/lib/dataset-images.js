const fs = require('fs');
const path = require('path');

const DATASET_IMAGE_EXTENSIONS = new Set([
    '.png',
    '.jpg',
    '.jpeg',
    '.webp',
    '.bmp',
    '.avif',
    '.jxl'
]);

function countDatasetImages(directory) {
    if (typeof directory !== 'string' || directory.trim() === '') {
        return { count: 0, exists: false, readable: true };
    }

    let stat;
    try {
        stat = fs.statSync(directory);
    } catch (err) {
        if (err.code === 'ENOENT') return { count: 0, exists: false, readable: true };
        return { count: 0, exists: true, readable: false, error: err.message };
    }
    if (!stat.isDirectory()) return { count: 0, exists: false, readable: true };

    try {
        const count = fs.readdirSync(directory, { withFileTypes: true }).reduce((total, entry) => {
            if (!entry.isFile()) return total;
            return total + (DATASET_IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()) ? 1 : 0);
        }, 0);
        return { count, exists: true, readable: true };
    } catch (err) {
        return { count: 0, exists: true, readable: false, error: err.message };
    }
}

module.exports = { DATASET_IMAGE_EXTENSIONS, countDatasetImages };
