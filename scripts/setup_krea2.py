"""Install the pinned Musubi backend into its own environment."""
import argparse
import os
from pathlib import Path
import subprocess
import sys
import venv

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--venv', type=Path, default=ROOT / 'venv-krea2')
    parser.add_argument('--cuda', choices=['cu124', 'cu128', 'cu130', 'cu132'], default='cu128')
    args = parser.parse_args()
    if sys.version_info[:2] != (3, 12):
        parser.error('Use Python 3.12 for the locked Krea 2 environment.')
    target = args.venv.resolve()
    python = target / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    if not python.exists():
        print(f'Creating isolated environment: {target}', flush=True)
        venv.EnvBuilder(with_pip=True).create(target)
    subprocess.run([str(python), '-m', 'pip', 'install', 'uv==0.10.0'], check=True)
    subprocess.run([str(python), '-m', 'uv', 'pip', 'sync', '--python', str(python),
                    '--index-strategy', 'unsafe-best-match', '--extra-index-url',
                    f'https://download.pytorch.org/whl/{args.cuda}',
                    str(ROOT / 'requirements' / f'krea2-{args.cuda}.lock.txt')], check=True)
    subprocess.run([str(python), '-m', 'pip', 'install', '--no-deps', '--no-build-isolation',
                    '-e', str(ROOT / 'vendor' / 'musubi-tuner')], check=True)
    subprocess.run([str(python), '-c',
                    'from transformers import Qwen3VLModel; import musubi_tuner.krea2_train_network; '
                    'import torch; print("CUDA available:", torch.cuda.is_available())'], check=True)
    print(f'Installed. Set Krea 2 Python Environment in Global Settings to: {target}')


if __name__ == '__main__':
    main()
