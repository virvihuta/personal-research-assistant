// Run with: node frontend/src/gestures/classify.test.mjs
import assert from "node:assert/strict";
import { classifyHandState } from "./classify.js";

const pose = (overrides) => ({
  wasPinching: false,
  pinchRatio: 1.2,
  curled: { thumb: false, index: false, middle: false, ring: false, pinky: false },
  extended: { index: false, middle: false, ring: false, pinky: false },
  openness: 2.2,
  ...overrides
});

// --- THE regression: pointing must not read as fist --------------------------
// A pointing hand curls middle/ring/pinky (3 curled), usually tucks the
// thumb, and its openness often lands under the fist ceiling. Before the
// index-curl requirement, this exact pose satisfied the fist predicate.
{
  const pointing = pose({
    curled: { thumb: true, index: false, middle: true, ring: true, pinky: true },
    extended: { index: true, middle: false, ring: false, pinky: false },
    openness: 1.4
  });
  assert.equal(classifyHandState(pointing), "pointer");
}

// --- True fists still classify -----------------------------------------------
{
  const fist = pose({
    curled: { thumb: true, index: true, middle: true, ring: true, pinky: true },
    openness: 0.9
  });
  assert.equal(classifyHandState(fist), "fist");

  // One loose finger (pinky) is still a fist, as long as the index is curled.
  const loosePinky = pose({
    curled: { thumb: true, index: true, middle: true, ring: true, pinky: false },
    openness: 1.1
  });
  assert.equal(classifyHandState(loosePinky), "fist");
}

// --- Fist vs pinch: exclusive even with thumb-index contact ------------------
{
  const fistThumbTouchingIndex = pose({
    pinchRatio: 0.2, // thumb resting on curled index
    curled: { thumb: true, index: true, middle: true, ring: true, pinky: true },
    openness: 0.9
  });
  assert.equal(classifyHandState(fistThumbTouchingIndex), "fist");
}

// --- Legit pinch (OK-sign): engages and survives partial curl while held ----
{
  const okSign = pose({ pinchRatio: 0.2 });
  assert.equal(classifyHandState(okSign), "pinch");

  const heldDegraded = pose({
    wasPinching: true,
    pinchRatio: 0.4, // beyond engage, inside hold hysteresis
    curled: { thumb: false, index: false, middle: true, ring: true, pinky: false }
  });
  assert.equal(classifyHandState(heldDegraded), "pinch");

  // ...but the same signals without prior pinch do NOT engage.
  assert.equal(classifyHandState({ ...heldDegraded, wasPinching: false }), "idle");
}

// --- Click pose --------------------------------------------------------------
{
  const click = pose({
    curled: { thumb: true, index: false, middle: false, ring: true, pinky: true },
    extended: { index: true, middle: true, ring: false, pinky: false },
    openness: 1.6
  });
  assert.equal(classifyHandState(click), "click");
}

// --- Open hand is neutral ----------------------------------------------------
{
  const open = pose({
    extended: { index: true, middle: true, ring: true, pinky: true }
  });
  assert.equal(classifyHandState(open), "idle");
}

// --- Index in the dead band (neither curled nor latched extended) ------------
// Three fingers curled + tucked thumb + low openness, but the index sits
// between the fist-curl threshold and the extension latch: neither fist nor
// pointer may claim it.
{
  const deadBand = pose({
    curled: { thumb: true, index: false, middle: true, ring: true, pinky: true },
    extended: { index: false, middle: false, ring: false, pinky: false },
    openness: 1.4
  });
  assert.equal(classifyHandState(deadBand), "idle");
}

console.log("classify: all checks passed");
