// Pure per-frame gesture state machine — no DOM, no MediaPipe, no Three.js —
// so the tricky transition logic (pinch clutch, one-shot click, re-arm, zoom
// engagement) is unit-testable in Node. hands.js classifies landmarks into an
// observation per frame; this turns observations into events.
//
// Observation: { state, pinchX?, pinchY?, palmScale? }
//   state ∈ "pinch" | "fist" | "pointer" | "click" | "idle" | "none"
//   pinchX/pinchY — pinch midpoint in mirrored normalized screen coords
//   palmScale    — mapPalmSizeToScale(palmSize), used for zoom ratios
//
// Events:
//   { type: "orbit", dx, dy }    — pinch-drag delta (normalized units)
//   { type: "zoomStart" }        — fist engaged; capture camera distance now
//   { type: "zoomRatio", ratio } — palmScale relative to engagement (>1 = in)
//   { type: "select" }           — one-shot click at the current hover target
//   { type: "pointerEnd" }       — pointer/click pose ended; hide the cursor

// A click may arrive a few noisy frames after the pointer pose (extending the
// middle finger briefly declassifies the hand), so accept the transition
// within a short grace window instead of requiring pointer -> click directly.
const POINTER_GRACE_FRAMES = 6;

export class GestureStateMachine {
  constructor() {
    this.state = "none";
    this.lastPinch = null;
    this.zoomEngageScale = null;
    this.clickArmed = true;
    this.framesSincePointer = Infinity;
  }

  step(obs) {
    const events = [];
    const prev = this.state;
    const state = obs.state ?? "none";
    this.state = state;

    if (state === "pointer") this.framesSincePointer = 0;
    else if (this.framesSincePointer !== Infinity) this.framesSincePointer++;

    // Pinch orbit with a clutch: deltas accumulate only while pinched, and
    // the first frame after ANY (re)acquisition — deliberate release, hand
    // dropout, gesture change — is discarded so a repositioned hand never
    // causes a jump.
    if (state === "pinch") {
      if (prev === "pinch" && this.lastPinch) {
        const dx = obs.pinchX - this.lastPinch.x;
        const dy = obs.pinchY - this.lastPinch.y;
        if (dx !== 0 || dy !== 0) events.push({ type: "orbit", dx, dy });
      }
      this.lastPinch = { x: obs.pinchX, y: obs.pinchY };
    } else {
      this.lastPinch = null;
    }

    // Fist zoom relative to the scale at engagement, so re-fisting at any
    // hand distance holds the current zoom instead of jumping to an absolute
    // mapping. Holding a fist still => ratio 1 => zoom holds.
    if (state === "fist") {
      if (prev !== "fist" || this.zoomEngageScale === null) {
        this.zoomEngageScale = obs.palmScale;
        events.push({ type: "zoomStart" });
      } else {
        events.push({ type: "zoomRatio", ratio: obs.palmScale / this.zoomEngageScale });
      }
    } else {
      this.zoomEngageScale = null;
    }

    // One-shot select on entering the two-finger pose from pointing; must
    // leave the pose (drop below two extended fingers) to re-arm.
    if (state === "click") {
      if (prev !== "click" && this.clickArmed && this.framesSincePointer <= POINTER_GRACE_FRAMES) {
        events.push({ type: "select" });
      }
      this.clickArmed = false;
    } else {
      this.clickArmed = true;
    }

    if ((prev === "pointer" || prev === "click") && state !== "pointer" && state !== "click") {
      events.push({ type: "pointerEnd" });
    }

    return events;
  }
}
