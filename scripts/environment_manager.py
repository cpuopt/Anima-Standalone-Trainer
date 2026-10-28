"""Shared Windows/Linux environment installer. Never installs into a live environment."""
import argparse
import contextlib
import datetime
import importlib
import importlib.metadata as metadata
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import tomllib
import uuid
import venv
import threading

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / '.runtime'
CACHE = RUNTIME / 'uv-cache'
CONFIG = ROOT / 'training-ui/global_config.toml'
STATE = RUNTIME / 'environment-state.json'
UV = '0.12.18'
KEYS = {'main': 'main_venv_path', 'anima-lumina': 'anima_lumina_venv_path',
        'krea2': 'krea2_venv_path', 'moss': 'moss_venv_path'}
DEFAULTS = {'main': 'venv', 'anima-lumina': 'venv-anima-lumina', 'krea2': 'venv-krea2', 'moss': 'venv-moss'}


def process_alive(pid):
    if os.name == 'nt':
        import ctypes
        from ctypes import wintypes
        kernel = ctypes.windll.kernel32
        kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
        kernel.GetExitCodeProcess.restype = wintypes.BOOL
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        handle = kernel.OpenProcess(0x1000, False, int(pid))
        if not handle:
            return False
        try:
            code = wintypes.DWORD()
            return bool(kernel.GetExitCodeProcess(handle, ctypes.byref(code))) and code.value == 259
        finally:
            kernel.CloseHandle(handle)
    try:
        os.kill(int(pid), 0)
        return True
    except ProcessLookupError:
        return False


def watch_parent():
    parent = os.environ.get('ENVIRONMENT_PARENT_PID')
    if not parent:
        return
    def watch():
        while True:
            time.sleep(2)
            if not process_alive(int(parent)):
                if os.name == 'nt':
                    subprocess.run(['taskkill', '/PID', str(os.getpid()), '/F', '/T'],
                                   creationflags=subprocess.CREATE_NO_WINDOW)
                else:
                    import signal
                    os.killpg(os.getpgrp(), signal.SIGKILL)
                os._exit(125)
    threading.Thread(target=watch, daemon=True).start()


def atomic_json(file, value):
    file.parent.mkdir(parents=True, exist_ok=True)
    tmp = file.with_name(file.name + '.' + uuid.uuid4().hex + '.tmp')
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    os.replace(tmp, file)


def config():
    return tomllib.loads(CONFIG.read_text('utf-8-sig')) if CONFIG.exists() else {}


def current(env_id):
    cfg = config()
    value = cfg.get(KEYS[env_id])
    if env_id == 'anima-lumina':
        value = value or cfg.get('venv_path')
    return Path(value).resolve() if value else ROOT / DEFAULTS[env_id]


def python_at(directory):
    return directory / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')


def run(args, **kwargs):
    print('+ ' + ' '.join(map(str, args)), flush=True)
    subprocess.run(list(map(str, args)), check=True, **kwargs)


@contextlib.contextmanager
def operation_lock():
    RUNTIME.mkdir(exist_ok=True)
    # OS-owned lock is automatically released after process-tree termination.
    with (RUNTIME / 'environment-operation.lock').open('a+b') as handle:
        handle.seek(0); handle.write(b'0'); handle.flush(); handle.seek(0)
        if os.name == 'nt':
            import msvcrt
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            atomic_json(RUNTIME / 'environment-active.json', {'pid': os.getpid(), 'started': time.time()})
            yield
        finally:
            (RUNTIME / 'environment-active.json').unlink(missing_ok=True)
            handle.seek(0)
            if os.name == 'nt':
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle, fcntl.LOCK_UN)


def lock_file(env_id, cuda='cu128'):
    return ROOT / 'requirements' / (f'{env_id}-{cuda}.lock.txt' if env_id != 'main' else 'main.lock.txt')


def check_triton():
    """Optional import probe, not a GPU compilation test or installation request."""
    result = {'status': 'missing', 'version': None, 'distributions': {}, 'error': None}
    # Windows wheels use the distribution name triton-windows but import triton.
    for name in ('triton', 'triton-windows'):
        try:
            result['distributions'][name] = metadata.version(name)
        except metadata.PackageNotFoundError:
            pass
    try:
        module = importlib.import_module('triton')
        result['status'] = 'importable'
        result['version'] = getattr(module, '__version__', None)
    except ModuleNotFoundError as exc:
        result['status'] = 'missing' if exc.name == 'triton' and not result['distributions'] else 'broken'
        result['error'] = str(exc)
    except Exception as exc:
        result['status'] = 'broken'
        result['error'] = f'{type(exc).__name__}: {exc}'
    return result


