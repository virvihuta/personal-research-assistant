// Run with: node frontend/src/gestures/gesture-state.test.mjs
import assert from "node:assert/strict";
import { GestureStateMachine } from "./gesture-state.js";

const types = (events) => events.map((e) => e.type);

// --- Pinch clutch -----------------------------------------------------------
{
  const m = new GestureStateMachine();
  // First pinch frame: no delta (nothing to diff against).
  assert.deepEqual(m.step({ state: "pinch", pinchX: 0.5, pinchY: 0.5 }), []);
  // Second frame: delta accumulates.
  const ev = m.step({ state: "pinch", pinchX: 0.6, pinchY: 0.45 });
  assert.equal(ev.length, 1);
  assert.equal(ev[0].type, "orbit");
  assert.ok(Math.abs(ev[0].dx - 0.1) < 1e-9 && Math.abs(ev[0].dy - -0.05) < 1e-9);
  // Release the pinch, move the hand far away, re-pinch: the first frame
  // after re-acquisition must NOT produce a jump delta.
  m.step({ state: "idle" });
  assert.deepEqual(m.step({ state: "pinch", pinchX: 0.05, pinchY: 0.9 }), []);
  // ...but the next frame resumes normal deltas from the new position.
  const resumed = m.step({ state: "pinch", pinchX: 0.07, pinchY: 0.9 });
  assert.equal(resumed[0].type, "orbit");
  assert.ok(Math.abs(resumed[0].dx - 0.02) < 1e-9);
}

// --- Tracking dropout mid-pinch ---------------------------------------------
{
  const m = new GestureStateMachine();
  m.step({ state: "pinch", pinchX: 0.5, pinchY: 0.5 });
  m.step({ state: "none" }); // hand lost
  // Reacquired at a very different position: discard that frame's delta.
  assert.deepEqual(m.step({ state: "pinch", pinchX: 0.9, pinchY: 0.1 }), []);
}

// --- Unpinched movement is inert --------------------------------------------
{
  const m = new GestureStateMachine();
  assert.deepEqual(m.step({ state: "idle" }), []);
  assert.deepEqual(m.step({ state: "idle" }), []);
}

// --- Fist zoom: engagement + relative ratio, holds when still ---------------
{
  const m = new GestureStateMachine();
  assert.deepEqual(types(m.step({ state: "fist", palmScale: 0.8 })), ["zoomStart"]);
  const hold = m.step({ state: "fist", palmScale: 0.8 });
  assert.equal(hold[0].type, "zoomRatio");
  assert.equal(hold[0].ratio, 1); // no movement => zoom holds
  const closer = m.step({ state: "fist", palmScale: 1.2 });
  assert.ok(Math.abs(closer[0].ratio - 1.5) < 1e-9);
  // Release, re-fist at a different distance: fresh engagement, no jump.
  m.step({ state: "idle" });
  assert.deepEqual(types(m.step({ state: "fist", palmScale: 2.0 })), ["zoomStart"]);
  assert.equal(m.step({ state: "fist", palmScale: 2.0 })[0].ratio, 1);
}

// --- Click: one-shot on pointer -> click, re-arm required -------------------
{
  const m = new GestureStateMachine();
  m.step({ state: "pointer" });
  assert.deepEqual(types(m.step({ state: "click" })), ["select"]);
  // Held two-finger pose: no repeat fire.
  assert.deepEqual(m.step({ state: "click" }), []);
  assert.deepEqual(m.step({ state: "click" }), []);
  // Back to pointer (re-arms, emits nothing pointer-related), click again fires.
  assert.deepEqual(m.step({ state: "pointer" }), []);
  assert.deepEqual(types(m.step({ state: "click" })), ["select"]);
}

// --- Click grace window tolerates noisy transition frames -------------------
{
  const m = new GestureStateMachine();
  m.step({ state: "pointer" });
  m.step({ state: "idle" }); // middle finger half-extended, classifier wobbles
  m.step({ state: "idle" });
  assert.deepEqual(types(m.step({ state: "click" })), ["select"]);
}

// --- No click without recent pointing (e.g. straight from fist) -------------
{
  const m = new GestureStateMachine();
  m.step({ state: "fist", palmScale: 1 });
  const ev = m.step({ state: "click" });
  assert.ok(!types(ev).includes("select"), "click from fist must not select");
}

// --- Grace window expires ----------------------------------------------------
{
  const m = new GestureStateMachine();
  m.step({ state: "pointer" });
  for (let i = 0; i < 10; i++) m.step({ state: "idle" });
  assert.ok(!types(m.step({ state: "click" })).includes("select"));
}

// --- pointerEnd fires when leaving pointer/click poses ----------------------
{
  const m = new GestureStateMachine();
  m.step({ state: "pointer" });
  assert.deepEqual(types(m.step({ state: "idle" })), ["pointerEnd"]);
  m.step({ state: "pointer" });
  m.step({ state: "click" }); // pointer -> click keeps the cursor alive
  assert.ok(types(m.step({ state: "none" })).includes("pointerEnd"));
}

console.log("gesture-state: all checks passed");
