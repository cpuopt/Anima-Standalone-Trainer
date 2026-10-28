"""Verify actual hardlink identities; logical totals are NOT allocated disk usage."""
import json
import os
from pathlib import Path
import sys
import tomllib

ROOT = Path(__file__).resolve().parents[1]


def allocated_bytes(file):
    if os.name != 'nt':
        return os.stat(file).st_blocks * 512
    import ctypes
    from ctypes import wintypes
    class StandardInfo(ctypes.Structure):
        _fields_ = [('allocation', ctypes.c_longlong), ('end', ctypes.c_longlong),
                    ('links', wintypes.DWORD), ('delete_pending', ctypes.c_ubyte), ('directory', ctypes.c_ubyte)]
    kernel = ctypes.windll.kernel32
    kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
    kernel.CreateFileW.restype = wintypes.HANDLE
    kernel.GetFileInformationByHandleEx.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel.CreateFileW(str(file), 0x80, 7, None, 3, 0, None)
    if handle == ctypes.c_void_p(-1).value:
        raise OSError('Could not inspect file allocation')
    try:
        info = StandardInfo()
        if not kernel.GetFileInformationByHandleEx(handle, 1, ctypes.byref(info), ctypes.sizeof(info)):
            raise OSError('Could not read FILE_STANDARD_INFO')
        return info.allocation
    finally:
        kernel.CloseHandle(handle)


def main():
    cfg = tomllib.loads((ROOT / 'training-ui/global_config.toml').read_text('utf-8-sig'))
    roots = {name: Path(cfg[key]) for name, key in [('anima-lumina', 'anima_lumina_venv_path'), ('krea2', 'krea2_venv_path'), ('moss', 'moss_venv_path')]}
    def site(root):
        return root / 'Lib/site-packages' if os.name == 'nt' else next(root.glob('lib/python*/site-packages'))
    indexes = {}; all_files = {}; logical = 0
    for name, root in roots.items():
        files = {}
        for file in site(root).rglob('*'):
            if file.is_symlink() or not file.is_file():
                continue
            stat = file.stat(); identity = (stat.st_dev, stat.st_ino)
            files[identity] = (file, stat.st_size, stat.st_nlink)
            all_files[identity] = stat.st_size; logical += stat.st_size
        indexes[name] = files
    common = set(indexes['krea2']) & set(indexes['moss'])
    torch_shared = [indexes['krea2'][key] for key in common if 'torch' in indexes['krea2'][key][0].parts]
    samples = sorted(torch_shared, key=lambda item: item[1], reverse=True)[:3]
    report = {
        'note': 'Totals below use logical file sizes grouped by real filesystem identity, NOT folder size or allocated disk totals. Samples include actual allocation.',
        'environments': {name: str(root) for name, root in roots.items()},
        'logical_bytes_with_duplicates': logical,
        'unique_file_content_bytes': sum(all_files.values()),
        'shared_content_bytes_not_duplicated': logical - sum(all_files.values()),
        'krea_moss_shared_file_count': len(common),
        'krea_moss_shared_torch_file_count': len(torch_shared),
        'krea_moss_shared_torch_content_bytes': sum(item[1] for item in torch_shared),
        'samples': [{'file': str(file), 'logical_bytes': size, 'allocated_bytes': allocated_bytes(file), 'hardlink_count': links,
                     'same_file_in_both_environments': os.path.samefile(file, site(roots['moss']) / file.relative_to(site(roots['krea2'])))}
                    for file, size, links in samples],
    }
    if not samples or not all(sample['same_file_in_both_environments'] for sample in report['samples']):
        raise RuntimeError('Expected shared PyTorch hardlinks were not found')
    output = ROOT / '.runtime/dedup-report.json'
    output.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    main()
