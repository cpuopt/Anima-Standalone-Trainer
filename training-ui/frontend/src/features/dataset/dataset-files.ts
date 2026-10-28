export interface DatasetFile { file: File; path: string }
const images = /\.(png|jpe?g|webp|bmp|avif|jxl)$/i
export const isImage = (name: string) => images.test(name)
export const isArchive = (name: string) => /\.(zip|7z)$/i.test(name)
export function selectDatasetFiles(files: DatasetFile[]) {
  const kept = files.filter(f => isImage(f.path) || /\.txt$/i.test(f.path) || isArchive(f.path))
  const paths = new Set<string>()
  for (const item of kept) {
    const path = item.path.replace(/\\/g, '/')
    if (path.startsWith('/') || path.split('/').some(p => !p || p === '.' || p === '..')) throw Error('文件路径无效')
    if (paths.has(path.toLowerCase())) throw Error(`重复或大小写冲突文件：${path}`)
    paths.add(path.toLowerCase())
  }
  if (kept.filter(f => isArchive(f.path)).length && (kept.length !== 1 || !isArchive(kept[0]!.path))) throw Error('请单独选择一个 ZIP / 7z，不要与其他文件混合')
  if (!kept.length) throw Error('未找到图片、TXT、ZIP 或 7z')
  if (kept.length > 10000) throw Error('最多导入 10000 个文件')
  if (kept.some(f => f.file.size > 1024 ** 3)) throw Error('单文件（含压缩包）不能超过 1 GiB')
  if (kept.reduce((total, f) => total + f.file.size, 0) > 8 * 1024 ** 3) throw Error('上传合计不能超过 8 GiB')
  const names = new Set(kept.map(f => f.path)), paired = new Set<string>()
  let missing = 0
  for (const item of kept.filter(f => isImage(f.path))) {
    const caption = item.path.replace(/\.[^.]+$/, '.txt')
    if (names.has(caption)) paired.add(caption)
    else missing++
  }
  return { files: kept, skipped: files.length - kept.length, bytes: kept.reduce((n, f) => n + f.file.size, 0),
    images: kept.filter(f => isImage(f.path)).length, captions: kept.filter(f => /\.txt$/i.test(f.path)).length,
    missing, orphan: kept.filter(f => /\.txt$/i.test(f.path) && !paired.has(f.path)).length }
}

// A directory reader returns batches; read until an empty batch, not just once.
export async function droppedFiles(transfer: DataTransfer): Promise<DatasetFile[]> {
  const result: DatasetFile[] = []
  let visited = 0
  async function visit(entry: any, prefix = '', depth = 0): Promise<void> {
    if (++visited > 10000 || depth > 32) throw Error('文件数量或目录层级超过限制')
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => entry.file(resolve, reject))
      result.push({ file, path: prefix + entry.name })
    } else if (entry.isDirectory) {
      const reader = entry.createReader()
      for (;;) {
        const batch = await new Promise<any[]>((resolve, reject) => reader.readEntries(resolve, reject))
        if (!batch.length) break
        for (const child of batch) await visit(child, prefix + entry.name + '/', depth + 1)
      }
    }
  }
  // Capture items synchronously, before awaiting: drag data is only available in the drop event.
  const entries = Array.from(transfer.items || []).filter(i => i.kind === 'file').map(i => i.webkitGetAsEntry?.()).filter(Boolean)
  const fallback = Array.from(transfer.files)
  if (entries.length) for (const entry of entries) await visit(entry)
  else for (const file of fallback) result.push({ file, path: file.webkitRelativePath || file.name })
  return result
}

export function uploadDatasetFile(id: string, item: DatasetFile, signal: AbortSignal, progress: (bytes: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const abort = () => xhr.abort()
    const cleanup = () => signal.removeEventListener('abort', abort)
    xhr.open('PUT', `/api/datasets/imports/${encodeURIComponent(id)}/file?path=${encodeURIComponent(item.path)}`)
    xhr.setRequestHeader('Content-Type', 'application/octet-stream')
    xhr.timeout = 15 * 60 * 1000
    xhr.upload.onprogress = e => progress(e.loaded)
    xhr.onload = () => {
      cleanup()
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else {
        let message = `上传失败（${xhr.status}）`
        try { message = JSON.parse(xhr.responseText).error || message } catch { /* not JSON */ }
        reject(Error(message))
      }
    }
    xhr.onerror = () => { cleanup(); reject(Error('上传连接中断，请重试')) }
    xhr.ontimeout = () => { cleanup(); reject(Error('上传超时，请重试')) }
    xhr.onabort = () => { cleanup(); reject(new DOMException('已取消', 'AbortError')) }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) { cleanup(); reject(new DOMException('已取消', 'AbortError')); return }
    xhr.send(item.file)
  })
}
