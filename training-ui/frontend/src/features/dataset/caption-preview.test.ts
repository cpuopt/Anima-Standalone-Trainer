import { describe, expect, it } from 'vitest'
import { captionPreview } from './caption-preview'

const config = { caption_prefix: 'trigger', caption_suffix: 'end', tags_suffix: 'tags end', natural_language_prefix: 'Describe:' }
const render = (raw: string, options = config) => captionPreview(raw, options).map(s => s.text).join('')
describe('processed caption preview', () => {
  it('places fixed text around both regions without losing multiline descriptions', () => {
    expect(render('solo, red hair\r\nA girl looks forward.\r\nSecond line.\r\n')).toBe('trigger solo, red hair tags end\r\nDescribe: A girl looks forward.\r\nSecond line. end')
  })
  it('omits region affixes when that region is absent', () => {
    expect(render('solo')).toBe('trigger solo tags end end')
    expect(render('A girl with white hair looks forward.')).toBe('trigger Describe: A girl with white hair looks forward. end')
  })
  it('keeps the legacy first-line behavior when region processing is disabled', () => {
    expect(render('solo\nDescription.', { caption_prefix: 'trigger', caption_suffix: 'end', tags_suffix: '', natural_language_prefix: '' })).toBe('trigger solo end')
  })
})
