export interface TimelineParams {
  architecture: string
  learningRate: number
  textEncoderLr?: number
  optimizerType: string
  scheduler: string
  warmupUnit: 'steps' | 'epochs'
  warmupSteps: number
  warmupEpochs: number
  numCycles: number
  minLrRatio: number
  power?: number
  durationUnit: 'epochs' | 'steps'
  maxEpochs: number
  saveEveryNEpochs: number
  maxSteps: number
  saveEveryNSteps: number
  outputName: string
  saveModelAs?: string
  savePrecision: string
  mixedPrecision: string
}

export interface WarmupResolution {
  active: boolean
  fraction: number
  schematic: boolean
  label: string
  field: 'lr_warmup_steps' | 'lr_warmup_epochs'
}

export function isScheduleFreeOptimizer(optimizerType: string): boolean {
  return /ScheduleFree$/i.test(optimizerType || '')
}

export function formatLr(v: number): string {
  if (!Number.isFinite(v) || v < 0) return '—'
  if (v === 0) return '0'
  if (v < 0.001 || v >= 1000) {
    return v.toExponential(2).replace(/\.?0+e/, 'e').replace('e+', 'e')
  }
  return String(Number(v.toPrecision(4)))
}

/**
 * Resolve warmup fraction across [0, 1] following library/lr_warmup.py & library/train_util.py:
 * - Warmup applies ONCE at the start of training.
 * - ScheduleFree optimizers use a dummy scheduler (no warmup / decay curve).
 * - In Anima/Lumina, `constant` auto-promotes to `constant_with_warmup` when epoch warmup > 0.
 * - Floating-point `lr_warmup_steps` in (0, 1) represents a direct ratio of total training steps.
 */
export function resolveWarmup(p: TimelineParams): WarmupResolution {
  const isEpochWarmup = p.architecture === 'anima' && p.warmupUnit === 'epochs'
  const field: 'lr_warmup_steps' | 'lr_warmup_epochs' = isEpochWarmup ? 'lr_warmup_epochs' : 'lr_warmup_steps'
  const raw = Math.max(0, Number(isEpochWarmup ? p.warmupEpochs : p.warmupSteps) || 0)

  if (isScheduleFreeOptimizer(p.optimizerType) || raw <= 0) {
    return { active: false, fraction: 0, schematic: false, label: '', field }
  }

  // `constant` in steps mode does not take warmup steps unless promoted via epoch warmup.
  if (p.scheduler === 'constant' && !isEpochWarmup) {
    return { active: false, fraction: 0, schematic: false, label: '', field }
  }

  const total = Math.max(1, Number(p.durationUnit === 'epochs' ? p.maxEpochs : p.maxSteps) || 1)
  const unitText = isEpochWarmup ? 'ep' : 'steps'

  // Float ratio in (0, 1) for step warmup (see library/lr_warmup.py:13)
  if (!isEpochWarmup && raw > 0 && raw < 1) {
    return {
      active: true,
      fraction: Math.min(0.95, raw),
      schematic: false,
      label: `预热 ${Math.round(raw * 100)}%`,
      field,
    }
  }

  const sameUnit = (isEpochWarmup && p.durationUnit === 'epochs') || (!isEpochWarmup && p.durationUnit === 'steps')
  if (sameUnit) {
    return {
      active: true,
      fraction: Math.min(0.95, raw / total),
      schematic: false,
      label: `预热 ${raw} ${unitText}`,
      field,
    }
  }

  return {
    active: true,
    fraction: 0.1,
    schematic: true,
    label: `预热 ${raw} ${unitText}（示意）`,
    field,
  }
}

/**
 * Evaluate the post-warmup scheduler multiplier at progress u in [0, 1].
 * Matches library/train_util.py + transformers/optimization.py and observed TensorBoard curves:
 * - cosine: 0.5 * (1 + cos(pi * u))
 * - cosine_with_restarts: `c` hard-restart cosine decay cycles (`c - 1` jumps): 0.5 * (1 + cos(pi * ((c * u) % 1))), 0 at u = 1
 * - cosine_with_min_lr: floor + (1 - floor) * 0.5 * (1 + cos(pi * c * u))
 * - linear: 1 - u
 * - polynomial: ((peak - 1e-7) * (1 - u)^power + 1e-7) / peak  (default power = 1.0)
 * - constant / ScheduleFree: 1.0
 */
