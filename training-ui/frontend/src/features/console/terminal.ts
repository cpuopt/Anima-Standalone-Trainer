/** tqdm uses a carriage return to replace the current progress line. */
export function terminalText(text:string):string {
  return text.split('\n').map(line=>{
    let current='';for(const part of line.split('\r'))if(part)current=part
    return current
  }).join('\n')
}
