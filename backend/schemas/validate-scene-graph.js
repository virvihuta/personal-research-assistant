/**
 * Validator for LLM-produced scene graphs. Mirrors scene-graph.schema.json —
 * keep the two in sync (hand-rolled instead of a schema library to stay
 * dependency-free and browser/Node portable; revisit if the schema grows).
 * Also enforces the referential rules JSON Schema cannot express: unique ids,
 * edge endpoints and parents referencing real nodes, no self-edges, acyclic
 * parent links.
 *
 * Returns { valid: boolean, errors: string[] } — never throws. A malformed
 * graph must degrade to a visible error message, not crash the renderer.
 */

const NODE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const EDGE_TYPES = ["flow", "residual", "reference"];
const NODE_SHAPES = ["ball", "slab"];
const MAX_NODES = 64;
const MAX_NODE_SIZE = 10;
const MAX_DESCRIPTION_LENGTH = 500;

const GRAPH_KEYS = new Set(["id", "label", "nodes", "edges"]);
const NODE_KEYS = new Set(["id", "label", "description", "position", "size", "color", "shape", "parent"]);
const EDGE_KEYS = new Set(["from", "to", "type"]);

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkUnknownKeys(obj, allowed, where, errors) {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) errors.push(`${where}: unknown property "${key}"`);
  }
}

function validateNode(node, index, errors) {
  const where = `nodes[${index}]`;

  if (!isPlainObject(node)) {
    errors.push(`${where}: must be an object`);
    return null;
  }
  checkUnknownKeys(node, NODE_KEYS, where, errors);

  if (typeof node.id !== "string" || !NODE_ID_PATTERN.test(node.id)) {
    errors.push(`${where}.id: must be a kebab-case string (got ${JSON.stringify(node.id)})`);
  }
  if (typeof node.label !== "string" || node.label.length === 0) {
    errors.push(`${where}.label: must be a non-empty string`);
  }
  if (typeof node.description !== "string" || node.description.length === 0 || node.description.length > MAX_DESCRIPTION_LENGTH) {
    errors.push(`${where}.description: must be a non-empty string of at most ${MAX_DESCRIPTION_LENGTH} characters`);
  }

  if (!isPlainObject(node.position)) {
    errors.push(`${where}.position: must be an object with numeric x, y, z`);
  } else {
    checkUnknownKeys(node.position, new Set(["x", "y", "z"]), `${where}.position`, errors);
    for (const axis of ["x", "y", "z"]) {
      if (!Number.isFinite(node.position[axis])) {
        errors.push(`${where}.position.${axis}: must be a finite number`);
      }
    }
  }

  if (!Number.isFinite(node.size) || node.size <= 0 || node.size > MAX_NODE_SIZE) {
    errors.push(`${where}.size: must be a number in (0, ${MAX_NODE_SIZE}]`);
  }
  if (typeof node.color !== "string" || !COLOR_PATTERN.test(node.color)) {
    errors.push(`${where}.color: must be a #rrggbb hex string (got ${JSON.stringify(node.color)})`);
  }
  if (node.shape !== undefined && !NODE_SHAPES.includes(node.shape)) {
    errors.push(`${where}.shape: must be one of ${NODE_SHAPES.join(", ")} (got ${JSON.stringify(node.shape)})`);
  }
  if (node.parent !== undefined && node.parent !== null && typeof node.parent !== "string") {
    errors.push(`${where}.parent: must be a node id string or null`);
  }

  return typeof node.id === "string" ? node.id : null;
}

function validateEdge(edge, index, nodeIds, errors) {
  const where = `edges[${index}]`;

  if (!isPlainObject(edge)) {
    errors.push(`${where}: must be an object`);
    return;
  }
  checkUnknownKeys(edge, EDGE_KEYS, where, errors);

  for (const end of ["from", "to"]) {
    if (typeof edge[end] !== "string") {
      errors.push(`${where}.${end}: must be a node id string`);
    } else if (!nodeIds.has(edge[end])) {
      errors.push(`${where}.${end}: references unknown node "${edge[end]}"`);
    }
  }
  if (typeof edge.from === "string" && edge.from === edge.to) {
    errors.push(`${where}: self-edges are not allowed ("${edge.from}")`);
  }
  if (!EDGE_TYPES.includes(edge.type)) {
    errors.push(`${where}.type: must be one of ${EDGE_TYPES.join(", ")} (got ${JSON.stringify(edge.type)})`);
  }
}

function validateParentLinks(nodes, nodeIds, errors) {
  const parentOf = new Map();
  for (const node of nodes) {
    if (isPlainObject(node) && typeof node.id === "string" && typeof node.parent === "string") {
      parentOf.set(node.id, node.parent);
      if (node.parent === node.id) {
        errors.push(`node "${node.id}": cannot be its own parent`);
      } else if (!nodeIds.has(node.parent)) {
        errors.push(`node "${node.id}": parent references unknown node "${node.parent}"`);
      }
    }
  }

  for (const startId of parentOf.keys()) {
    const seen = new Set([startId]);
    let current = parentOf.get(startId);
    while (current !== undefined) {
      if (seen.has(current)) {
        errors.push(`node "${startId}": parent chain forms a cycle`);
        break;
      }
      seen.add(current);
      current = parentOf.get(current);
    }
  }
}

export function validateSceneGraph(graph) {
  const errors = [];

  if (!isPlainObject(graph)) {
    return { valid: false, errors: ["scene graph must be a JSON object"] };
  }
  checkUnknownKeys(graph, GRAPH_KEYS, "graph", errors);

  if (graph.id !== undefined && typeof graph.id !== "string") {
    errors.push("graph.id: must be a string");
  }
  if (graph.label !== undefined && typeof graph.label !== "string") {
    errors.push("graph.label: must be a string");
  }

  if (!Array.isArray(graph.nodes) || graph.nodes.length === 0) {
    errors.push("graph.nodes: must be a non-empty array");
    return { valid: false, errors };
  }
  if (graph.nodes.length > MAX_NODES) {
    errors.push(`graph.nodes: too many nodes (${graph.nodes.length} > ${MAX_NODES})`);
  }

  const nodeIds = new Set();
  graph.nodes.forEach((node, index) => {
    const id = validateNode(node, index, errors);
    if (id !== null) {
      if (nodeIds.has(id)) errors.push(`nodes[${index}].id: duplicate id "${id}"`);
      nodeIds.add(id);
    }
  });

  if (!Array.isArray(graph.edges)) {
    errors.push("graph.edges: must be an array (may be empty)");
  } else {
    graph.edges.forEach((edge, index) => validateEdge(edge, index, nodeIds, errors));
  }

  validateParentLinks(graph.nodes, nodeIds, errors);

  return { valid: errors.length === 0, errors };
}
