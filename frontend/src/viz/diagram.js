/**
 * Turns a validated scene graph into particle target arrays. Pure math, no
 * Three.js dependency. Naive placement for Milestone 1: a fuzzy ball per node
 * plus thin particle streams along edges — the template layout system
 * (Milestone 3) replaces the node positions, not this expansion step.
 */

const EDGE_PARTICLE_SHARE = 0.15;
const EDGE_JITTER = 0.55;
const EDGE_BRIGHTNESS = 0.55;
const NODE_WEIGHT_EXPONENT = 1.6;

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function sceneGraphToTargets(graph, particleCount) {
  const positions = new Float32Array(particleCount * 3);
  const colors = new Float32Array(particleCount * 3);
  const { nodes, edges } = graph;

  const centers = new Map(nodes.map((n) => [n.id, n.position]));
  const rgbById = new Map(nodes.map((n) => [n.id, hexToRgb(n.color)]));

  const edgeBudget = edges.length > 0 ? Math.floor(particleCount * EDGE_PARTICLE_SHARE) : 0;
  const nodeBudget = particleCount - edgeBudget;

  const weights = nodes.map((n) => Math.pow(n.size, NODE_WEIGHT_EXPONENT));
  const weightSum = weights.reduce((a, b) => a + b, 0);

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

  nodes.forEach((node, index) => {
    const isLast = index === nodes.length - 1;
    const count = isLast
      ? Math.max(0, nodeBudget - cursor)
      : Math.round(nodeBudget * (weights[index] / weightSum));
    const rgb = rgbById.get(node.id);

    for (let i = 0; i < count && cursor < nodeBudget; i++) {
      const r = node.size * Math.cbrt(Math.random());
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      writeParticle(
        node.position.x + r * Math.sin(phi) * Math.cos(theta),
        node.position.y + r * Math.sin(phi) * Math.sin(theta),
        node.position.z + r * Math.cos(phi),
        rgb,
        0.8 + Math.random() * 0.4
      );
    }
  });

  const remaining = particleCount - cursor;
  for (let i = 0; i < remaining; i++) {
    const edge = edges[i % edges.length];
    const from = centers.get(edge.from);
    const to = centers.get(edge.to);
    const fromRgb = rgbById.get(edge.from);
    const toRgb = rgbById.get(edge.to);
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

  return { positions, colors };
}
