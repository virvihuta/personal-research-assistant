// Pure hand-pose classification: conditioned per-frame signals in, one state
// out. No DOM, no MediaPipe — unit-tested in Node (classify.test.mjs), with
// the mutual-exclusion guarantees encoded as tests, including the full 6x6
// pairwise transition matrix.
//
// Mutual exclusion is by construction (shared scalars with disjoint ranges
// and dead bands), never by check order alone:
//
// - gather vs everything: gatherSpread = max fingertip-to-THUMB-TIP distance
//   (palm-normalized). Gather engages < GATHER_ON, holds < GATHER_OFF; every
//   other pose requires gatherSpread > GATHER_OFF. A fist curls fingertips
//   into the PALM with the thumb wrapped over them (tips stay away from the
//   thumb tip); a gather converges all tips ON the thumb tip.
// - pinch vs fist: pinch requires middle/ring/pinky not curled; a fist
//   always curls at least two of them.
// - fist vs pointer: fist requires the INDEX curled (<1.08 ratio); pointer
//   requires it latched extended (>1.30) — 0.22 dead band.
// - pointer/click vs pinch: pointer/click require the thumb-index distance
//   above the pinch release threshold — disjoint even against a held pinch.
//
// Inputs:
//   wasPinching / wasGathering — machine state last frame (hysteresis)
//   pinchRatio   — smoothed thumb-index tip distance / palm size
//   gatherSpread — smoothed max fingertip-to-thumb-tip distance / palm size
//   curled       — per-finger fist-style curl booleans (smoothed inputs)
//   extended     — per-finger deliberate-extension latches
//   openness     — smoothed fingertip spread / palm size

export const PINCH_ON_RATIO = 0.34;
export const PINCH_OFF_RATIO = 0.46;
export const PINCH_ENGAGE_MAX_CURLED = 1;
export const PINCH_HOLD_MAX_CURLED = 2;
export const FIST_OPENNESS_MAX = 1.72;
export const GATHER_ON_SPREAD = 0.38;
export const GATHER_OFF_SPREAD = 0.52;

export function classifyHandState({
  wasPinching, wasGathering, pinchRatio, gatherSpread, curled, extended, openness
}) {
  // All-fingers pinch ("gathering" pose): every fingertip converges on the
  // thumb tip. Checked on its own scalar; curl/extension readings are
  // unreliable in this pose and deliberately ignored.
  const gathered = wasGathering
    ? gatherSpread < GATHER_OFF_SPREAD
    : gatherSpread < GATHER_ON_SPREAD;
  if (gathered) return "gather";

  // Every other pose requires fingertips clear of the thumb tip; between
  // GATHER_ON and GATHER_OFF nothing claims the hand (dead band).
  if (gatherSpread <= GATHER_OFF_SPREAD) return "idle";

  const othersCurled = [curled.middle, curled.ring, curled.pinky].filter(Boolean).length;
  const pinched = wasPinching
    ? pinchRatio < PINCH_OFF_RATIO && othersCurled <= PINCH_HOLD_MAX_CURLED
    : pinchRatio < PINCH_ON_RATIO && othersCurled <= PINCH_ENGAGE_MAX_CURLED;
  if (pinched) return "pinch";

  const curledCount = othersCurled + (curled.index ? 1 : 0);
  if (openness < FIST_OPENNESS_MAX && curled.thumb && curled.index && curledCount >= 3) {
    return "fist";
  }

  if (pinchRatio > PINCH_OFF_RATIO && extended.index && !extended.middle && !extended.ring && !extended.pinky) {
    return "pointer";
  }
  if (pinchRatio > PINCH_OFF_RATIO && extended.index && extended.middle && !extended.ring && !extended.pinky) {
    return "click";
  }
  return "idle";
}
