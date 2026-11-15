import { describe, expect, it } from 'vitest'
import { filterLogLines, keyLogEvents, logLines } from './log-view'

describe('console log views', () => {
  it('keeps traceback continuation lines in the error filter without losing raw text', () => {
    const raw = '12:00:00 INFO loaded\n12:00:01 ERROR failed\nTraceback (most recent call last):\n  File "train.py", line 1\nValueError: bad value\n12:00:02 INFO recovered'
    const lines = logLines(raw)
    expect(filterLogLines(lines,'','ERROR').map(line => line.text)).toEqual(raw.split('\n').slice(1,5))
    expect(filterLogLines(lines,'TRAIN.PY','ALL')).toHaveLength(1)
    expect(lines[5]!.level).toBe('INFO')
    expect(keyLogEvents(lines).some(line => line.text.includes('File "train.py"'))).toBe(false)
  })
  it('normalizes terminal carriage returns and ANSI while keeping unlevelled progress output', () => {
    const lines = logLines('\u001b[32m12:00:00 INFO loaded\u001b[0m\r\n0%\r25%\r100%\nnext')
    expect(lines.map(line => line.text)).toEqual(['12:00:00 INFO loaded','100%','next'])
    expect(lines[1]!.level).toBe('OTHER')
    expect(logLines('')).toEqual([])
  })
  it('derives a bounded event list only from actual lines and keeps their IDs for navigation', () => {
    const lines = logLines(Array.from({length:9},(_,i) => `12:00:0${i} INFO checkpoint saved ${i}`).join('\n'))
    const events = keyLogEvents(lines)
    expect(events).toHaveLength(6)
    expect(events[0]!.id).toBe(3)
    expect(keyLogEvents(logLines('no model state reported'))).toEqual([])
  })
})
