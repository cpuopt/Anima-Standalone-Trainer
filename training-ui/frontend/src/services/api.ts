export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message) }
}
export interface ApiOptions { method?: string; body?: any; signal?: AbortSignal }
export async function api<T = any>(url: string, options: ApiOptions = {}): Promise<T> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  options.signal?.addEventListener('abort', abort, { once: true })
  if (options.signal?.aborted) controller.abort()
  const timeout = setTimeout(abort, 60000)
  try {
    const response = await fetch(url, {
      method: options.method || 'GET', signal: controller.signal,
      headers: options.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
    const text = await response.text()
    let data: any
    try { data = text ? JSON.parse(text) : null } catch { data = null }
    if (!response.ok) {
      if (response.status === 401) window.dispatchEvent(new Event('ui-access-expired'))
      throw new ApiError(data?.error || `${response.status} ${response.statusText}`, response.status)
    }
    return data as T
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', abort)
  }
}
export function jobUrl(name: string, suffix = '') { return `/api/jobs/${encodeURIComponent(name)}${suffix}` }
