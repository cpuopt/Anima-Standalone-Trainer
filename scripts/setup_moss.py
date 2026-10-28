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
    from environment_manager import main as manage
    sys.argv[1:1] = ['install', 'moss']
    manage()


if __name__ == '__main__':
    main()
