import { describe, expect, it } from 'vitest'
import { captionPreview, type CaptionConfig } from './caption-preview'

const config = { caption_prefix: 'trigger', caption_suffix: 'end', tags_suffix: 'tags end', natural_language_prefix: 'Describe:' }
const render = (raw: string, options: CaptionConfig = config) => captionPreview(raw, options).map(s => s.text).join('')
describe('processed caption preview', () => {
  it('places fixed text around both regions without losing multiline descriptions', () => {
    expect(render('solo, red hair\r\nA girl looks forward.\r\nSecond line.\r\n')).toBe('trigger solo, red hair tags end\r\nDescribe: A girl looks forward.\r\nSecond line. end')
  })
  it('omits region affixes when that region is absent', () => {
    expect(render('solo')).toBe('trigger solo tags end end')
    expect(render('A girl with white hair looks forward.')).toBe('trigger Describe: A girl with white hair looks forward. end')
  })
  it('preserves multiline descriptions without shuffle or region affixes', () => {
    expect(render('solo\nDescription.', { caption_prefix: 'trigger', caption_suffix: 'end', tags_suffix: '', natural_language_prefix: '' })).toBe('trigger solo\nDescription. end')
    for (const newline of ['\n', '\r\n', '\r']) {
      for (const enable_wildcard of [false, true]) {
        const text = ['solo', 'Description, unchanged.', '', '  Another line.'].join(newline)
        expect(render(text + newline, { enable_wildcard })).toBe(text)
      }
    }
  })
})
