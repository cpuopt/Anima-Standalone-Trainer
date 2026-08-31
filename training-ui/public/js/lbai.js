(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.LBAI = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const DEFAULT_TARGETS = Object.freeze([
    Object.freeze({
      name: "角色 LoRA 推荐区",
      color: "#58a6ff",
      type: "range",
      min: 0.009,
      max: 0.015,
    }),
    Object.freeze({
      name: "一般风格 LoRA 评估区",
      color: "#bc8cff",
      type: "range",
      min: 0.03,
      max: 0.07,
    }),
    Object.freeze({
      name: "复杂风格 LoRA 评估区",
      color: "#f85149",
      type: "range",
      min: 0.07,
      max: 0.1,
    }),
  ]);

  function defaultTargets() {
    return DEFAULT_TARGETS.map((target) => ({ ...target }));
  }

  function normalizeColor(value) {
    return /^#[0-9a-f]{6}$/i.test(String(value || ""))
      ? String(value).toLowerCase()
      : "#3fb950";
  }

  function nonNegativeNumber(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === "string" && !value.trim()) return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  }

  function normalizeTarget(target, index = 0) {
    if (!target || typeof target !== "object") return null;
    const type = target.type === "point" ? "point" : "range";
    const normalized = {
      name: String(target.name || "").trim() || `Configuration ${index + 1}`,
      color: normalizeColor(target.color),
      type,
    };
    if (type === "point") {
      const value = nonNegativeNumber(target.value);
      if (value === null) return null;
      normalized.value = value;
      return normalized;
    }
    let min = nonNegativeNumber(target.min);
    let max = nonNegativeNumber(target.max);
    if (min === null || max === null) return null;
    if (min > max) [min, max] = [max, min];
    normalized.min = min;
    normalized.max = max;
    return normalized;
  }

  function normalizeTargets(targets, useDefaultsWhenMissing = true) {
    if (!Array.isArray(targets)) return useDefaultsWhenMissing ? defaultTargets() : [];
    return targets.map(normalizeTarget).filter(Boolean);
  }

  function targetBounds(target) {
    return target.type === "point"
      ? { min: target.value, max: target.value }
      : { min: target.min, max: target.max };
  }

  function scaleMaximum(targets, fallback = 0.018) {
    const maximum = normalizeTargets(targets, false).reduce(
      (result, target) => Math.max(result, targetBounds(target).max),
      0,
    );
    return Math.max(fallback, maximum * 1.25);
  }

  function layoutTargets(targets, scaleMax, trackWidth, minRangeWidth = 8, minHitWidth = 16) {
    const width = Math.max(1, Number(trackWidth) || 0);
    const scale = Math.max(Number(scaleMax) || 0, Number.EPSILON);
    const layouts = normalizeTargets(targets, false).map((target) => {
      const bounds = targetBounds(target);
      const centerValue = (bounds.min + bounds.max) / 2;
      const naturalWidth = target.type === "point"
        ? 4
        : ((bounds.max - bounds.min) / scale) * width;
      const visualWidth = target.type === "point"
        ? 4
        : Math.max(minRangeWidth, naturalWidth);
      const centerPx = (centerValue / scale) * width;
      const startPx = centerPx - visualWidth / 2;
      const endPx = centerPx + visualWidth / 2;
      return {
        target,
        bounds,
        centerPercent: (centerValue / scale) * 100,
        visualWidth,
        hitWidth: Math.max(minHitWidth, visualWidth),
        compact: target.type === "range" && naturalWidth < minRangeWidth,
        startPx,
        endPx,
        lane: 0,
      };
    });
    const laneEnds = [-Infinity, -Infinity];
    [...layouts].sort((a, b) => a.startPx - b.startPx).forEach((layout) => {
      let lane = layout.startPx > laneEnds[0] + 2 ? 0 : 1;
      if (lane === 1 && layout.startPx <= laneEnds[1] + 2) {
        lane = laneEnds[0] <= laneEnds[1] ? 0 : 1;
      }
      layout.lane = lane;
      laneEnds[lane] = Math.max(laneEnds[lane], layout.endPx);
    });
    return layouts.map(({ startPx, endPx, ...layout }) => layout);
  }

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

  function calculate({ repeats, samplesPerEpoch, epochs, learningRate, rank, batchSize = 1, gradientAccumulationSteps = 1, scheduler, minLrRatio, curve }) {
    const exposureBase = samplesPerEpoch ?? repeats;
    const values = [exposureBase, epochs, learningRate, rank, batchSize, gradientAccumulationSteps].map(Number);
    if (values.some((value) => !Number.isFinite(value) || value < 0)) return null;
    if (values[4] === 0 || values[5] === 0) return null;
    const factor = averageCurve(curve) ?? schedulerAverageFactor(scheduler, minLrRatio);
    const effectiveLearningRate = values[2] * factor;
    const effectiveBatchSize = values[4] * values[5];
    return {
      exposure: values[0] * values[1],
      samplesPerEpoch: values[0],
      effectiveLearningRate,
      rankFactor: values[3] / 32,
      effectiveBatchSize,
      value: values[0] * values[1] * effectiveLearningRate * (values[3] / 32) / effectiveBatchSize,
    };
  }

  return {
    DEFAULT_TARGETS,
    defaultTargets,
    normalizeTarget,
    normalizeTargets,
    targetBounds,
    scaleMaximum,
    layoutTargets,
    schedulerAverageFactor,
    averageCurve,
    calculate,
  };
});
