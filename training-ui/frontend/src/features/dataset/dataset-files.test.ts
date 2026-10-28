import { afterEach, describe, expect, it, vi } from 'vitest'
import { droppedFiles, selectDatasetFiles, uploadDatasetFile } from './dataset-files'

const item = (path: string, value = 'x') => ({ file: new File([value], path.split('/').pop()!), path })
afterEach(() => vi.unstubAllGlobals())
describe('dataset file selection', () => {
  it('matches captions by relative directory and reports skipped/orphan files', () => {
    const result = selectDatasetFiles([item('a/x.png'), item('a/x.txt'), item('b/x.png'), item('b/orphan.txt'), item('readme.md')])
    expect(result).toMatchObject({ images: 2, captions: 2, missing: 1, orphan: 1, skipped: 1 })
  })
  it('rejects duplicates, unsafe paths, mixed or multiple archives', () => {
    for (const files of [[item('a.png'), item('A.PNG')], [item('../a.png')], [item('a.zip'), item('a.png')], [item('a.zip'), item('b.7z')]]) expect(() => selectDatasetFiles(files)).toThrow()
    expect(selectDatasetFiles([item('a.7z')]).files).toHaveLength(1)
  })
  it('reads every directory batch and preserves nested relative paths', async () => {
    const file = (name: string) => ({ isFile: true, name, file: (resolve: any) => resolve(new File(['x'], name)) })
    const batches = [[file('a.png')], [file('a.txt')], []]
    const folder = { isDirectory: true, name: '人物', createReader: () => ({ readEntries: (resolve: any) => resolve(batches.shift()) }) }
    const transfer = { items: [{ kind: 'file', webkitGetAsEntry: () => folder }], files: [] } as unknown as DataTransfer
    expect((await droppedFiles(transfer)).map(f => f.path)).toEqual(['人物/a.png', '人物/a.txt'])
    expect(batches).toHaveLength(0)
  })
})
describe('stream upload adapter', () => {
  it('encodes paths, sends raw files and forwards progress', async () => {
    let xhr: any
    class FakeXHR {
      upload: any = {}; status = 200; responseText = ''; open = vi.fn(); setRequestHeader = vi.fn(); timeout = 0
      onload: any; onabort: any; send = vi.fn(); abort = vi.fn(() => this.onabort())
      constructor() { xhr = this }
    }
    vi.stubGlobal('XMLHttpRequest', FakeXHR)
    const progress = vi.fn(), file = item('人物/a.png'), controller = new AbortController()
    const pending = uploadDatasetFile('id', file, controller.signal, progress)
    expect(xhr.open).toHaveBeenCalledWith('PUT', expect.stringContaining(encodeURIComponent(file.path)))
    expect(xhr.send).toHaveBeenCalledWith(file.file)
    xhr.upload.onprogress({ loaded: 42 }); expect(progress).toHaveBeenCalledWith(42)
    xhr.onload(); await pending
    controller.abort(); expect(xhr.abort).not.toHaveBeenCalled()
  })
  it('cancels an in-flight upload and propagates server failures', async () => {
    let xhr: any
    class FakeXHR {
      upload = {}; status = 409; responseText = '{"error":"重复文件"}'; timeout = 0; onload: any; onabort: any
      open() {} setRequestHeader() {} send() {} abort() { this.onabort() }
      constructor() { xhr = this }
    }
    vi.stubGlobal('XMLHttpRequest', FakeXHR)
    const controller = new AbortController(), pending = uploadDatasetFile('id', item('a.png'), controller.signal, () => {})
    controller.abort(); await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    const failed = uploadDatasetFile('id', item('a.png'), new AbortController().signal, () => {})
    xhr.onload(); await expect(failed).rejects.toThrow('重复文件')
  })
})
