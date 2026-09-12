const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
const app = fs.readFileSync(path.join(__dirname, "../public/js/app.js"), "utf8");

test("LoKr full-matrix control is beside rank and explains that rank is ignored", () => {
  const rank = html.indexOf('id="cfg-network-dim"');
  const fullMatrix = html.indexOf('id="cfg-lokr-full-matrix"');
  const alpha = html.indexOf('id="cfg-network-alpha"');

  assert.ok(rank >= 0 && fullMatrix > rank && fullMatrix < alpha);
  assert.match(html, /Rank does not take effect while enabled/);
});

test("LoKr full-matrix control round-trips through dedicated network args", () => {
  assert.match(app, /"full_matrix"/);
  assert.match(app, /dedicated\.push\("full_matrix=true"\)/);
  assert.match(app, /dedicated\.full_matrix/);
  assert.match(app, /cfg-network-dim"\)\.disabled = enabled/);
});