def check(env_id, directory, cuda='cu128'):
    """Invoked WITH the target interpreter; no model files are downloaded."""
    result = {'id': env_id, 'path': str(directory), 'python': sys.version.split()[0],
              'versions': {}, 'cuda': None, 'cuda_profile': cuda, 'dependencies': False, 'errors': [], 'checked_at': time.time()}
    if env_id != 'main':
        # Missing/broken optional acceleration must not invalidate ordinary training.
        result['triton'] = check_triton()
    names = ['uv'] if env_id == 'main' else ['torch', 'torchvision', 'transformers', 'diffusers', 'accelerate', 'numpy', 'bitsandbytes', 'safetensors', 'tensorboard']
    for name in names:
        try:
            result['versions'][name] = metadata.version(name)
        except metadata.PackageNotFoundError:
            result['errors'].append(f'Missing package: {name}')
    if sys.version_info[:2] != (3, 12):
        result['errors'].append('Python 3.12 required')
    try:
        if env_id == 'main':
            if metadata.version('uv') != UV:
                result['errors'].append('uv version mismatch')
            try:
                metadata.version('torch')
                result['errors'].append('Main environment must not contain torch')
            except metadata.PackageNotFoundError:
                pass
        else:
            import torch, torchvision, transformers, diffusers, accelerate
            from packaging.requirements import Requirement
            for line in lock_file(env_id, cuda).read_text('utf-8').splitlines():
                line = line.strip()
                if not line or line.startswith(('#', '-', '.')):
                    continue
                req = Requirement(line)
                if not req.marker or req.marker.evaluate():
                    version = metadata.version(req.name)
                    if not req.specifier.contains(version):
                        result['errors'].append(f'{req.name}: {version} does not match {req.specifier}')
            result['cuda'] = torch.cuda.is_available()
            result['cuda_version'] = torch.version.cuda
            result['link_mode'] = 'hardlink' if Path(torch.__file__).stat().st_nlink > 1 else 'copy-or-unverified'
            if env_id == 'anima-lumina':
                # Root-level training entrypoints are scripts, not installed modules.
                # Match their actual launch sys.path without borrowing another venv.
                sys.path.insert(0, str(ROOT))
                import anima_train, anima_train_network, lumina_train, lumina_train_network
                import anima_gen, lumina_gen
                import cuda_direct_backend, wd_parallel
            elif env_id == 'krea2':
                from transformers import Qwen3VLModel
                import musubi_tuner.krea2_train_network as trainer
                import musubi_tuner.krea2_generate_image
                if not Path(trainer.__file__).resolve().is_relative_to((ROOT / 'vendor/musubi-tuner').resolve()):
                    raise RuntimeError('Krea backend is not the pinned local vendor')
            elif env_id == 'moss':
                # The vendor's 'library' must not be shadowed by the Anima package.
                run([sys.executable, ROOT / 'scripts/moss_runtime.py', 'check'], cwd=ROOT / 'vendor/sd-scripts')
    except Exception as exc:
        result['errors'].append(str(exc))
    result['dependencies'] = not result['errors']
    result['status'] = 'invalid' if result['errors'] else ('ready' if env_id == 'main' or result['cuda'] else 'no-cuda')
    return result


def inspect(env_id, directory, cuda='cu128'):
    executable = python_at(directory)
    if not executable.is_file():
        return {'id': env_id, 'path': str(directory), 'status': 'missing', 'dependencies': False, 'versions': {}, 'errors': []}
    command = [str(executable), '-u', str(Path(__file__).resolve()), 'probe', env_id, '--target', str(directory), '--cuda', cuda]
    child = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=120)
    for line in reversed(child.stdout.splitlines()):
        if line.startswith('ENVIRONMENT_RESULT '):
            return json.loads(line.partition(' ')[2])
    raise RuntimeError((child.stderr + child.stdout)[-6000:] or 'Environment probe failed')


