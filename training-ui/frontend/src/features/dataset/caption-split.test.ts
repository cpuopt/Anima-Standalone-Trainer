import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { splitCaption } from './caption-split'

const fixtures = JSON.parse(readFileSync(resolve(process.cwd(), '../../tests/fixtures/caption_split.json'), 'utf8')) as { name: string; input: string; expected: ReturnType<typeof splitCaption> }[]
describe('training/preview caption boundary contract', () => {
  for (const fixture of fixtures) it(fixture.name, () => expect(splitCaption(fixture.input)).toEqual(fixture.expected))
})
