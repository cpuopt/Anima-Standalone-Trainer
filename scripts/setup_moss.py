"""Install the pinned MOSS backend without touching Anima or Musubi environments."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import venv

ROOT = Path(__file__).resolve().parents[1]
REVISION = '11d8cedd0c67b93a10f8b2d75f43554f6f12c794'


def verify_vendor():
    manifest = json.loads((ROOT / 'vendor/SD_SCRIPTS_VERSION.json').read_text('utf-8'))
    if manifest['revision'] != REVISION:
        raise RuntimeError('Unexpected sd-scripts revision')
    hashes = json.loads((ROOT / 'vendor/SD_SCRIPTS_SHA256.json').read_text('utf-8'))
    for name, expected in hashes.items():
        file = ROOT / 'vendor/sd-scripts' / name
        if not file.is_file() or hashlib.sha256(file.read_bytes()).hexdigest() != expected:
            raise RuntimeError(f'Vendored sd-scripts was modified or incomplete: {name}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--venv', type=Path, default=ROOT / 'venv-moss')
    parser.add_argument('--verify-only', action='store_true')
    args = parser.parse_args()
    verify_vendor()
    if args.verify_only:
        print(f'sd-scripts {REVISION} verified'); return
    if sys.version_info[:2] != (3, 12):
        parser.error('Use Python 3.12 (Windows: py -3.12 scripts/setup_moss.py)')
    target = args.venv.resolve()
    if target in {(ROOT / 'venv').resolve(), (ROOT / 'venv-krea2').resolve()}:
        parser.error('MOSS must not overwrite the Anima/Krea environment')
    python = target / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    if not python.exists():
        venv.EnvBuilder(with_pip=True).create(target)
    env = dict(os.environ); env.pop('PYTHONPATH', None)
    subprocess.run([str(python), '-m', 'pip', 'install', 'uv==0.12.18'], check=True, env=env)
    subprocess.run([str(python), '-m', 'uv', 'pip', 'sync', '--python', str(python),
        '--index-strategy', 'unsafe-best-match', '--extra-index-url', 'https://download.pytorch.org/whl/cu128',
        str(ROOT / 'requirements/moss-cu128.lock.txt')], check=True, env=env)
    subprocess.run([str(python), str(ROOT / 'scripts/moss_runtime.py'), 'check'],
        cwd=ROOT / 'vendor/sd-scripts', check=True, env=env)
    print(f'Installed MOSS environment: {target}. Set it in Global Settings. Models are not downloaded.')


if __name__ == '__main__':
    main()
