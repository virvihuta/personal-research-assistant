// MediaPipe Hands wiring + per-frame gesture classification. window.Hands and
// window.Camera come from the classic CDN scripts loaded in index.html.
//
// This module turns landmarks into conditioned signals; the actual pose
// decision lives in classify.js (pure, unit-tested), where pinch/fist/
// pointer are kept mutually exclusive by construction — see its header.
//
// Signal conditioning (filters.js):
// - Raw scalars (finger extension ratios, pinch ratio, openness) run through
//   an EMA before any threshold, so boundary noise can't flicker a pose.
// - Deliberate-extension detection (pointer/click) uses hysteresis latches
//   with thresholds tuned for "clearly extended", independent of the legacy
//   fist-curl constants.
// - Rendered positions (cursor fingertip, pinch-drag midpoint) run through
//   One Euro filters: still hand = heavy smoothing, fast hand = light lag.
// Transition logic (clutch, one-shot click, zoom engagement) stays in the
// unit-tested GestureStateMachine.

import { GestureStateMachine } from "./gesture-state.js";
import { classifyHandState } from "./classify.js";
import { OneEuroFilter, Ema, LatchedThreshold } from "./filters.js";

// Palm-size -> scale mapping retained from the original prototype; now it
// drives camera zoom ratios instead of mesh scale.
const MIN_GESTURE_SCALE = 0.1;
const MAX_GESTURE_SCALE = 2.4;
const PALM_SIZE_MIN = 0.11;
const PALM_SIZE_MAX = 0.28;
const PALM_SIZE_SCALE_ONE = 0.1547368421;

// Legacy curl thresholds (tip-to-wrist vs pip-to-wrist ratio) — feed the
// fist/pinch conditions in classify.js, applied to smoothed ratios.
const CURL_RATIO_INDEX_MIDDLE_RING = 1.08;
const CURL_RATIO_PINKY = 1.12;
const CURL_RATIO_THUMB = 1.1;

// Deliberate-extension latches for pointer/click poses. A clearly extended
// finger reads ~1.5-1.9, half-relaxed ~1.1-1.3, curled below ~1.0 — so
// "extended" arms above 1.3 and only releases below 1.1.
const EXTEND_ON_RATIO = 1.3;
const EXTEND_OFF_RATIO = 1.1;

// EMA weight for classification scalars (~2-3 frames of smoothing at 30 fps).
const SIGNAL_EMA_ALPHA = 0.45;

// One Euro tuning: minCutoff sets resting smoothness, beta how quickly
// smoothing yields to speed. Low beta = the requested "tiny delayed
// movement" during fast motion instead of jitter. Pan gets its own filter
// pair (same initial values as pinch) so lateral-drag feel can be tuned
// independently of orbit.
const CURSOR_FILTER_PARAMS = { minCutoff: 1.0, beta: 0.015, dCutoff: 1.0 };
const PINCH_FILTER_PARAMS = { minCutoff: 1.2, beta: 0.02, dCutoff: 1.0 };
const PAN_FILTER_PARAMS = { minCutoff: 1.2, beta: 0.02, dCutoff: 1.0 };

// Radians of camera orbit per full-frame hand swipe; signs follow the
// OrbitControls drag convention. Pan speed is in view-widths per full-frame
// swipe (the viz layer scales it by camera distance).
const ORBIT_SPEED_X = 3.4;
const ORBIT_SPEED_Y = 2.4;
const PAN_SPEED = 1.6;

function mapPalmSizeToScale(palmSize) {
  if (palmSize <= PALM_SIZE_SCALE_ONE) {
    return THREE.MathUtils.mapLinear(
      palmSize,
      PALM_SIZE_MIN,
      PALM_SIZE_SCALE_ONE,
      MIN_GESTURE_SCALE,
      1.0
    );
  }

  return THREE.MathUtils.mapLinear(
    palmSize,
    PALM_SIZE_SCALE_ONE,
    PALM_SIZE_MAX,
    1.0,
    MAX_GESTURE_SCALE
  );
}

const STATUS_BY_STATE = {
  pinch: "Pinch-drag: orbiting the camera. Release to hold, re-pinch anywhere to continue.",
  gather: "Gathered pinch: move your hand left/right to pan. Release to hold.",
  fist: "Fist: zooming. Move your fist closer to zoom in, farther to zoom out.",
  pointer: "Pointing. Hover a cluster, then extend your middle finger to select it.",
  click: "Selected!",
  idle: "Hand detected. Pinch &amp; drag to orbit, fist to zoom, point to inspect."
};

