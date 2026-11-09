import { splitCaption } from './caption-split'

export type CaptionConfig = {
  caption_prefix?: string; caption_suffix?: string; natural_language_prefix?: string; tags_suffix?: string
  shuffle_caption?: boolean; caption_separator?: string; secondary_separator?: string
  token_warmup_step?: number; caption_tag_dropout_rate?: number; enable_wildcard?: boolean
}
export type PromptSegment = { kind: string; label: string; text: string }

// Deterministic view before stochastic shuffle, wildcard choice, warmup and dropout.
export function captionPreview(raw: string, config: CaptionConfig = {}): PromptSegment[] {
  const segments: PromptSegment[] = []
  const add = (kind: string, label: string, text: string | undefined) => { if (text) segments.push({ kind, label, text }) }
  const split = config.shuffle_caption || config.natural_language_prefix || config.tags_suffix
  const parts = splitCaption(raw)
  const normalize = (text: string) => {
    if (config.shuffle_caption || config.token_warmup_step || config.caption_tag_dropout_rate) {
      text = text.trim().split(config.caption_separator || ',').map(tag => tag.trim()).join(', ')
    }
    return config.secondary_separator ? text.split(config.secondary_separator).join(config.caption_separator || ',') : text
  }
  add('prefix', 'Caption 前缀', config.caption_prefix)
  if (config.caption_prefix && (!split || parts.tags)) add('separator', '分隔', ' ')
  add('tags', split ? 'Tags 部分' : 'Caption 正文', normalize(split ? parts.tags : raw.split('\n')[0]!))
  if (split && parts.tags && config.tags_suffix) {
    if (segments.some(s => s.text)) add('separator', '分隔', ' ')
    add('tags-suffix', 'tags部分后缀', config.tags_suffix)
  }
  if (split) {
    add('separator', '分隔', parts.method === 'natural_language' && segments.length ? ' ' : parts.separator)
    if (parts.natural_language) {
      add('natural-prefix', '自然语言部分前缀', config.natural_language_prefix)
      if (config.natural_language_prefix) add('separator', '分隔', ' ')
      add('natural', '自然语言部分', parts.natural_language)
    }
  }
  if (config.caption_suffix) {
    add('separator', '分隔', ' ')
    add('suffix', 'Caption 后缀', config.caption_suffix)
  }
  return segments
}