export function evaluateScheduler(p: TimelineParams, u: number, peakLr = p.learningRate): number {
  if (isScheduleFreeOptimizer(p.optimizerType)) return 1
  const t = Math.max(0, Math.min(1, u))
  switch (p.scheduler) {
    case 'constant':
      return 1
    case 'linear':
      return 1 - t
    case 'polynomial': {
      const power = Number.isFinite(p.power) && Number(p.power) > 0 ? Number(p.power) : 1
      const peak = Math.max(1e-9, Number(peakLr) || 5e-5)
      const lrEnd = Math.min(peak, 1e-7)
      const val = (peak - lrEnd) * Math.pow(1 - t, power) + lrEnd
      return Math.max(0, val / peak)
    }
    case 'cosine_with_restarts': {
      const c = Math.max(1, Math.round(Number(p.numCycles) || 1))
      if (t >= 1) return 0
      const scaled = c * t
      const phase = Math.max(0, scaled - Math.floor(scaled + 1e-12))
      return 0.5 * (1 + Math.cos(Math.PI * Math.min(1, phase)))
    }
    case 'cosine_with_min_lr': {
      const floor = Math.max(0, Math.min(1, Number(p.minLrRatio) || 0))
      const c = Math.max(1, Math.round(Number(p.numCycles) || 1))
      return floor + (1 - floor) * 0.5 * (1 + Math.cos(Math.PI * c * t))
    }
    case 'cosine':
    default:
      return 0.5 * (1 + Math.cos(Math.PI * t))
  }
}

export const LR_LOG_MIN = -6 // 1e-6
export const LR_LOG_MAX = -3 // 1e-3

export function lrToGaugeRatio(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 0
  return Math.max(0, Math.min(1, (Math.log10(v) - LR_LOG_MIN) / (LR_LOG_MAX - LR_LOG_MIN)))
}

export function gaugeRatioToLr(ratio: number): number {
  const r = Math.max(0, Math.min(1, ratio))
  const raw = Math.pow(10, LR_LOG_MIN + r * (LR_LOG_MAX - LR_LOG_MIN))
  const exp = Math.floor(Math.log10(raw))
  const pow = Math.pow(10, exp - 1)
  return Number((Math.round(raw / pow) * pow).toPrecision(2))
}

export function stepLrValue(current: number, dir: -1 | 1): number {
  const cur = Number.isFinite(current) && current > 0 ? current : 0.00005
  let delta = 0.00001
  if (cur < 0.00001 || (dir < 0 && cur <= 0.00001)) delta = 0.000001
  else if (cur >= 0.0001 && (dir > 0 || cur > 0.0001)) delta = cur >= 0.001 ? 0.0001 : 0.00005
  return Math.max(1e-7, Number((cur + dir * delta).toPrecision(4)))
}

export function buildTimestepDensityPath(method: string, shiftRaw: number, width = 240, height = 46): string {
  const shift = Math.max(0.05, Number(shiftRaw) || 1)
  const padT = 6
  const padB = 2
  const plotH = height - padT - padB
  const samples = 60
  const ys: Array<[number, number]> = []
  const isLogit = /logit|sigmoid/i.test(method || 'logit_normal')

  for (let i = 1; i < samples; i++) {
    const tp = i / samples
    const denom = shift - (shift - 1) * tp
    const t = tp / denom
    const jac = shift / (denom * denom)
    let baseP = 1
    if (isLogit && t > 1e-6 && t < 1 - 1e-6) {
      const logit = Math.log(t / (1 - t))
      baseP = Math.exp(-0.5 * logit * logit) / (t * (1 - t) * Math.sqrt(2 * Math.PI))
    }
    ys.push([tp, baseP * jac])
  }
  const maxP = Math.max(...ys.map(p => p[1]), 1e-6)
  const pts = ys.map(([tp, p]) => `${(tp * width).toFixed(1)},${(padT + plotH * (1 - p / maxP)).toFixed(1)}`)
  return `M0,${padT + plotH} L${pts.join(' L')} L${width},${padT + plotH}`
}
