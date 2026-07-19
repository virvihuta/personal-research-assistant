/**
 * Turns a validated scene graph into particle target arrays. Pure math, no
 * Three.js dependency.
 *
 * Only LEAF nodes receive particles — a parent node is the spatial region its
 * children form, so zooming in reveals real substructure instead of a denser
 * blob. Leaves render as fuzzy balls or (shape: "slab") wide flat bands.
 * Edge particles are laid contiguously per edge so focus/defocus can light
 * edges whose endpoints are both inside the focused subtree.
 *
 * Returns { positions, colors, nodeRanges, edgeRanges } where nodeRanges maps
 * leaf id -> { start, count } (particle indices) and edgeRanges is
 * [{ from, to, start, count }].
 */

const EDGE_PARTICLE_SHARE = 0.12;
const EDGE_JITTER = 0.55;
const EDGE_BRIGHTNESS = 0.55;
const NODE_WEIGHT_EXPONENT = 1.6;
const MIN_PARTICLES_PER_LEAF = 300; // tiny leaves (Q/K/V) must stay visible up close

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// Triangular distribution around 0 in [-1, 1]: denser core, soft edges.
const tri = () => Math.random() + Math.random() - 1;

export function sceneGraphToTargets(graph, particleCount) {
  const positions = new Float32Array(particleCount * 3);
  const colors = new Float32Array(particleCount * 3);
  const { nodes, edges } = graph;

  const centers = new Map(nodes.map((n) => [n.id, n.position]));
  const rgbById = new Map(nodes.map((n) => [n.id, hexToRgb(n.color)]));
  const parentIds = new Set(nodes.filter((n) => n.parent != null).map((n) => n.parent));
  const leaves = nodes.filter((n) => !parentIds.has(n.id));

  const edgeBudget = edges.length > 0 ? Math.floor(particleCount * EDGE_PARTICLE_SHARE) : 0;
  const nodeBudget = particleCount - edgeBudget;

  // Floor allocation first so tiny leaves stay visible, then distribute the
  // remainder by size weight.
  const weights = leaves.map((n) => Math.pow(n.size, NODE_WEIGHT_EXPONENT));
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const floorTotal = MIN_PARTICLES_PER_LEAF * leaves.length;
  const remainder = Math.max(0, nodeBudget - floorTotal);
  const counts = leaves.map((_, i) =>
    MIN_PARTICLES_PER_LEAF + Math.floor(remainder * (weights[i] / weightSum))
  );
  counts[counts.length - 1] += nodeBudget - counts.reduce((a, b) => a + b, 0);

  let cursor = 0;
  const writeParticle = (x, y, z, rgb, brightness) => {
    const i3 = cursor * 3;
    positions[i3] = x;
    positions[i3 + 1] = y;
    positions[i3 + 2] = z;
    colors[i3] = Math.min(1, rgb[0] * brightness);
    colors[i3 + 1] = Math.min(1, rgb[1] * brightness);
    colors[i3 + 2] = Math.min(1, rgb[2] * brightness);
    cursor++;
  };

  const nodeRanges = new Map();
  leaves.forEach((node, index) => {
    const count = counts[index];
    const rgb = rgbById.get(node.id);
    const p = node.position;
    nodeRanges.set(node.id, { start: cursor, count });

    if (node.shape === "slab") {
      for (let i = 0; i < count; i++) {
        writeParticle(
          p.x + tri() * node.size * 1.6,
          p.y + tri() * node.size * 0.22,
          p.z + tri() * node.size * 1.0,
          rgb,
          0.8 + Math.random() * 0.4
        );
      }
    } else {
      for (let i = 0; i < count; i++) {
        const r = node.size * Math.cbrt(Math.random());
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        writeParticle(
          p.x + r * Math.sin(phi) * Math.cos(theta),
          p.y + r * Math.sin(phi) * Math.sin(theta),
          p.z + r * Math.cos(phi),
          rgb,
          0.8 + Math.random() * 0.4
        );
      }
    }
  });

  const edgeRanges = [];
  edges.forEach((edge, index) => {
    const remainingEdges = edges.length - index;
    const count = Math.floor((particleCount - cursor) / remainingEdges);
    const from = centers.get(edge.from);
    const to = centers.get(edge.to);
    const fromRgb = rgbById.get(edge.from);
    const toRgb = rgbById.get(edge.to);
    edgeRanges.push({ from: edge.from, to: edge.to, start: cursor, count });

    for (let i = 0; i < count; i++) {
      const t = Math.random();
      writeParticle(
        from.x + (to.x - from.x) * t + (Math.random() - 0.5) * EDGE_JITTER,
        from.y + (to.y - from.y) * t + (Math.random() - 0.5) * EDGE_JITTER,
        from.z + (to.z - from.z) * t + (Math.random() - 0.5) * EDGE_JITTER,
        [
          fromRgb[0] + (toRgb[0] - fromRgb[0]) * t,
          fromRgb[1] + (toRgb[1] - fromRgb[1]) * t,
          fromRgb[2] + (toRgb[2] - fromRgb[2]) * t
        ],
        EDGE_BRIGHTNESS
      );
    }
  });

  return { positions, colors, nodeRanges, edgeRanges };
}
