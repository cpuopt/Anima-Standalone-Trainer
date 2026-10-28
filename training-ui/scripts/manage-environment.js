// Model-only CLI dispatch uses the bootstrapped control Python, including when
// Python 3.12 was downloaded by uv and is not installed as a system command.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const TOML = require('@iarna/toml');
const { environmentPath, pythonAt, DEFINITIONS } = require('../lib/environment-manager');
const root = path.resolve(__dirname, '../..');
const id = process.argv[2];
if (!Object.hasOwn(DEFINITIONS, id)) { console.error('Unknown environment'); process.exit(1); }
const config = TOML.parse(fs.readFileSync(path.join(root, 'training-ui/global_config.toml'), 'utf8'));
const python = pythonAt(environmentPath(root, 'main', config));
if (!fs.existsSync(python)) { console.error('Run setup_env first to create the lightweight main environment.'); process.exit(1); }
const result = spawnSync(python, [path.join(root, 'scripts/environment_manager.py'), 'install', id, ...process.argv.slice(3)],
  { cwd: root, stdio: 'inherit', windowsHide: true, shell: false });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
