// GPU morphing material: the vertex shader interpolates each particle from
// its start position (the standard `position` attribute) toward a
// `targetPosition` attribute via the uMix uniform, and applies gesture scale
// via uScale — so the CPU updates three scalars per frame instead of touching
// 35k particles. Point sizing replicates PointsMaterial's attenuation
// (gl_PointSize = size * (0.5 * drawingBufferHeight / -z)) so the migration
// is pixel-identical; fog chunks keep FogExp2 depth fading working.

export const MORPH_VERTEX_SHADER = /* glsl */ `
  uniform float uMix;
  uniform float uScale;
  uniform float uSize;
  uniform float uPointScale;
  attribute vec3 targetPosition;
  attribute float focus;
  varying vec3 vColor;
  varying float vFocus;
  #include <fog_pars_vertex>

  void main() {
    vColor = color;
    vFocus = focus;
    vec3 morphed = mix(position, targetPosition, uMix) * uScale;
    vec4 mvPosition = modelViewMatrix * vec4(morphed, 1.0);
    gl_PointSize = uSize * (uPointScale / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

// uDefocus fades/desaturates particles whose focus attribute is 0 (outside
// the focused subtree). At uDefocus=0 the attribute is irrelevant, so
// geometries without a focus attribute (presets, benchmark) render unchanged.
export const MORPH_FRAGMENT_SHADER = /* glsl */ `
  uniform float uOpacity;
  uniform float uDefocus;
  varying vec3 vColor;
  varying float vFocus;
  #include <fog_pars_fragment>

  void main() {
    float dim = uDefocus * (1.0 - vFocus);
    vec3 grayed = vec3(dot(vColor, vec3(0.299, 0.587, 0.114))) * 0.35;
    vec3 color = mix(vColor, grayed, dim);
    float alpha = uOpacity * mix(1.0, 0.3, dim);
    gl_FragColor = vec4(color, alpha);
    #include <fog_fragment>
  }
`;

export function createMorphMaterial({ size = 0.34, opacity = 0.95, fog = false } = {}) {
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uMix: { value: 1.0 },
      uScale: { value: 1.0 },
      uSize: { value: size },
      uPointScale: { value: 1.0 },
      uOpacity: { value: opacity },
      uDefocus: { value: 0.0 }
    }
  ]);

  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: MORPH_VERTEX_SHADER,
    fragmentShader: MORPH_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
    fog
  });
}
