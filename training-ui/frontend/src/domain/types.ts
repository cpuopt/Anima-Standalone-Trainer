export type Config = Record<string, any>
export interface JobSummary { name: string; architecture: string; running: boolean; hasConfig: boolean; mtime: number }
export interface JobDocument { name: string; architecture: string; config: Config; dataset: Config }
export interface Prompt { text: string; width: number; height: number; steps: number; cfg: number; seed: number; [key: string]: any }
export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
export function canonical(value: any): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}'
  return JSON.stringify(value)
}
