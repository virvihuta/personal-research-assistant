// Pure signal-conditioning utilities for gesture stability. No DOM, no
// MediaPipe — unit-tested in Node.
//
// - OneEuroFilter: cursor position smoothing (Casiez et al.) — heavy
//   smoothing when nearly still, light smoothing when moving fast, so the
//   cursor trades jitter for a slight, speed-dependent lag.
// - Ema: cheap exponential smoothing for scalar classification signals
//   (finger extension ratios, pinch ratio, openness) where a couple frames
//   of latency is fine but boundary noise is not.
// - LatchedThreshold: hysteresis boolean so a smoothed value near a decision
//   boundary can't flicker a classification on/off frame to frame.

export class OneEuroFilter {
  constructor({ minCutoff = 1.0, beta = 0.0, dCutoff = 1.0 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.prev = null; // { t, x, dx }
  }

  static alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  // x = raw sample, t = timestamp in SECONDS.
  filter(x, t) {
    if (this.prev === null) {
      this.prev = { t, x, dx: 0 };
      return x;
    }
    const dt = Math.max(t - this.prev.t, 1e-3);
    const dxRaw = (x - this.prev.x) / dt;
    const aD = OneEuroFilter.alpha(this.dCutoff, dt);
    const dx = aD * dxRaw + (1 - aD) * this.prev.dx;
    const cutoff = this.minCutoff + this.beta * Math.abs(dx);
    const a = OneEuroFilter.alpha(cutoff, dt);
    const filtered = a * x + (1 - a) * this.prev.x;
    this.prev = { t, x: filtered, dx };
    return filtered;
  }

  reset() {
    this.prev = null;
  }
}

export class Ema {
  constructor(alpha) {
    this.alpha = alpha;
    this.value = null;
  }

  filter(x) {
    this.value = this.value === null ? x : this.alpha * x + (1 - this.alpha) * this.value;
    return this.value;
  }

  reset() {
    this.value = null;
  }
}

export class LatchedThreshold {
  // state turns on when value rises above `onAbove`, off when it falls below
  // `offBelow`; in between it holds.
  constructor(onAbove, offBelow, initial = false) {
    this.onAbove = onAbove;
    this.offBelow = offBelow;
    this.state = initial;
  }

  update(value) {
    if (this.state) {
      if (value < this.offBelow) this.state = false;
    } else if (value > this.onAbove) {
      this.state = true;
    }
    return this.state;
  }

  reset(initial = false) {
    this.state = initial;
  }
}
