// Keep in sync with library/caption_split.py using the shared fixture suite.
export type CaptionSplit = { tags: string; natural_language: string; method: 'multiline' | 'mixed' | 'tags' | 'natural_language'; separator: string }
export function splitCaption(raw: string): CaptionSplit {
  const text = raw.replace(/(?:\r\n|\n|\r)$/, '')
  const result = (tags: string, natural_language: string, method: CaptionSplit['method'], separator = ''): CaptionSplit => ({ tags, natural_language, method, separator })
  const newline = /\r\n|\n|\r/.exec(text)
  if (newline) return result(text.slice(0, newline.index), text.slice(newline.index + newline[0].length), 'multiline', newline[0])
  const terminal = /[!?。！？]|(?<![A-Za-z0-9])\.|\.(?![A-Za-z0-9])/g
  const words = (value: string) => value.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g)?.length || 0
  if (!terminal.test(text)) {
    const candidates = !text.includes(',') ? [text] : Array.from(text.matchAll(/(?:^|, +)([A-Z][A-Za-z]*)\b/g), match => text.slice(match.index! + match[0].length - match[1].length).split(',', 1)[0]!)
    return candidates.some(clause => words(clause) >= 6) ? result('', text, 'natural_language') : result(text, '', 'tags')
  }
  for (const candidate of text.matchAll(/(?:^|, +)([A-Z][A-Za-z]*)\b/g)) {
    const start = candidate.index! + candidate[0].length - candidate[1].length
    terminal.lastIndex = start
    const ending = terminal.exec(text)
    if (!ending || words(text.slice(start, ending.index).split(',', 1)[0]) < 6) continue
    if (start === 0) return result('', text, 'natural_language')
    return result(text.slice(0, candidate.index), text.slice(start), 'mixed', text.slice(candidate.index, start))
  }
  return result('', text, 'natural_language')
}
