import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace

SPEC = importlib.util.spec_from_file_location('environment_manager', Path(__file__).resolve().parents[1] / 'scripts/environment_manager.py')
manager = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(manager)


class EnvironmentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='environment test ')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name, value in {'ROOT': self.root, 'RUNTIME': self.root / '.runtime',
                            'CACHE': self.root / '.runtime/cache', 'CONFIG': self.root / 'config.toml',
                            'STATE': self.root / '.runtime/state.json'}.items():
            p = patch.object(manager, name, value); p.start(); self.addCleanup(p.stop)

    def test_missing_environment_is_not_ready(self):
        result = manager.inspect('krea2', self.root / 'missing')
        self.assertEqual(result['status'], 'missing')
        self.assertFalse(result['dependencies'])

    def test_triton_missing_is_reported(self):
        with patch.object(manager.metadata, 'version', side_effect=manager.metadata.PackageNotFoundError), \
             patch.object(manager.importlib, 'import_module', side_effect=ModuleNotFoundError("No module named 'triton'", name='triton')):
            result = manager.check_triton()
        self.assertEqual(result['status'], 'missing')
        self.assertEqual(result['distributions'], {})

    def test_windows_triton_distribution_and_import_version(self):
        def version(name):
            if name == 'triton-windows':
                return '3.3.0.post19'
            raise manager.metadata.PackageNotFoundError(name)
        with patch.object(manager.metadata, 'version', side_effect=version), \
             patch.object(manager.importlib, 'import_module', return_value=SimpleNamespace(__version__='3.3.0')):
            result = manager.check_triton()
        self.assertEqual(result['status'], 'importable')
        self.assertEqual(result['version'], '3.3.0')
        self.assertEqual(result['distributions'], {'triton-windows': '3.3.0.post19'})

    def test_triton_broken_import_is_not_reported_as_missing(self):
        for error in (OSError('DLL load failed'), ModuleNotFoundError('missing dependency', name='dependency')):
            with self.subTest(error=error), \
                 patch.object(manager.metadata, 'version', side_effect=manager.metadata.PackageNotFoundError), \
                 patch.object(manager.importlib, 'import_module', side_effect=error):
                self.assertEqual(manager.check_triton()['status'], 'broken')

    def test_installed_triton_with_missing_module_is_broken(self):
        with patch.object(manager.metadata, 'version', return_value='3.3.0'), \
             patch.object(manager.importlib, 'import_module', side_effect=ModuleNotFoundError('triton', name='triton')):
            self.assertEqual(manager.check_triton()['status'], 'broken')

    def test_activation_preserves_unrelated_configuration_and_registers_source(self):
        old = self.root / 'venv-krea2'; old.mkdir(); (old / 'pyvenv.cfg').write_text('')
        manager.CONFIG.write_text('main_venv_path = "control"\n[ui]\ntheme = "dark"\n', encoding='utf-8')
        report = {'id': 'krea2', 'path': str(self.root / 'new environment'), 'dependencies': True}
        manager.activate('krea2', report)
        self.assertEqual(manager.config()['ui']['theme'], 'dark')
        self.assertEqual(manager.current('krea2'), self.root / 'new environment')
        self.assertEqual(json.loads(manager.STATE.read_text())['history'][0]['path'], str(old))
        self.assertTrue(old.exists())

    def test_install_never_overwrites_existing_target(self):
        with self.assertRaisesRegex(RuntimeError, 'existing directory'):
            manager.install('main', target=self.root)

    def test_insufficient_space_fails_before_environment_creation(self):
        with patch.object(manager.shutil, 'disk_usage') as disk:
            disk.return_value.free = 0
            with self.assertRaisesRegex(RuntimeError, 'free space'):
                manager.install('main')
        self.assertFalse((manager.RUNTIME / 'environments').exists())

    def test_target_probe_has_bounded_timeout(self):
        target = self.root / 'environment'; exe = manager.python_at(target)
        exe.parent.mkdir(parents=True); exe.touch()
        with patch.object(manager.subprocess, 'run', side_effect=subprocess.TimeoutExpired('probe', 120)) as run:
            with self.assertRaises(subprocess.TimeoutExpired):
                manager.inspect('main', target)
            self.assertEqual(run.call_args.kwargs['timeout'], 120)

    def test_process_owned_operation_lock_is_exclusive_and_released(self):
        with manager.operation_lock():
            self.assertTrue((manager.RUNTIME / 'environment-active.json').exists())
            with self.assertRaises(OSError):
                with manager.operation_lock():
                    pass
        self.assertFalse((manager.RUNTIME / 'environment-active.json').exists())
        with manager.operation_lock():
            pass


if __name__ == '__main__':
    unittest.main()
