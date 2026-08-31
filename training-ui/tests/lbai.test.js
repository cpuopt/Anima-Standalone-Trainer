const test = require("node:test");
const assert = require("node:assert/strict");
const LBAI = require("../public/js/lbai.js");

test("calculates constant and cosine LBAI", () => {
  assert.equal(LBAI.calculate({ repeats: 10, epochs: 20, learningRate: 0.0001, rank: 32, scheduler: "constant" }).value, 0.02);
  assert.equal(LBAI.calculate({ repeats: 10, epochs: 20, learningRate: 0.0001, rank: 32, scheduler: "cosine" }).value, 0.01);
});

test("integrates sampled custom curves with the trapezoid rule", () => {
  assert.equal(LBAI.averageCurve([1, 0.5, 0]), 0.5);
  assert.equal(LBAI.calculate({ repeats: 12, epochs: 20, learningRate: 0.0001, rank: 16, scheduler: "custom", curve: [1, 0] }).value, 0.006);
});

test("accounts for cosine minimum learning rate", () => {
  assert.equal(LBAI.schedulerAverageFactor("cosine_with_min_lr", 0.2), 0.6);
});

test("calculates LBAI from summed effective images per epoch", () => {
  const result = LBAI.calculate({
    samplesPerEpoch: 250,
    epochs: 20,
    learningRate: 0.0001,
    rank: 32,
    scheduler: "cosine",
  });
  assert.equal(result.samplesPerEpoch, 250);
  assert.equal(result.exposure, 5000);
  assert.equal(result.value, 0.25);
});

test("divides LBAI by effective batch size", () => {
  const result = LBAI.calculate({
    samplesPerEpoch: 250,
    epochs: 20,
    learningRate: 0.0001,
    rank: 32,
    batchSize: 4,
    gradientAccumulationSteps: 2,
    scheduler: "cosine",
  });
  assert.equal(result.effectiveBatchSize, 8);
  assert.equal(result.value, 0.03125);
});

test("provides the three recommended LBAI ranges as default targets", () => {
  assert.deepEqual(LBAI.defaultTargets(), [
    { name: "角色 LoRA 推荐区", color: "#58a6ff", type: "range", min: 0.009, max: 0.015 },
    { name: "一般风格 LoRA 评估区", color: "#bc8cff", type: "range", min: 0.03, max: 0.07 },
    { name: "复杂风格 LoRA 评估区", color: "#f85149", type: "range", min: 0.07, max: 0.1 },
  ]);
});

test("normalizes multiple point and range targets", () => {
  assert.deepEqual(LBAI.normalizeTargets([
    { name: "Point", color: "#FF0000", type: "point", value: "0.01" },
    { name: "Range", color: "invalid", type: "range", min: 0.02, max: 0.015 },
  ]), [
    { name: "Point", color: "#ff0000", type: "point", value: 0.01 },
    { name: "Range", color: "#3fb950", type: "range", min: 0.015, max: 0.02 },
  ]);
  assert.deepEqual(LBAI.normalizeTargets([], false), []);
  assert.equal(LBAI.normalizeTarget({ type: "point", value: "" }), null);
});

test("scales the meter to keep the largest configured target visible", () => {
  assert.equal(LBAI.scaleMaximum([{ name: "P", type: "point", color: "#ffffff", value: 0.024 }]), 0.03);
  assert.equal(LBAI.scaleMaximum([]), 0.018);
});

test("enlarges tiny ranges around their true center and separates overlaps", () => {
  const layouts = LBAI.layoutTargets([
    { name: "Tiny A", color: "#ffffff", type: "range", min: 0.00125, max: 0.0015 },
    { name: "Tiny B", color: "#ff0000", type: "point", value: 0.0014 },
  ], 0.018, 100);
  assert.equal(layouts[0].compact, true);
  assert.equal(layouts[0].visualWidth, 8);
  assert.equal(layouts[0].hitWidth, 16);
  assert.equal(layouts[0].centerPercent, (0.001375 / 0.018) * 100);
  assert.equal(layouts[0].lane, 0);
  assert.equal(layouts[1].lane, 1);
});
