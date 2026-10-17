import { describe, expect, it } from 'vitest'
import { applyGlobalNegative, parsePromptLine, serializePrompt } from './model'
describe('prompt compatibility',()=>{
  it('round-trips Anima flags, skip, zero strength, negative prompt and unknown flags',()=>{
    const line='# a forest --custom foo --w 832 --h 1216 --s 28 --d 7 --l 3.5 --ss heun --ls 0 --sched karras --n bad hands'
    const p=parsePromptLine(line)
    expect(p).toMatchObject({text:'a forest --custom foo',w:832,h:1216,s:28,d:7,l:3.5,sampler:'heun',strength:0,scheduler:'karras',skip:true})
    expect(serializePrompt(p,'anima','bad hands')).toBe(line)
  })
  it('keeps RAW training prompts distinct from independent Turbo settings',()=>{
    const p=parsePromptLine('a bird --w 1024 --h 1024 --s 52 --d 1 --l 3.5')
    expect(serializePrompt(p,'krea2','')).toBe('a bird --w 1024 --h 1024 --s 52 --d 1 --l 3.5')
    expect(p.strength).toBe(1)
  })
  it('normalizes line breaks without introducing extra prompt lines',()=>{
    const p=parsePromptLine('a bird');p.text='a\nbird'
    expect(serializePrompt(p,'anima','bad\nhands')).not.toContain('\n')
  })
  it('preserves distinct saved negatives until the global negative is deliberately applied',()=>{
    const prompts=[parsePromptLine('bird --n bad wings'),parsePromptLine('forest --n blurry trees'),parsePromptLine('lake')]
    prompts[0]!.text='a bird'
    expect(serializePrompt(prompts[0]!,'anima','default negative')).toContain('--n bad wings')
    expect(serializePrompt(prompts[1]!,'anima','default negative')).toContain('--n blurry trees')
    expect(serializePrompt(prompts[2]!,'anima','default negative')).not.toContain('--n ')
    applyGlobalNegative(prompts,'new global negative')
    expect(prompts.map(p=>serializePrompt(p,'anima','new global negative')).every(line=>line.endsWith('--n new global negative'))).toBe(true)
    applyGlobalNegative(prompts,'');expect(serializePrompt(prompts[0]!,'anima','')).not.toContain('--n ')
  })
})
