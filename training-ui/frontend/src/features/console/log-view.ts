import { terminalText } from './terminal'

export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG' | 'OTHER'
export interface LogLine { id: number; text: string; level: LogLevel; time: string }

/** Keep multiline traceback/continuation lines with their preceding severity. */
export function logLines(text: string): LogLine[] {
  if (!text) return []
  let level: LogLevel = 'OTHER'
  return terminalText(text).replace(/\u001b\[[0-?]*[ -/]*[@-~]/g,'').split('\n').map((text,id) => {
    const explicit = text.match(/\b(INFO|WARNING|WARN|ERROR|CRITICAL|FATAL|DEBUG|TRACE)\b/)
    if (explicit) level = explicit[1] === 'WARNING' ? 'WARN' : ['CRITICAL','FATAL'].includes(explicit[1]!) ? 'ERROR' : explicit[1] === 'TRACE' ? 'DEBUG' : explicit[1] as LogLevel
    else if (/Traceback \(most recent call last\)|^\w*(?:Error|Exception):/.test(text)) level = 'ERROR'
    else if (/\b\w*Warning:/.test(text)) level = 'WARN'
    else if (/^\S/.test(text) && !text.startsWith('During handling')) level = 'OTHER'
    return { id,text,level,time:text.match(/\b\d{2}:\d{2}:\d{2}\b/)?.[0] || '' }
  })
}

export function filterLogLines(lines: LogLine[], query: string, level: string) {
  const needle = query.trim().toLowerCase()
  return lines.filter(line => (level === 'ALL' || line.level === level) && (!needle || line.text.toLowerCase().includes(needle)))
}

/** Only surface events that are present in the log; never infer progress. */
export function keyLogEvents(lines: LogLine[]) {
  return lines.filter(line => line.text.trim() && (
    (['WARN','ERROR'].includes(line.level) && (line.time || /\b(?:WARNING|WARN|ERROR|CRITICAL|FATAL)\b|^\w*(?:Error|Exception):|\w*Warning:/.test(line.text))) ||
    /加载完成|加载总耗时|保存完成|写入模型权重.*完成|\bloaded\b|checkpoint.*saved|saving.*checkpoint|starting.*(?:train|generation)|\bepoch\s+\d+\s*\/|\b(?:train|sample)\.(?:before|after)_[a-z_]+/i.test(line.text)
  )).slice(-6)
}
