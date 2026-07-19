// MediaPipe Hands wiring + gesture classification. window.Hands and
// window.Camera come from the classic CDN scripts loaded in index.html.

const MIN_GESTURE_SCALE = 0.1;
const MAX_GESTURE_SCALE = 2.4;
const PALM_SIZE_MIN = 0.11;
const PALM_SIZE_MAX = 0.28;
const PALM_SIZE_SCALE_ONE = 0.1547368421;

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

export function initGestures({ videoElement, statusBox, loadingText, onRotationTarget, onScaleTarget }) {
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

  hands.onResults((results) => {
    if (loadingText && document.body.contains(loadingText)) {
      loadingText.style.opacity = "0";
      setTimeout(() => loadingText.remove(), 500);
    }

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      statusBox.classList.add("active");

      const hand1 = results.multiHandLandmarks[0];
      const wrist = hand1[0];
      const thumbTip = hand1[4];
      const thumbIP = hand1[3];
      const indexPip = hand1[6];
      const indexTip = hand1[8];
      const middlePip = hand1[10];
      const middleTip = hand1[12];
      const ringPip = hand1[14];
      const middleBase = hand1[9];
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

      const handCenterX = (wrist.x + middleBase.x + hand1[5].x + hand1[17].x) * 0.25;
      const handCenterY = (wrist.y + middleBase.y + hand1[5].y + hand1[17].y) * 0.25;
      onRotationTarget(
        (handCenterY - 0.5) * Math.PI * 1.1,
        -(handCenterX - 0.5) * Math.PI * 1.8
      );

      let targetGestureScale = 1.0;
      if (isFist) {
        const distanceScale = mapPalmSizeToScale(palmSize);
        targetGestureScale = THREE.MathUtils.clamp(distanceScale, MIN_GESTURE_SCALE, MAX_GESTURE_SCALE);
      }
      onScaleTarget(targetGestureScale);

      statusBox.innerHTML =
        `Gesture: ${isFist ? "Fist" : "Not a fist"}&nbsp;&nbsp;Scale: ${targetGestureScale.toFixed(2)}<br>` +
        `${isFist ? "Move closer to the camera to enlarge particles" : "Only rotation is active right now"}`;
    } else {
      statusBox.classList.remove("active");
      statusBox.textContent = "No hand detected. Place your hand in the camera view (bottom right).";
      onScaleTarget(1.0);
    }
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
      statusBox.textContent = "Camera started. Show your hand to the camera.";
    })
    .catch((err) => {
      console.error(err);
      loadingText.textContent = "Camera access failed: please allow camera permission in your browser and make sure the page is served from localhost / 127.0.0.1.";
      statusBox.textContent = "Camera failed to start. You can still drag with the mouse to rotate the particles.";
      setTimeout(() => loadingText.remove(), 4000);
    });
}