export function initGestures({ videoElement, statusBox, loadingText, handlers }) {
  if (!window.Hands || !window.Camera) {
    loadingText.textContent = "MediaPipe failed to load: check your network connection or refresh the page. Particles will still display normally.";
    statusBox.textContent = "AI hand-tracking library failed to load, but the particle system is running.";
    setTimeout(() => loadingText.remove(), 3000);
    return;
  }

  const hands = new window.Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
  });

  hands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
  });

  const machine = new GestureStateMachine();

  // Per-signal conditioning state.
  const ratioEma = {
    index: new Ema(SIGNAL_EMA_ALPHA),
    middle: new Ema(SIGNAL_EMA_ALPHA),
    ring: new Ema(SIGNAL_EMA_ALPHA),
    pinky: new Ema(SIGNAL_EMA_ALPHA),
    thumb: new Ema(SIGNAL_EMA_ALPHA)
  };
  const pinchEma = new Ema(SIGNAL_EMA_ALPHA);
  const gatherEma = new Ema(SIGNAL_EMA_ALPHA);
  const opennessEma = new Ema(SIGNAL_EMA_ALPHA);
  const extendLatch = {
    index: new LatchedThreshold(EXTEND_ON_RATIO, EXTEND_OFF_RATIO),
    middle: new LatchedThreshold(EXTEND_ON_RATIO, EXTEND_OFF_RATIO),
    ring: new LatchedThreshold(EXTEND_ON_RATIO, EXTEND_OFF_RATIO),
    pinky: new LatchedThreshold(EXTEND_ON_RATIO, EXTEND_OFF_RATIO)
  };
  const cursorFilterX = new OneEuroFilter(CURSOR_FILTER_PARAMS);
  const cursorFilterY = new OneEuroFilter(CURSOR_FILTER_PARAMS);
  const pinchFilterX = new OneEuroFilter(PINCH_FILTER_PARAMS);
  const pinchFilterY = new OneEuroFilter(PINCH_FILTER_PARAMS);
  const panFilterX = new OneEuroFilter(PAN_FILTER_PARAMS);

  const resetConditioning = () => {
    for (const ema of Object.values(ratioEma)) ema.reset();
    pinchEma.reset();
    gatherEma.reset();
    opennessEma.reset();
    for (const latch of Object.values(extendLatch)) latch.reset(false);
    cursorFilterX.reset();
    cursorFilterY.reset();
    pinchFilterX.reset();
    pinchFilterY.reset();
    panFilterX.reset();
  };

  let lastStatusKey = "";
  const setStatus = (key, html, active) => {
    if (key === lastStatusKey) return;
    lastStatusKey = key;
    statusBox.classList.toggle("active", !!active);
    statusBox.innerHTML = html;
  };

  let lastPanDx = 0; // most recent pan delta, surfaced in the debug readout

  const dispatch = (event) => {
    switch (event.type) {
      case "orbit":
        handlers.onOrbitDelta(-event.dx * ORBIT_SPEED_X, -event.dy * ORBIT_SPEED_Y);
        break;
      case "pan":
        lastPanDx = event.dx;
        handlers.onPanDelta(-event.dx * PAN_SPEED);
        break;
      case "zoomStart":
        handlers.onZoomStart();
        break;
      case "zoomRatio":
        handlers.onZoomRatio(event.ratio);
        break;
      case "select":
        handlers.onSelect();
        break;
      case "pointerEnd":
        handlers.onPointerEnd();
        break;
    }
  };

  hands.onResults((results) => {
    if (loadingText && document.body.contains(loadingText)) {
      loadingText.style.opacity = "0";
      setTimeout(() => loadingText.remove(), 500);
    }

    if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
      resetConditioning();
      for (const event of machine.step({ state: "none" })) dispatch(event);
      setStatus("nohand", "No hand detected. Place your hand in the camera view (bottom right).", false);
      handlers.onDebug?.({ state: "none" });
      return;
    }

    const t = performance.now() / 1000;
    const hand1 = results.multiHandLandmarks[0];
    const wrist = hand1[0];
    const thumbIP = hand1[3];
    const thumbTip = hand1[4];
    const indexPip = hand1[6];
    const indexTip = hand1[8];
    const middleBase = hand1[9];
    const middlePip = hand1[10];
    const middleTip = hand1[12];
    const ringPip = hand1[14];
    const ringTip = hand1[16];
    const pinkyPip = hand1[18];
    const pinkyTip = hand1[20];

    const palmSize = Math.hypot(wrist.x - middleBase.x, wrist.y - middleBase.y) || 0.08;
    const palmCenterX = (wrist.x + middleBase.x) * 0.5;
    const palmCenterY = (wrist.y + middleBase.y) * 0.5;

    // Tip-vs-pip distance ratios (from the wrist; from the palm center for
    // the thumb), EMA-smoothed before any threshold sees them.
    const fromWrist = (lm) => Math.hypot(lm.x - wrist.x, lm.y - wrist.y);
    const fromPalm = (lm) => Math.hypot(lm.x - palmCenterX, lm.y - palmCenterY);
    const ratio = {
      index: ratioEma.index.filter(fromWrist(indexTip) / Math.max(fromWrist(indexPip), 1e-6)),
      middle: ratioEma.middle.filter(fromWrist(middleTip) / Math.max(fromWrist(middlePip), 1e-6)),
      ring: ratioEma.ring.filter(fromWrist(ringTip) / Math.max(fromWrist(ringPip), 1e-6)),
      pinky: ratioEma.pinky.filter(fromWrist(pinkyTip) / Math.max(fromWrist(pinkyPip), 1e-6)),
      thumb: ratioEma.thumb.filter(fromPalm(thumbTip) / Math.max(fromPalm(thumbIP), 1e-6))
    };

    // Fist-style curl booleans (legacy thresholds, smoothed inputs).
    const curled = {
      index: ratio.index < CURL_RATIO_INDEX_MIDDLE_RING,
      middle: ratio.middle < CURL_RATIO_INDEX_MIDDLE_RING,
      ring: ratio.ring < CURL_RATIO_INDEX_MIDDLE_RING,
      pinky: ratio.pinky < CURL_RATIO_PINKY,
      thumb: ratio.thumb < CURL_RATIO_THUMB
    };
    const fingertipSpread =
      (
        fromPalm(thumbTip) + fromPalm(indexTip) + fromPalm(middleTip) +
        fromPalm(ringTip) + fromPalm(pinkyTip)
      ) / 5;
    const openness = opennessEma.filter(fingertipSpread / palmSize);

    // Deliberate-extension latches for pointer/click poses.
    const extended = {
      index: extendLatch.index.update(ratio.index),
      middle: extendLatch.middle.update(ratio.middle),
      ring: extendLatch.ring.update(ratio.ring),
      pinky: extendLatch.pinky.update(ratio.pinky)
    };

    const pinchRatioRaw = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y) / palmSize;
    const pinchRatio = pinchEma.filter(pinchRatioRaw);

    // Gather ("all-fingers pinch"): the LARGEST fingertip-to-thumb-tip
    // distance — all four tips must converge on the thumb for it to drop.
    const toThumb = (lm) => Math.hypot(lm.x - thumbTip.x, lm.y - thumbTip.y);
    const gatherSpreadRaw =
      Math.max(toThumb(indexTip), toThumb(middleTip), toThumb(ringTip), toThumb(pinkyTip)) / palmSize;
    const gatherSpread = gatherEma.filter(gatherSpreadRaw);

    const state = classifyHandState({
      wasPinching: machine.state === "pinch",
      wasGathering: machine.state === "gather",
      pinchRatio,
      gatherSpread,
      curled,
      extended,
      openness
    });

    // Mirrored coordinates (the webcam preview is mirrored, so "hand moves
    // right on screen" means x decreases in landmark space). The pinch-drag
    // midpoint is One-Euro-filtered so orbit deltas don't carry jitter.
    lastPanDx = 0;
    const events = machine.step({
      state,
      pinchX: state === "pinch" ? pinchFilterX.filter(1 - (thumbTip.x + indexTip.x) * 0.5, t) : 0,
      pinchY: state === "pinch" ? pinchFilterY.filter((thumbTip.y + indexTip.y) * 0.5, t) : 0,
      gatherX: state === "gather" ? panFilterX.filter(1 - palmCenterX, t) : 0,
      palmScale: THREE.MathUtils.clamp(mapPalmSizeToScale(palmSize), MIN_GESTURE_SCALE, MAX_GESTURE_SCALE)
    });
    for (const event of events) dispatch(event);
    if (state !== "pinch") {
      pinchFilterX.reset();
      pinchFilterY.reset();
    }
    if (state !== "gather") {
      panFilterX.reset();
    }

    if (state === "pointer" || state === "click") {
      const cx = cursorFilterX.filter(1 - indexTip.x, t);
      const cy = cursorFilterY.filter(indexTip.y, t);
      handlers.onPointer(cx * window.innerWidth, cy * window.innerHeight);
    } else {
      cursorFilterX.reset();
      cursorFilterY.reset();
    }

    setStatus(state, STATUS_BY_STATE[state], state !== "idle");

    handlers.onDebug?.({
      state,
      pinchRatio,
      pinchRatioRaw,
      gatherSpread,
      gatherSpreadRaw,
      panDx: lastPanDx,
      othersCurled: [curled.middle, curled.ring, curled.pinky].filter(Boolean).length,
      openness,
      isFist: state === "fist",
      thumbCurled: curled.thumb,
      fingers: {
        index: { ratio: ratio.index, extended: extended.index, curled: curled.index },
        middle: { ratio: ratio.middle, extended: extended.middle, curled: curled.middle },
        ring: { ratio: ratio.ring, extended: extended.ring, curled: curled.ring },
        pinky: { ratio: ratio.pinky, extended: extended.pinky, curled: curled.pinky }
      }
    });
  });

  const cameraUtils = new window.Camera(videoElement, {
    onFrame: async () => {
      await hands.send({ image: videoElement });
    },
    width: 640,
    height: 480
  });

  cameraUtils.start()
    .then(() => {
      statusBox.textContent = "Camera started. Show your hand: pinch-drag orbits, fist zooms, pointing inspects.";
    })
    .catch((err) => {
      console.error(err);
      loadingText.textContent = "Camera access failed: please allow camera permission in your browser and make sure the page is served from localhost / 127.0.0.1.";
      statusBox.textContent = "Camera failed to start — gestures are off. Mouse still works: drag to orbit, scroll to zoom, Navigate dropdown to select.";
      setTimeout(() => loadingText.remove(), 4000);
    });
}
