// Run with: node frontend/src/gestures/classify.test.mjs
import assert from "node:assert/strict";
import { classifyHandState } from "./classify.js";

const pose = (overrides) => ({
  wasPinching: false,
  wasGathering: false,
  pinchRatio: 1.2,
  gatherSpread: 1.5,
  curled: { thumb: false, index: false, middle: false, ring: false, pinky: false },
  extended: { index: false, middle: false, ring: false, pinky: false },
  openness: 2.2,
  ...overrides
});

// Canonical observation per gesture, values comfortably clear of every
// boundary. The gather fixture deliberately carries ambiguous curl/extension
// readings (index reads extended, others read curled) — the pose must win on
// its own scalar regardless.
const CANONICAL = {
  pinch: pose({
    pinchRatio: 0.2,
    gatherSpread: 1.1 // middle/ring/pinky tips far from the thumb (OK sign)
  }),
  fist: pose({
    pinchRatio: 0.2, // thumb resting on the curled index
    gatherSpread: 0.75, // tips in the palm, not on the thumb tip
    curled: { thumb: true, index: true, middle: true, ring: true, pinky: true },
    openness: 0.9
  }),
  gather: pose({
    pinchRatio: 0.15,
    gatherSpread: 0.2,
    curled: { thumb: false, index: false, middle: true, ring: true, pinky: true },
    extended: { index: true, middle: false, ring: false, pinky: false },
    openness: 1.0
  }),
  pointer: pose({
    gatherSpread: 1.3,
    curled: { thumb: true, index: false, middle: true, ring: true, pinky: true },
    extended: { index: true, middle: false, ring: false, pinky: false },
    openness: 1.4
  }),
  click: pose({
    gatherSpread: 1.4,
    curled: { thumb: true, index: false, middle: false, ring: true, pinky: true },
    extended: { index: true, middle: true, ring: false, pinky: false },
    openness: 1.6
  }),
  idle: pose({
    extended: { index: true, middle: true, ring: true, pinky: true }
  })
};

// --- Full pairwise transition matrix (6 x 6 = 36 cases) ----------------------
// From every held state, presenting any canonical pose must classify as that
// pose within one frame — hysteresis context (wasPinching/wasGathering) must
// never trap or block a clean transition.
{
  const states = Object.keys(CANONICAL);
  for (const from of states) {
    for (const to of states) {
      const obs = {
        ...CANONICAL[to],
        wasPinching: from === "pinch",
        wasGathering: from === "gather"
      };
      assert.equal(classifyHandState(obs), to, `transition ${from} -> ${to}`);
    }
  }
}

// --- Gather regressions ------------------------------------------------------
{
  // Ambiguous curl/extension readings during a gather must not leak into
  // pointer/click/pinch (encoded in the canonical fixture; assert directly).
  assert.equal(classifyHandState(CANONICAL.gather), "gather");

  // Dead band: spread between ON and OFF engages nothing fresh...
  const deadBand = pose({ gatherSpread: 0.45, pinchRatio: 0.2 });
  assert.equal(classifyHandState(deadBand), "idle");
  // ...but a held gather rides through it (hysteresis).
  assert.equal(classifyHandState({ ...deadBand, wasGathering: true }), "gather");

  // A fist measuring inside the dead band must NOT classify as fist (and not
  // as gather either) — neither pose may claim the ambiguous zone.
  const tightFist = pose({
    gatherSpread: 0.45,
    curled: { thumb: true, index: true, middle: true, ring: true, pinky: true },
    openness: 0.9
  });
  assert.equal(classifyHandState(tightFist), "idle");

  // A held gather that opens straight into an OK-sign pinch transitions
  // cleanly (also covered by the matrix; kept explicit).
  assert.equal(
    classifyHandState({ ...CANONICAL.pinch, wasGathering: true }),
    "pinch"
  );
}

// --- Fist/pointer regression (from the previous fix pass) --------------------
{
  const pointing = pose({
    gatherSpread: 1.3,
    curled: { thumb: true, index: false, middle: true, ring: true, pinky: true },
    extended: { index: true, middle: false, ring: false, pinky: false },
    openness: 1.4
  });
  assert.equal(classifyHandState(pointing), "pointer");

  // Index in the dead band between fist-curl and extension latch: neither.
  const indexDeadBand = pose({
    gatherSpread: 1.3,
    curled: { thumb: true, index: false, middle: true, ring: true, pinky: true },
    openness: 1.4
  });
  assert.equal(classifyHandState(indexDeadBand), "idle");

  // Fist with one loose finger still classifies while the index is curled.
  const loosePinky = pose({
    gatherSpread: 0.75,
    curled: { thumb: true, index: true, middle: true, ring: true, pinky: false },
    openness: 1.1
  });
  assert.equal(classifyHandState(loosePinky), "fist");
}

// --- Pinch hysteresis --------------------------------------------------------
{
  const heldDegraded = pose({
    wasPinching: true,
    pinchRatio: 0.4,
    gatherSpread: 1.0,
    curled: { thumb: false, index: false, middle: true, ring: true, pinky: false }
  });
  assert.equal(classifyHandState(heldDegraded), "pinch");
  assert.equal(classifyHandState({ ...heldDegraded, wasPinching: false }), "idle");
}

// --- Pointer/click require the thumb clear of the index tip ------------------
{
  const pointingThumbNearIndex = pose({
    pinchRatio: 0.4, // inside the pinch hold band
    gatherSpread: 1.3,
    curled: { thumb: true, index: false, middle: true, ring: true, pinky: true },
    extended: { index: true, middle: false, ring: false, pinky: false },
    openness: 1.4
  });
  assert.equal(classifyHandState(pointingThumbNearIndex), "idle");
}

console.log("classify: all checks passed (36-case matrix + regressions)");
