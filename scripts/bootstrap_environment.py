"""Bootstrap uv and Python 3.12 without any model environment dependency."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import uuid
import venv

ROOT = Path(__file__).resolve().parents[1]


def main():
    bootstrap = ROOT / '.runtime' / ('bootstrap-' + uuid.uuid4().hex[:8])
    venv.EnvBuilder(with_pip=True).create(bootstrap)
    python = bootstrap / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    try:
        subprocess.run([str(python), '-m', 'pip', 'install', 'uv==0.12.18'], check=True)
        uv = [str(python), '-m', 'uv']
        found = subprocess.run(uv + ['python', 'find', '3.12'], capture_output=True, text=True)
        if found.returncode:
            subprocess.run(uv + ['python', 'install', '3.12'], check=True)
            found = subprocess.run(uv + ['python', 'find', '3.12'], capture_output=True, text=True, check=True)
        subprocess.run([found.stdout.strip(), str(ROOT / 'scripts/environment_manager.py'), 'install', 'main'], check=True)
    finally:
        shutil.rmtree(bootstrap, ignore_errors=True)


if __name__ == '__main__':
    main()
