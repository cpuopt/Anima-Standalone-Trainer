export interface Prompt { text: string; w: number; h: number; s: number; l: number; d: number; sampler: string; strength: number; scheduler: string; skip: boolean; sourceNegative?: string }
export const defaultNegativePrompt = 'worst quality, low quality, score_1, score_2, score_3, blurry, jpeg artifacts, sepia, low quality, worst quality, blurry, bad anatomy, extra limbs, deformed, watermark, text, signature, bareness, artifacts, hands, copyrights name, jpeg_artifacts, scan_artifacts, bad hands, missing fingers, extra digit, fewer digits, artistic error, ye-pop, deviantart, logo, patreon logo';
export const samplers = ['euler', 'heun', 'er_sde'];
export const schedulers = ['linear', 'sgm_uniform', 'beta57', 'karras', 'exponential', 'quadratic'];
export function parsePromptLine(input: string): Prompt {
  let line = input.trim(); const skip = line.startsWith('#'); if (skip) line = line.slice(1).trim();
  const sourceNegative=line.match(/\s+--n(?:\s+(.*))?$/i)?.[1]||'';
  line=line.replace(/\s+--n(?:\s+.*)?$/i,'');
  const p: Prompt = {text: '', w:832, h:1216, s:20, l:7.5, d:1, sampler:'euler', strength:1, scheduler:'linear', skip,sourceNegative};
  for (const m of line.matchAll(/\s+--([whdsl])\s+(\S+)/g)) (p as any)[m[1]!] = m[1] === 'l' ? parseFloat(m[2]!) : parseInt(m[2]!);
  const sampler = line.match(/\s+--ss\s+(\S+)/i)?.[1]?.toLowerCase();
  const scheduler = line.match(/\s+--sched\s+(\S+)/i)?.[1]?.toLowerCase();
  if (sampler && samplers.includes(sampler)) p.sampler = sampler;
  if (scheduler && schedulers.includes(scheduler)) p.scheduler = scheduler;
  const strength = Number(line.match(/\s+--ls\s+(\S+)/i)?.[1]); if (Number.isFinite(strength)) p.strength = Math.max(0, Math.min(2, strength));
  p.text = line.replace(/\s+--n\s+.*$/i, '').replace(/\s+--(?:ss|sched|ls)\s+\S+/gi, '').replace(/\s+--[whdsl]\s+\S+/gi, '').trim(); return p;
}
export function serializePrompt(p: Prompt, architecture: string, negativePrompt: string): string {
  let line = `${p.text.replace(/[\r\n]+/g, ' ').trim()} --w ${p.w} --h ${p.h} --s ${p.s} --d ${p.d} --l ${p.l}`;
  if (!['krea2','moss_image'].includes(architecture)) line += ` --ss ${p.sampler || 'euler'} --ls ${Math.max(0, Math.min(2, Number(p.strength) || 0))} --sched ${p.scheduler || 'linear'}`;
  const negative = (p.sourceNegative ?? negativePrompt).replace(/[\r\n]+/g, ' ').trim(); if (negative) line += ` --n ${negative}`;
  return !['krea2','moss_image'].includes(architecture) && p.skip ? `# ${line}` : line;
}
export function applyGlobalNegative(prompts: Prompt[], negativePrompt: string): void {
  for (const p of prompts) p.sourceNegative=negativePrompt
}
