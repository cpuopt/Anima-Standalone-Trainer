/** Normalized illustrations only. Never used to compute a training learning rate. */
export interface SchedulerPreview {
  title: string
  description: string
  example: string
  segments: Array<(progress: number) => number>
  floor?: number
}
const cosine = (t: number) => (1 + Math.cos(Math.PI * t)) / 2
export const schedulerPreviews: Record<string, SchedulerPreview> = {
  constant: {
    title: '恒定学习率', description: '学习率保持不变，整个训练过程使用相同的基础步幅。',
    example: '恒定水平线；此示意不包含 Warmup。', segments:[() => 1],
  },
  linear: {
    title: '线性衰减', description: '学习率按直线逐步降低，接近训练结束时降至零。',
    example: '均匀下降；此示意不包含 Warmup。', segments:[t => 1 - t],
  },
  cosine: {
    title: '余弦衰减', description: '学习率沿半个余弦周期平滑下降：起止较缓，中段下降较快。',
    example: '单次从峰值降至零；此示意不包含 Warmup。', segments:[cosine],
  },
  cosine_with_restarts: {
    title: '余弦周期重启', description: '每个周期平滑衰减后，学习率回到较高水平，再开始下一轮衰减。',
    example: '仅以 3 个周期举例；实际周期数由 Restart / Scheduler Cycles 决定。', segments:[cosine, cosine, cosine],
  },
  cosine_with_min_lr: {
    title: '带下限的余弦衰减', description: '沿余弦曲线下降，但保留最低学习率，不一定降到零。',
    example: '虚线以最低学习率比例 20% 举例；实际由 Min LR Ratio 决定。', segments:[t => 0.2 + 0.8 * cosine(t)], floor:0.2,
  },
  polynomial: {
    title: '多项式衰减', description: '按多项式曲线降低学习率；指数不同，弯曲程度和衰减速度也不同。',
    example: '仅以 power = 2、衰减至零举例；不是训练器默认指数或终点。', segments:[t => (1 - t) ** 2],
  },
}

export const curvePlot = { left:35, top:17, width:250, height:119, bottom:136 }
export function schedulerPreview(name: string): SchedulerPreview | undefined {
  return Object.hasOwn(schedulerPreviews, name) ? schedulerPreviews[name] : undefined
}
export function curvePaths(name: string): string[] {
  const preview = schedulerPreview(name)
  if (!preview) return []
  // Separate subpaths preserve restart jumps rather than drawing a misleading slope.
  return preview.segments.map((fn, index, segments) => Array.from({ length:65 }, (_, i) => {
    const t = i / 64
    const x = curvePlot.left + curvePlot.width * (index + t) / segments.length
    const y = curvePlot.top + curvePlot.height * (1 - Math.max(0, Math.min(1, fn(t))))
    return `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`
  }).join(' '))
}
