// Preset shape target generators, parameterized by particle count so the
// benchmark harness can reuse them at arbitrary sizes.

export function generatePresetTargets(count) {
  const tree = new Float32Array(count * 3);
  const saturn = new Float32Array(count * 3);
  const heart = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const i3 = i * 3;

    // Christmas tree
    if (i < count * 0.08) {
      const angle = Math.random() * Math.PI * 2;
      const starWave = Math.abs(Math.sin(angle * 5));
      const r = (1.8 + starWave * 3.0) * Math.sqrt(Math.random());
      tree[i3] = r * Math.cos(angle);
      tree[i3 + 1] = 20 + (Math.random() - 0.5) * 1.5;
      tree[i3 + 2] = r * Math.sin(angle) * 0.45;
    } else if (i < count * 0.92) {
      const h = Math.random() * 32 - 14;
      const layerNormalized = (h + 14) / 32;
      const layerProgress = (layerNormalized * 4) % 1.0;
      let baseRadius = (1.0 - layerNormalized) * 18;
      baseRadius *= Math.pow(layerProgress, 0.42);
      const angle = Math.random() * Math.PI * 2;
      const r = Math.max(0, baseRadius * Math.sqrt(Math.random()) + (Math.random() - 0.5) * 2.5);
      tree[i3] = Math.cos(angle) * r;
      tree[i3 + 1] = h;
      tree[i3 + 2] = Math.sin(angle) * r;
    } else {
      const h = Math.random() * 5 - 19;
      const r = Math.random() * 2.2;
      const angle = Math.random() * Math.PI * 2;
      tree[i3] = Math.cos(angle) * r;
      tree[i3 + 1] = h;
      tree[i3 + 2] = Math.sin(angle) * r;
    }

    // Saturn
    if (i < count * 0.42) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const latFlatten = 0.82 + Math.random() * 0.06;
      const r = 11.5 * Math.cbrt(Math.random());
      saturn[i3] = r * Math.sin(phi) * Math.cos(theta);
      saturn[i3 + 1] = r * Math.sin(phi) * Math.sin(theta) * latFlatten;
      saturn[i3 + 2] = r * Math.cos(phi);
    } else {
      const ringBand = Math.random();
      const bandBase =
        ringBand < 0.22 ? 14.5 :
        ringBand < 0.48 ? 18.5 :
        ringBand < 0.72 ? 23.5 :
        28.5;
      const rRing = bandBase + Math.random() * 3.5 + Math.sin(bandBase * 1.7 + i * 0.013) * 0.9;
      const thetaRing = Math.random() * Math.PI * 2;
      const ringRipple = Math.sin(thetaRing * 10 + rRing * 0.9) * 0.45 + Math.sin(thetaRing * 23) * 0.18;
      const ringThickness = (Math.random() - 0.5) * (0.45 + ringBand * 0.85);
      saturn[i3] = (rRing + ringRipple) * Math.cos(thetaRing);
      saturn[i3 + 1] = ringThickness;
      saturn[i3 + 2] = (rRing + ringRipple) * Math.sin(thetaRing);
    }

    // Heart
    const t = Math.PI * 2 * Math.random();
    const u = Math.PI * (Math.random() - 0.5);
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y = 13 * Math.cos(t) - 5 * Math.cos(2*t) - 2 * Math.cos(3*t) - Math.cos(4*t);
    const z = 6 * Math.sin(u) * (1 - Math.abs(Math.sin(t)));
    heart[i3] = x * 1.35;
    heart[i3 + 1] = y * 1.35;
    heart[i3 + 2] = z * 1.35;
  }

  return { tree, saturn, heart };
}
