import { describe, expect, it } from 'vitest'
import { groupSamples, moveSamples, rangePaths, type Sample } from './gallery'
const sample = (path: string, mtime = 0): Sample => ({ path, name: path, mtime })
describe('sample gallery ordering', () => {
  it('groups prompt indexes and keeps new images before manually ordered images', () => {
    const groups = groupSamples([sample('a_01_20261016190000.png',1),sample('b_01_20261016190100.png',2),sample('plain.png')], [{path:'a_01_20261016190000.png',group:'01'}])
    expect(groups.map(g => g.key)).toEqual(['01','default'])
    expect(groups[0]!.images[0]!.path).toBe('b_01_20261016190100.png')
  })
  it('moves a selection across groups in visual order and respects before/after', () => {
    const groups = [{key:'00',images:[sample('a'),sample('b')]},{key:'01',images:[sample('c'),sample('d')]}]
    const moved = moveSamples(groups,['b','a'],'01','c',true)
    expect(moved[0]!.images).toEqual([])
    expect(moved[1]!.images.map(i => i.path)).toEqual(['c','a','b','d'])
    expect(groups[0]!.images).toHaveLength(2)
  })
  it('ignores drops on a selected target and unknown target groups', () => {
    const groups = [{key:'00',images:[sample('a'),sample('b')]}]
    expect(moveSamples(groups,['a'],'00','a')).toBe(groups)
    expect(moveSamples(groups,['a'],'missing')).toBe(groups)
  })
  it('selects ranges in visible order in either direction', () => {
    const images = ['a','b','c','d'].map(p => sample(p))
    expect(rangePaths(images,'c','a')).toEqual(['a','b','c'])
    expect(rangePaths(images,null,'c')).toEqual(['c'])
  })
})
