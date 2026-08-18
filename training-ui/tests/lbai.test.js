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
