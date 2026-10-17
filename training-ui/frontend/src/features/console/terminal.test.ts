import { expect,it } from 'vitest'
import { terminalText } from './terminal'
it('replaces tqdm progress lines, preserves CRLF and incomplete carriage returns',()=>{
  expect(terminalText('start\r\n0%\r25%\r100%\nnext\r')).toBe('start\n100%\nnext')
})
