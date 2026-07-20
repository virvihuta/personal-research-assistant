// Pure hand-pose classification: conditioned per-frame signals in, one state
// out. No DOM, no MediaPipe — unit-tested in Node (classify.test.mjs), with
// the mutual-exclusion guarantees encoded as tests:
//
// - pinch vs fist: pinch requires middle/ring/pinky not curled; a fist
//   always curls at least two of them.
// - fist vs pointer: a fist must curl the INDEX finger too. Without this the
//   pointer pose (index out, three fingers curled, thumb tucked) satisfies
//   the fist predicate and steals the frame. Fist needs the index ratio
//   below the curl threshold (<1.08); pointer needs it latched extended
//   (>1.30) — a dead band separates the two poses by construction.
// - pointer vs click: click needs the middle finger latched extended
//   (>1.30), pointer holds until it releases (<1.10) — same hysteresis band.
//
// Inputs:
//   wasPinching — machine state from last frame (pinch hysteresis)
//   pinchRatio  — smoothed thumb-index distance / palm size
//   curled      — per-finger fist-style curl booleans (smoothed inputs)
//   extended    — per-finger deliberate-extension latches
//   openness    — smoothed fingertip spread / palm size

export const PINCH_ON_RATIO = 0.34;
export const PINCH_OFF_RATIO = 0.46;
export const PINCH_ENGAGE_MAX_CURLED = 1;
export const PINCH_HOLD_MAX_CURLED = 2;
export const FIST_OPENNESS_MAX = 1.72;

export function classifyHandState({ wasPinching, pinchRatio, curled, extended, openness }) {
  const othersCurled = [curled.middle, curled.ring, curled.pinky].filter(Boolean).length;
  const pinched = wasPinching
    ? pinchRatio < PINCH_OFF_RATIO && othersCurled <= PINCH_HOLD_MAX_CURLED
    : pinchRatio < PINCH_ON_RATIO && othersCurled <= PINCH_ENGAGE_MAX_CURLED;
  if (pinched) return "pinch";

  const curledCount = othersCurled + (curled.index ? 1 : 0);
  if (openness < FIST_OPENNESS_MAX && curled.thumb && curled.index && curledCount >= 3) {
    return "fist";
  }

  if (extended.index && !extended.middle && !extended.ring && !extended.pinky) return "pointer";
  if (extended.index && extended.middle && !extended.ring && !extended.pinky) return "click";
  return "idle";
}
