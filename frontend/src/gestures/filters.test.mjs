// Run with: node frontend/src/gestures/filters.test.mjs
import assert from "node:assert/strict";
import { OneEuroFilter, Ema, LatchedThreshold } from "./filters.js";

// Deterministic pseudo-noise at ~13 Hz for a 30 fps sample rate — the
// high-frequency band real landmark jitter lives in, well above the filter's
// ~1 Hz resting cutoff.
const noise = (i) => Math.sin(i * 2.7) * 0.5;

// --- OneEuroFilter: kills jitter at rest -------------------------------------
{
  const f = new OneEuroFilter({ minCutoff: 1.0, beta: 0.015 });
  const raw = [];
  const out = [];
  for (let i = 0; i < 120; i++) {
    const x = 0.5 + noise(i) * 0.004; // stationary hand, +/-2px-at-1000px noise
    raw.push(x);
    out.push(f.filter(x, i / 30)); // 30 fps
  }
  const variance = (xs) => {
    const tail = xs.slice(30); // skip settling
    const mean = tail.reduce((a, b) => a + b, 0) / tail.length;
    return tail.reduce((a, b) => a + (b - mean) ** 2, 0) / tail.length;
  };
  assert.ok(
    variance(out) < variance(raw) * 0.05,
    `stationary variance should drop >20x (raw ${variance(raw)}, filtered ${variance(out)})`
  );
}

// --- OneEuroFilter: converges after a step, tracks fast motion ---------------
{
  const f = new OneEuroFilter({ minCutoff: 1.0, beta: 0.015 });
  f.filter(0, 0);
  let last = 0;
  for (let i = 1; i <= 30; i++) last = f.filter(1, i / 30); // 1s after a step
  assert.ok(last > 0.9, `should converge close to step target within 1s (got ${last})`);

  // Fast ramp: output must lag behind but keep moving monotonically.
  const g = new OneEuroFilter({ minCutoff: 1.0, beta: 0.015 });
  let prevOut = g.filter(0, 0);
  for (let i = 1; i <= 30; i++) {
    const target = i / 30; // full sweep in 1s
    const y = g.filter(target, i / 30);
    assert.ok(y <= target + 1e-9 && y >= prevOut - 1e-9, "lags without overshoot or reversal");
    prevOut = y;
  }
  assert.ok(prevOut > 0.5, `keeps up with fast motion (got ${prevOut})`);
}

// --- OneEuroFilter: reset forgets state --------------------------------------
{
  const f = new OneEuroFilter({});
  f.filter(100, 0);
  f.reset();
  assert.equal(f.filter(0, 1), 0, "first sample after reset passes through");
}

// --- Ema ---------------------------------------------------------------------
{
  const e = new Ema(0.5);
  assert.equal(e.filter(10), 10, "first sample passes through");
  assert.equal(e.filter(0), 5);
  e.reset();
  assert.equal(e.filter(3), 3);
}

// --- LatchedThreshold hysteresis --------------------------------------------
{
  const latch = new LatchedThreshold(1.3, 1.1);
  assert.equal(latch.update(1.2), false, "starts off; mid-band stays off");
  assert.equal(latch.update(1.35), true, "crosses on-threshold");
  assert.equal(latch.update(1.2), true, "mid-band holds on — no flicker");
  assert.equal(latch.update(1.29), true, "just under on-threshold still holds");
  assert.equal(latch.update(1.05), false, "falls below off-threshold");
  assert.equal(latch.update(1.2), false, "mid-band holds off");
  latch.reset(true);
  assert.equal(latch.update(1.2), true, "reset state respected");
}

console.log("filters: all checks passed");
