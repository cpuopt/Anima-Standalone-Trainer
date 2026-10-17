const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const frontend = path.join(root, 'frontend');
const stamp = path.join(frontend, 'dist', '.source-hash');
function npm(args) {
    const cli = process.env.npm_execpath;
    if (!cli || !fs.existsSync(cli)) throw Error('Use npm start or npm run build: npm CLI path is unavailable.');
    execFileSync(process.execPath, [cli, ...args], { cwd: frontend, stdio: 'inherit', windowsHide: true });
}
function fingerprint() {
    const hash = crypto.createHash('sha256');
    function add(filename) {
        const stat = fs.statSync(filename);
        if (stat.isDirectory()) {
            for (const entry of fs.readdirSync(filename).sort()) add(path.join(filename, entry));
        } else { hash.update(path.relative(root, filename)); hash.update(fs.readFileSync(filename)); }
    }
    for (const filename of ['src', 'package.json', 'package-lock.json', 'index.html', 'tsconfig.json', 'vite.config.ts']) add(path.join(frontend, filename));
    for (const filename of ['krea2.js', 'layer-rank.js', 'adapter-matrix.js', 'lbai.js']) add(path.join(root, 'public', 'js', filename));
    return hash.digest('hex');
}
function ensureFrontend(force = false) {
    if (!force && process.env.TRAINER_UI === 'legacy') return;
    const lock = path.join(frontend, 'package-lock.json');
    const lockHash = crypto.createHash('sha256').update(fs.readFileSync(lock)).digest('hex');
    const dependencyStamp = path.join(frontend, 'node_modules', '.trainer-lock-hash');
    const dependencyValid = fs.existsSync(dependencyStamp) && fs.readFileSync(dependencyStamp, 'utf8') === lockHash;
    const sourceHash = fingerprint();
    const built = fs.existsSync(path.join(frontend, 'dist', 'index.html')) && fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === sourceHash;
    if (!force && built) return;
    if (!dependencyValid) {
        console.log('[frontend] Installing locked build dependencies...');
        npm(['ci', '--include=dev', '--no-audit', '--no-fund']);
        fs.writeFileSync(dependencyStamp, lockHash);
    }
    console.log('[frontend] Building Vue UI...');
    npm(['run', 'build']);
    fs.writeFileSync(stamp, sourceHash);
}
if (require.main === module) {
    try { ensureFrontend(process.argv.includes('--force')); }
    catch (error) { console.error(`[frontend] ${error.message}`); process.exitCode = 1; }
}
module.exports = { fingerprint, ensureFrontend };
