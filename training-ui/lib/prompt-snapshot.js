const fs = require('fs');
const path = require('path');

const RUNNING_PROMPTS_FILENAME = '_running_sample_prompts.txt';

/**
 * Give a training process an immutable view of the prompts it cached at startup.
 *
 * The trainer reloads the prompt text before every sampling pass, while cached
 * text-encoder outputs are created only once. Pointing it at the editable job
 * file would therefore let a UI save introduce prompts for which no embedding
 * exists. A per-run snapshot keeps those two inputs consistent; edits to the
 * normal sample_prompts.txt remain available to the next run.
 */
function snapshotSamplePrompts(jobPath, trainingConfig) {
    const sourcePath = path.join(jobPath, 'sample_prompts.txt');
    if (!fs.existsSync(sourcePath)) return null;

    const snapshotPath = path.join(jobPath, RUNNING_PROMPTS_FILENAME);
    fs.copyFileSync(sourcePath, snapshotPath);
    trainingConfig.sample_arguments = trainingConfig.sample_arguments || {};
    trainingConfig.sample_arguments.sample_prompts = snapshotPath;
    return snapshotPath;
}

module.exports = { RUNNING_PROMPTS_FILENAME, snapshotSamplePrompts };
