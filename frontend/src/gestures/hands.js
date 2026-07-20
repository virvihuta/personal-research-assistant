// MediaPipe Hands wiring + per-frame gesture classification. window.Hands and
// window.Camera come from the classic CDN scripts loaded in index.html.
//
// Classification priority per frame: pinch > fist > pointer/click poses >
// idle, so a hand mid-transition between gestures can't misfire (a pinching
// hand also satisfies most fist heuristics, and a fist briefly looks like
// curled pointer fingers). Transition logic (clutch, one-shot click, zoom
// engagement) lives in gesture-state.js, which is pure and unit-tested.

import { GestureStateMachine } from "./gesture-state.js";

// Palm-size -> scale mapping retained from the original prototype; now it
// drives camera zoom ratios instead of mesh scale.
const MIN_GESTURE_SCALE = 0.1;
const MAX_GESTURE_SCALE = 2.4;
const PALM_SIZE_MIN = 0.11;
const PALM_SIZE_MAX = 0.28;
const PALM_SIZE_SCALE_ONE = 0.1547368421;

// Pinch = thumb tip to index tip distance relative to palm size, with
// hysteresis so the boundary doesn't flicker between engaged/released.
const PINCH_ON_RATIO = 0.34;
const PINCH_OFF_RATIO = 0.46;

// Radians of camera orbit per full-frame hand swipe; signs follow the
// OrbitControls drag convention.
const ORBIT_SPEED_X = 3.4;
const ORBIT_SPEED_Y = 2.4;

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
  let lastStatusKey = "";

  const setStatus = (key, html, active) => {
    if (key === lastStatusKey) return;
    lastStatusKey = key;
    statusBox.classList.toggle("active", !!active);
    statusBox.innerHTML = html;
  };

  const dispatch = (event) => {
    switch (event.type) {
      case "orbit":
        handlers.onOrbitDelta(-event.dx * ORBIT_SPEED_X, -event.dy * ORBIT_SPEED_Y);
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
      for (const event of machine.step({ state: "none" })) dispatch(event);
      setStatus("nohand", "No hand detected. Place your hand in the camera view (bottom right).", false);
      return;
    }

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

    const fingertipSpread =
      (
        Math.hypot(thumbTip.x - palmCenterX, thumbTip.y - palmCenterY) +
        Math.hypot(indexTip.x - palmCenterX, indexTip.y - palmCenterY) +
        Math.hypot(middleTip.x - palmCenterX, middleTip.y - palmCenterY) +
        Math.hypot(ringTip.x - palmCenterX, ringTip.y - palmCenterY) +
        Math.hypot(pinkyTip.x - palmCenterX, pinkyTip.y - palmCenterY)
      ) / 5;

    const openness = fingertipSpread / palmSize;

    const thumbCurled =
      Math.hypot(thumbTip.x - palmCenterX, thumbTip.y - palmCenterY) <
      Math.hypot(thumbIP.x - palmCenterX, thumbIP.y - palmCenterY) * 1.1;
    const indexCurled = Math.hypot(indexTip.x - wrist.x, indexTip.y - wrist.y) < Math.hypot(indexPip.x - wrist.x, indexPip.y - wrist.y) * 1.08;
    const middleCurled = Math.hypot(middleTip.x - wrist.x, middleTip.y - wrist.y) < Math.hypot(middlePip.x - wrist.x, middlePip.y - wrist.y) * 1.08;
    const ringCurled = Math.hypot(ringTip.x - wrist.x, ringTip.y - wrist.y) < Math.hypot(ringPip.x - wrist.x, ringPip.y - wrist.y) * 1.08;
    const pinkyCurled = Math.hypot(pinkyTip.x - wrist.x, pinkyTip.y - wrist.y) < Math.hypot(pinkyPip.x - wrist.x, pinkyPip.y - wrist.y) * 1.12;
    const curledCount = [indexCurled, middleCurled, ringCurled, pinkyCurled].filter(Boolean).length;
    const isFist = openness < 1.72 && thumbCurled && curledCount >= 3;

    const pinchRatio = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y) / palmSize;
    const pinched = machine.state === "pinch"
      ? pinchRatio < PINCH_OFF_RATIO
      : pinchRatio < PINCH_ON_RATIO;

    let state;
    if (pinched) state = "pinch";
    else if (isFist) state = "fist";
    else if (!indexCurled && middleCurled && ringCurled && pinkyCurled) state = "pointer";
    else if (!indexCurled && !middleCurled && ringCurled && pinkyCurled) state = "click";
    else state = "idle";

    // Mirrored coordinates (the webcam preview is mirrored, so "hand moves
    // right on screen" means x decreases in landmark space).
    const events = machine.step({
      state,
      pinchX: 1 - (thumbTip.x + indexTip.x) * 0.5,
      pinchY: (thumbTip.y + indexTip.y) * 0.5,
      palmScale: THREE.MathUtils.clamp(mapPalmSizeToScale(palmSize), MIN_GESTURE_SCALE, MAX_GESTURE_SCALE)
    });
    for (const event of events) dispatch(event);

    if (state === "pointer" || state === "click") {
      handlers.onPointer((1 - indexTip.x) * window.innerWidth, indexTip.y * window.innerHeight);
    }

    setStatus(state, STATUS_BY_STATE[state], state !== "idle");
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
