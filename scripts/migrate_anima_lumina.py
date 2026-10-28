"""Copy the old main environment to a dedicated environment, preserving versions.

Run with the OLD environment's Python. The source is never moved or removed.
Activation scripts and console launchers are recreated for the new location.
"""
import argparse
import importlib.metadata
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import sysconfig
import venv

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', type=Path, default=ROOT / 'venv-anima-lumina')
    args = parser.parse_args()
    target = args.target.resolve()
    if sys.prefix == sys.base_prefix:
        parser.error('Run this with the original virtual environment Python, not system Python.')
    if target.exists():
        parser.error('Target already exists; refusing to overwrite it.')
    source = Path(sys.prefix).resolve()
    if target == source or source in target.parents or target in source.parents:
        parser.error('Source and target must be separate directories.')
    if target in {(ROOT / name).resolve() for name in ('venv-krea2', 'venv-moss')}:
        parser.error('Target belongs to another backend.')
    print(f'Copying {source} to {target}; original retained.', flush=True)
    venv.EnvBuilder(with_pip=False).create(target)
    python = target / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    destination = json.loads(subprocess.check_output([str(python), '-c',
        'import sysconfig,json; print(json.dumps({k:sysconfig.get_path(k) for k in ("purelib","platlib","scripts")}))'], text=True))
    copied = set()
    for key in ('purelib', 'platlib'):
        src, dst = Path(sysconfig.get_path(key)), Path(destination[key])
        if (str(src), str(dst)) not in copied:
            shutil.copytree(src, dst, dirs_exist_ok=True,
                            ignore=shutil.ignore_patterns('__pycache__'))
            copied.add((str(src), str(dst)))
    # Generate platform-native launchers with the NEW interpreter embedded.
    from pip._vendor.distlib.scripts import ScriptMaker
    maker = ScriptMaker(None, destination['scripts'])
    maker.executable = str(python)
    maker.clobber = True
    maker.variants = {''}
    for dist in importlib.metadata.distributions(path=[destination['purelib']]):
        for ep in dist.entry_points:
            if ep.group in ('console_scripts', 'gui_scripts'):
                maker.make(f'{ep.name} = {ep.value}', options={'gui': ep.group == 'gui_scripts'})
    subprocess.run([str(python), '-m', 'pip', 'check'], check=True)
    print(f'Migrated to {target}. Original retained at {source}.', flush=True)


if __name__ == '__main__':
    main()