def activate(env_id, report):
    """Retain the source for rollback; merge path into the latest config."""
    old = current(env_id)
    state = json.loads(STATE.read_text('utf-8')) if STATE.exists() else {'history': [], 'active': {}}
    if old != Path(report['path']) and (old / 'pyvenv.cfg').is_file():
        # Capture old metadata without importing its packages or requiring a working runtime.
        site = old / 'Lib/site-packages' if os.name == 'nt' else next(iter(old.glob('lib/python*/site-packages')), old / 'lib')
        versions = {d.metadata.get('Name', ''): d.version for d in metadata.distributions(path=[str(site)])}
        if not any(item['path'] == str(old) for item in state['history']):
            state['history'].append({'id': env_id, 'path': str(old), 'versions': versions, 'recorded': time.time()})
    state['active'][env_id] = report
    # Register history before switching: interruption can leave an unused candidate,
    # but never an unregistered old environment or a half-written config.
    atomic_json(STATE, state)
    text = CONFIG.read_text('utf-8-sig') if CONFIG.exists() else ''
    match = re.search(r'^\s*\[', text, flags=re.M)
    head, tail = (text[:match.start()], text[match.start():]) if match else (text, '')
    key = KEYS[env_id]
    value = f'{key} = {json.dumps(report["path"])}'
    if re.search(rf'^{key}\s*=', head, re.M):
        head = re.sub(rf'^{key}\s*=.*$', lambda _: value, head, flags=re.M)
    else:
        head = value + '\n' + head
    CONFIG.parent.mkdir(parents=True, exist_ok=True)
    tmp = CONFIG.with_suffix('.toml.' + uuid.uuid4().hex + '.tmp')
    tmp.write_text(head + tail, encoding='utf-8')
    tomllib.loads(tmp.read_text('utf-8'))
    os.replace(tmp, CONFIG)


