(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.LBAI = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const RECOMMENDED_MIN = 0.012;
  const RECOMMENDED_MAX = 0.0144;

  function schedulerAverageFactor(scheduler, minLrRatio = 0) {
    switch (scheduler) {
      case "constant": return 1;
      case "cosine_with_min_lr":
        return (1 + Math.max(0, Math.min(1, Number(minLrRatio) || 0))) / 2;
      case "cosine":
      case "cosine_with_restarts":
      case "linear":
      case "polynomial": return 0.5;
      default: return 1;
    }
  }

  // Integrate normalized scheduler samples using the trapezoid rule.
  function averageCurve(points) {
    if (!Array.isArray(points) || points.length < 2) return null;
    let area = 0;
    for (let i = 1; i < points.length; i += 1) {
      area += (Number(points[i - 1]) + Number(points[i])) / 2;
    }
    return area / (points.length - 1);
  }

  function calculate({ repeats, epochs, learningRate, rank, scheduler, minLrRatio, curve }) {
    const values = [repeats, epochs, learningRate, rank].map(Number);
    if (values.some((value) => !Number.isFinite(value) || value < 0)) return null;
    const factor = averageCurve(curve) ?? schedulerAverageFactor(scheduler, minLrRatio);
    const effectiveLearningRate = values[2] * factor;
    return {
      exposure: values[0] * values[1],
      effectiveLearningRate,
      rankFactor: values[3] / 32,
      value: values[0] * values[1] * effectiveLearningRate * (values[3] / 32),
    };
  }

  return { RECOMMENDED_MIN, RECOMMENDED_MAX, schedulerAverageFactor, averageCurve, calculate };
});
