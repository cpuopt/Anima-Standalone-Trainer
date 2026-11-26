import { describe, expect, it } from 'vitest'
import { evaluateScheduler, formatLr, gaugeRatioToLr, lrToGaugeRatio, resolveWarmup, stepLrValue, type TimelineParams } from './timeline'

function base(overrides: Partial<TimelineParams> = {}): TimelineParams {
  return {
    architecture: 'anima',
    learningRate: 0.00005,
    optimizerType: 'AdamW8bit',
    scheduler: 'cosine',
    warmupUnit: 'steps',
    warmupSteps: 100,
    warmupEpochs: 1,
    numCycles: 3,
    minLrRatio: 0.2,
    durationUnit: 'epochs',
    maxEpochs: 20,
    saveEveryNEpochs: 1,
    maxSteps: 1000,
    saveEveryNSteps: 500,
    outputName: 'test_lora',
    savePrecision: 'bf16',
    mixedPrecision: 'bf16',
    ...overrides,
  }
}

describe('training timeline math', () => {
  it('evaluates cosine_with_restarts as N cosine decay cycles with N - 1 hard restarts', () => {
    const c1 = base({ scheduler: 'cosine_with_restarts', numCycles: 1 })
    expect(evaluateScheduler(c1, 0)).toBeCloseTo(1, 5)
    expect(evaluateScheduler(c1, 0.5)).toBeCloseTo(0.5, 5)
    expect(evaluateScheduler(c1, 1)).toBeCloseTo(0, 5)

    const c3 = base({ scheduler: 'cosine_with_restarts', numCycles: 3 })
    expect(evaluateScheduler(c3, 0)).toBeCloseTo(1, 5)
    expect(evaluateScheduler(c3, 1 / 6)).toBeCloseTo(0.5, 5)
    expect(evaluateScheduler(c3, 1 / 3 - 1e-5)).toBeCloseTo(0, 4)
    expect(evaluateScheduler(c3, 1 / 3)).toBeCloseTo(1, 5)
    expect(evaluateScheduler(c3, 0.5)).toBeCloseTo(0.5, 5)
    expect(evaluateScheduler(c3, 2 / 3 - 1e-5)).toBeCloseTo(0, 4)
    expect(evaluateScheduler(c3, 2 / 3)).toBeCloseTo(1, 5)
    expect(evaluateScheduler(c3, 5 / 6)).toBeCloseTo(0.5, 5)
    expect(evaluateScheduler(c3, 1)).toBeCloseTo(0, 5)

    const c5 = base({ scheduler: 'cosine_with_restarts', numCycles: 5 })
    for (const boundary of [0.2, 0.4, 0.6, 0.8]) {
      expect(evaluateScheduler(c5, boundary - 1e-5)).toBeCloseTo(0, 4)
      expect(evaluateScheduler(c5, boundary)).toBeCloseTo(1, 5)
    }
    expect(evaluateScheduler(c5, 1)).toBeCloseTo(0, 5)
  })

  it('applies numCycles to cosine_with_min_lr as half-cosine waves between peak and floor', () => {
    const c1 = base({ scheduler: 'cosine_with_min_lr', minLrRatio: 0.2, numCycles: 1 })
    expect(evaluateScheduler(c1, 0)).toBeCloseTo(1, 5)
    expect(evaluateScheduler(c1, 0.5)).toBeCloseTo(0.6, 5)
    expect(evaluateScheduler(c1, 1)).toBeCloseTo(0.2, 5)

    const c2 = base({ scheduler: 'cosine_with_min_lr', minLrRatio: 0.2, numCycles: 2 })
    expect(evaluateScheduler(c2, 0)).toBeCloseTo(1, 5)
    expect(evaluateScheduler(c2, 0.5)).toBeCloseTo(0.2, 5)
    expect(evaluateScheduler(c2, 1)).toBeCloseTo(1, 5)

    const c3 = base({ scheduler: 'cosine_with_min_lr', minLrRatio: 0.2, numCycles: 3 })
    expect(evaluateScheduler(c3, 0)).toBeCloseTo(1, 5)
    expect(evaluateScheduler(c3, 1 / 3)).toBeCloseTo(0.2, 5)
    expect(evaluateScheduler(c3, 2 / 3)).toBeCloseTo(1, 5)
    expect(evaluateScheduler(c3, 1)).toBeCloseTo(0.2, 5)
  })

  it('respects warmup units, ratio warmup, constant promotion, and ScheduleFree bypass', () => {
    expect(resolveWarmup(base({ warmupUnit: 'epochs', warmupEpochs: 2, durationUnit: 'epochs', maxEpochs: 20 }))).toMatchObject({
      active: true, fraction: 0.1, schematic: false,
    })
    expect(resolveWarmup(base({ warmupUnit: 'steps', warmupSteps: 100, durationUnit: 'epochs' }))).toMatchObject({
      active: true, fraction: 0.1, schematic: true,
    })
    expect(resolveWarmup(base({ warmupUnit: 'steps', warmupSteps: 0.15, durationUnit: 'epochs' }))).toMatchObject({
      active: true, fraction: 0.15, schematic: false,
    })
    expect(resolveWarmup(base({ scheduler: 'constant', warmupUnit: 'steps', warmupSteps: 100 })).active).toBe(false)
    expect(resolveWarmup(base({ scheduler: 'constant', warmupUnit: 'epochs', warmupEpochs: 1 })).active).toBe(true)
    expect(resolveWarmup(base({ optimizerType: 'AdamWScheduleFree' })).active).toBe(false)
    expect(evaluateScheduler(base({ optimizerType: 'AdamWScheduleFree', scheduler: 'cosine' }), 0.9)).toBe(1)
  })

  it('maps Learning Rate log gauge and steppers cleanly', () => {
    expect(formatLr(0.00005)).toBe('5e-5')
    expect(lrToGaugeRatio(1e-6)).toBeCloseTo(0, 5)
    expect(lrToGaugeRatio(1e-3)).toBeCloseTo(1, 5)
    expect(gaugeRatioToLr(0)).toBeCloseTo(1e-6, 9)
    expect(gaugeRatioToLr(1)).toBeCloseTo(1e-3, 9)
    expect(stepLrValue(0.00005, 1)).toBeCloseTo(0.00006, 9)
    expect(stepLrValue(0.00005, -1)).toBeCloseTo(0.00004, 9)
    expect(stepLrValue(0.00001, -1)).toBeCloseTo(0.000009, 9)
  })
})