def install(env_id, cuda='cu128', target=None):
    if sys.version_info[:2] != (3, 12):
        raise RuntimeError('Run the installer with Python 3.12')
    if env_id != 'krea2' and cuda != 'cu128':
        raise RuntimeError('This backend supports the pinned cu128 profile only')
    target = target or RUNTIME / 'environments' / env_id / (datetime.datetime.now().strftime('%Y%m%d-%H%M%S-') + uuid.uuid4().hex[:8])
    target = target.resolve()
    if target.exists():
        raise RuntimeError('Refusing to install over an existing directory')
    RUNTIME.mkdir(exist_ok=True)
    minimum = 1 if env_id == 'main' else 15
    parent = target.parent
    while not parent.exists():
        parent = parent.parent
    if min(shutil.disk_usage(RUNTIME).free, shutil.disk_usage(parent).free) < minimum * 1024**3:
        raise RuntimeError(f'At least {minimum} GiB free space required')
    CACHE.mkdir(parents=True, exist_ok=True)
    print(f'Creating final environment path: {target}', flush=True)
    venv.EnvBuilder(with_pip=env_id == 'main').create(target)
    executable = python_at(target)
    env = dict(os.environ)
    env.pop('PYTHONPATH', None); env.pop('VIRTUAL_ENV', None)
    env.update(UV_CACHE_DIR=str(CACHE), PYTHONUNBUFFERED='1', PYTHONIOENCODING='utf-8')
    if env_id == 'main':
        # Bootstrap exception: pip installs uv once into the new lightweight control env.
        run([executable, '-m', 'pip', 'install', f'uv=={UV}'], env=env)
        uv_python = executable
    else:
        uv_python = python_at(current('main'))
        main_report = inspect('main', current('main'))
        if not main_report['dependencies']:
            raise RuntimeError('Install the lightweight main environment first')
    uv_cmd = [uv_python, '-m', 'uv']
    link_mode = 'hardlink'
    try:
        trial = target / '.link-probe'
        source = CACHE / ('.link-probe-' + uuid.uuid4().hex)
        source.write_bytes(b'probe')
        try:
            os.link(source, trial)
        finally:
            source.unlink(missing_ok=True); trial.unlink(missing_ok=True)
    except OSError:
        link_mode = 'copy'
        print('WARNING: hardlinks unavailable (cross-volume/filesystem); using COPY, no storage deduplication.', flush=True)
    print(f'UV cache: {CACHE}; link mode: {link_mode}', flush=True)
    if env_id != 'main':
        if env_id == 'moss':
            from setup_moss import verify_vendor
            verify_vendor()
        if env_id == 'krea2':
            manifest = json.loads((ROOT / 'vendor/MUSUBI_VERSION.json').read_text('utf-8'))
            if manifest['revision'] != 'f8a1b03794a49239a3539015075f5123d6c07d66':
                raise RuntimeError('Unexpected Musubi revision')
        run(uv_cmd + ['pip', 'sync', '--python', executable, '--link-mode', link_mode,
                      '--index-strategy', 'unsafe-best-match', '--extra-index-url',
                      f'https://download.pytorch.org/whl/{cuda}', lock_file(env_id, cuda)], cwd=ROOT, env=env)
        local = [ROOT, ROOT / 'cuda_direct_pkg', ROOT / 'wd_parallel_pkg'] if env_id == 'anima-lumina' else ([ROOT / 'vendor/musubi-tuner'] if env_id == 'krea2' else [])
        for package in local:
            run(uv_cmd + ['pip', 'install', '--python', executable, '--link-mode', link_mode,
                          '--no-deps', '--no-build-isolation', '-e', package], cwd=ROOT, env=env)
        run(uv_cmd + ['pip', 'check', '--python', executable], env=env)
    report = inspect(env_id, target, cuda)
    report.update(cuda_profile=cuda, link_mode='bootstrap-copy' if env_id == 'main' else link_mode)
    if not report['dependencies']:
        raise RuntimeError(json.dumps(report, ensure_ascii=False))
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['install', 'check', 'probe', 'activate', 'migrate'])
    parser.add_argument('id', choices=list(KEYS), nargs='?', default='main')
    parser.add_argument('--cuda', choices=['cu124', 'cu128', 'cu130', 'cu132'], default='cu128')
    parser.add_argument('--target', '--venv', type=Path)
    parser.add_argument('--report', type=Path)
    parser.add_argument('--no-activate', action='store_true')
    args = parser.parse_args()
    if args.action == 'probe':
        report = check(args.id, args.target or current(args.id), args.cuda)
    elif args.action == 'check':
        report = inspect(args.id, args.target or current(args.id), args.cuda)
    else:
        if args.action in ('install', 'migrate') and not args.no_activate:
            # Direct CLI operations must not mutate environments under an active UI
            # trainer. A running local UI publishes an operation lease below.
            lease = RUNTIME / 'ui-training-active.json'
            if lease.exists():
                try:
                    active = json.loads(lease.read_text('utf-8'))
                    if not active.get('active'):
                        raise ValueError('Inactive lease')
                    if not process_alive(active['pid']):
                        raise ValueError('Expired lease')
                except (OSError, KeyError, ValueError):
                    pass
                else:
                    raise RuntimeError('UI training/generation is active; stop it before CLI environment changes')
        with operation_lock():
            if args.action == 'activate':
                report = json.loads(args.report.read_text('utf-8'))
                actual = inspect(args.id, Path(report['path']), report.get('cuda_profile', 'cu128'))
                if not actual['dependencies']:
                    raise RuntimeError('Candidate no longer passes verification')
                activate(args.id, report)
            elif args.action == 'migrate':
                snapshot = {'time': time.time(), 'config': config(), 'environments': {}}
                for env_id in KEYS:
                    try:
                        snapshot['environments'][env_id] = inspect(env_id, current(env_id))
                    except Exception as exc:
                        snapshot['environments'][env_id] = {'path': str(current(env_id)), 'error': str(exc)}
                snapshot_file = RUNTIME / 'migration-snapshots' / f'{time.time_ns()}.json'
                atomic_json(snapshot_file, snapshot)
                print(f'Migration snapshot: {snapshot_file}', flush=True)
                for env_id in KEYS:
                    report = install(env_id)
                    activate(env_id, report)
                    print('ENVIRONMENT_RESULT ' + json.dumps(report), flush=True)
            else:
                report = install(args.id, args.cuda, args.target)
                if not args.no_activate:
                    activate(args.id, report)
    if args.report:
        atomic_json(args.report, report)
    print('ENVIRONMENT_RESULT ' + json.dumps(report, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    watch_parent()
    main()
