import { systemId } from "../../system.js";
import { isSelfCenteredAreaAction } from "../action/requirements.js";
import { canvasDistancePixels as distancePixels, canvasGridSize as gridSize, canvasPoint as point, canvasTokenById, contextTokenId, numeric } from "../../rules/canvas-geometry.js";
import { movementFootprintForToken } from "../../rules/token-geometry.js";
import { contextEnemies } from "../target-pool.js";

const AREA_MARKER_SHAPES = new Set(["burst", "cone", "cube", "cylinder", "emanation", "line", "ring", "square"]);

function tokenFootprint(token, context) {
  const source = token && context?.token
    ? {
      ...context.token,
      ...token,
      width: token.width ?? context.token.width,
      height: token.height ?? context.token.height,
      document: token.document ?? context.token.document,
    }
    : (token ?? context?.token);
  const footprint = movementFootprintForToken(source);
  return {
    width: footprint.widthCells,
    height: footprint.heightCells,
  };
}

function tokenBase(context) {
  const token = canvasTokenById(contextTokenId(context));
  const size = gridSize();
  const center = point(token?.center) ?? point(context?.token?.center) ?? { x: 0, y: 0 };
  const footprint = tokenFootprint(token, context);
  return {
    type: "token",
    x: center.x - (footprint.width * size) / 2,
    y: center.y - (footprint.height * size) / 2,
    width: footprint.width * size,
    height: footprint.height * size,
  };
}

// PF2e/SF2e cones and lines start at the edge of the creature's space, not its middle: a 20-ft cone
// from a Medium creature reaches the fourth square out. Returns where a cone/line aimed along
// 'radians' from the caster leaves its space (a corner when aimed diagonally). A marker that
// doesn't start on the caster (a dragged template) keeps its own origin.
export function casterEdgeOrigin(context, center, radians) {
  if (!center || !Number.isFinite(radians)) return center;
  const base = tokenBase(context);
  const casterCenter = { x: base.x + base.width / 2, y: base.y + base.height / 2 };
  if (Math.hypot(center.x - casterCenter.x, center.y - casterCenter.y) > 1) return center;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const halfWidth = base.width / 2;
  const halfHeight = base.height / 2;
  const reach = Math.min(
    Math.abs(cos) > 1e-9 ? halfWidth / Math.abs(cos) : Infinity,
    Math.abs(sin) > 1e-9 ? halfHeight / Math.abs(sin) : Infinity,
  );
  if (!Number.isFinite(reach)) return center;
  return { x: center.x + cos * reach, y: center.y + sin * reach };
}

export function areaRegionType(action, marker) {
  return String(
    marker?.shape
    ?? marker?.type
    ?? action?.targetingProfile?.type
    ?? action?.targetingProfile?.shape
    ?? action?.action?.targetingProfile?.type
    ?? action?.action?.targetingProfile?.shape
    ?? action?.area?.type
    ?? "burst",
  ).toLowerCase();
}

export function areaMarkerShape(action, fallback = "burst") {
  const value = areaRegionType(action, null);
  return AREA_MARKER_SHAPES.has(value) ? value : fallback;
}

export function areaRegionDistance(action, marker = null, fallback = 5) {
  return numeric(
    marker?.distance
      ?? marker?.radius
      ?? action?.targetingProfile?.distance
      ?? action?.targetingProfile?.radius
      ?? action?.action?.targetingProfile?.distance
      ?? action?.action?.targetingProfile?.radius,
    fallback,
  ) || fallback;
}

export function areaRegionWidth(action, marker = null, fallback = globalThis.canvas?.grid?.size ?? areaRegionDistance(action, marker)) {
  return numeric(
    marker?.width
      ?? action?.targetingProfile?.width
      ?? action?.action?.targetingProfile?.width,
    fallback,
  ) || areaRegionDistance(action, marker);
}

export function areaMarkerLabel(shape, distance) {
  return `${shape.charAt(0).toUpperCase()}${shape.slice(1)} ${distance} ft`;
}

// Where a cube's center may sit, as PF2e's own placement allows: a square's center, a grid vertex,
// or an edge's midpoint (every half square). A 5-foot cube on a vertex touches the four squares
// around it, and the creatures in them.
export function gridAlignedCubeCenter(center, _sizePx) {
  const grid = gridSize();
  if (globalThis.canvas?.grid?.isSquare === false || grid <= 1) return center;
  const step = grid / 2;
  const snap = (value) => Math.round(value / step) * step;
  return { x: snap(center.x), y: snap(center.y) };
}

export function createAreaRegionData({ context, action, marker }) {
  const center = point(marker?.center) ?? point(marker) ?? point(context?.token?.center) ?? { x: 0, y: 0 };
  const type = areaRegionType(action, marker);
  const distance = areaRegionDistance(action, marker);
  const width = areaRegionWidth(action, marker);
  const distancePx = distancePixels(distance);
  const widthPx = distancePixels(width);
  const rotation = numeric(marker?.rotation, 0) || 0;
  const baseShape = { x: center.x, y: center.y };
  let shape;

  if (type === "cone" || type === "line") {
    // A template the user placed keeps its origin; a planned one starts at the caster's edge.
    const start = marker?.userPlaced ? center : casterEdgeOrigin(context, center, (rotation * Math.PI) / 180);
    shape = type === "cone"
      ? { x: start.x, y: start.y, type: "cone", radius: distancePx, angle: numeric(marker?.angle, 90) || 90, rotation }
      : { x: start.x, y: start.y, type: "line", length: distancePx, width: widthPx, rotation };
  } else if (type === "cube" || type === "square") {
    // A cube sits on the grid and never turns: its corner on a grid vertex, as PF2e places it.
    // The marker holds its center; the rectangle is anchored at its top-left corner.
    const square = gridAlignedCubeCenter(center, distancePx);
    shape = { x: square.x - distancePx / 2, y: square.y - distancePx / 2, type: "rectangle", width: distancePx, height: distancePx, anchorX: 0, anchorY: 0, rotation: 0 };
  } else if (type === "emanation") {
    const base = isSelfCenteredAreaAction(action) ? tokenBase(context) : null;
    const halfFootprint = base ? Math.max(base.width, base.height) / 2 : 0;
    shape = { ...baseShape, type: "circle", radius: distancePx + halfFootprint };
  } else if (type === "ring") {
    shape = {
      ...baseShape,
      type: "ring",
      radius: distancePx,
      innerWidth: distancePixels(numeric(marker?.innerWidth ?? action?.targetingProfile?.innerWidth, Math.max(0, distance - width)) || 0),
      outerWidth: widthPx,
    };
  } else {
    shape = { ...baseShape, type: "circle", radius: distancePx };
  }

  const originUuid = action?.item?.uuid ?? action?.uuid ?? null;
  const flags = { [systemId()]: { areaShape: type } };
  if (originUuid) flags["pf2e-combater"] = { originUuid };

  return {
    name: marker?.label ?? action?.name ?? "Planned area",
    shapes: [shape],
    color: marker?.color ?? "#f0b34a",
    highlightMode: "coverage",
    displayMeasurements: true,
    visibility: globalThis.CONST?.REGION_VISIBILITY?.ALWAYS ?? 1,
    flags,
  };
}

function pointInAreaShape(value, shape) {
  const dx = value.x - shape.x;
  const dy = value.y - shape.y;
  switch (shape.type) {
    case "circle":
    case "emanation":
      return dx * dx + dy * dy <= shape.radius * shape.radius;
    case "ring": {
      const distance = Math.hypot(dx, dy);
      const inner = Math.max(0, numeric(shape.radius, 0) - numeric(shape.outerWidth, 0));
      return distance <= shape.radius && distance >= inner;
    }
    case "cone": {
      const distance = Math.hypot(dx, dy);
      if (distance > shape.radius) return false;
      if (distance === 0) return true;
      const pointAngle = (Math.atan2(dy, dx) * 180) / Math.PI;
      const half = (numeric(shape.angle, 90) || 90) / 2;
      const delta = ((((pointAngle - numeric(shape.rotation, 0)) % 360) + 540) % 360) - 180;
      return Math.abs(delta) <= half;
    }
    case "line": {
      const radians = (numeric(shape.rotation, 0) * Math.PI) / 180;
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);
      const along = dx * cos + dy * sin;
      const perpendicular = -dx * sin + dy * cos;
      return along >= 0 && along <= shape.length && Math.abs(perpendicular) <= shape.width / 2;
    }
    case "rectangle": {
      const radians = (numeric(shape.rotation, 0) * Math.PI) / 180;
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);
      // x/y is the anchor point: the top-left corner by default, the center for a cube.
      const localX = dx * cos + dy * sin + shape.width * numeric(shape.anchorX, 0);
      const localY = -dx * sin + dy * cos + shape.height * numeric(shape.anchorY, 0);
      return localX >= 0 && localX <= shape.width && localY >= 0 && localY <= shape.height;
    }
    default:
      return false;
  }
}

function areaTargetAllowed(token, context, action) {
  if (action?.targetingProfile?.enemiesOnly !== true) return true;
  const identities = [token.id, token.uuid, token.document?.id, token.document?.uuid].filter(Boolean);
  return contextEnemies(context).some((enemy) => [
    enemy.id, enemy.uuid, enemy.token?.id, enemy.token?.uuid, enemy.document?.id, enemy.document?.uuid,
  ].some((id) => id && identities.includes(id)));
}

// The centers of the grid squares a creature occupies: a Huge dragon is in an area that covers
// any of its squares, not only the one at its middle. Smaller than a square: its own center.
function tokenSquareCenters(token) {
  const center = point(token?.center);
  if (!center) return [];
  const document = token?.document ?? token;
  const grid = gridSize();
  const width = Number(document?.width);
  const height = Number(document?.height);
  if (!(width > 1 || height > 1) || grid <= 1) return [center];
  const columns = Math.max(1, Math.round(width));
  const rows = Math.max(1, Math.round(height));
  const left = center.x - (columns * grid) / 2;
  const top = center.y - (rows * grid) / 2;
  const squares = [center];
  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < rows; row += 1) {
      squares.push({ x: left + (column + 0.5) * grid, y: top + (row + 0.5) * grid });
    }
  }
  return squares;
}

export function tokensInAreaMarker({ context, action, marker }) {
  const shape = createAreaRegionData({ context, action, marker })?.shapes?.[0];
  if (!shape) return [];
  return (globalThis.canvas?.tokens?.placeables ?? []).filter((token) => {
    if (!areaTargetAllowed(token, context, action)) return false;
    return tokenSquareCenters(token).some((square) => pointInAreaShape(square, shape));
  });
}

// The tokens Foundry itself counts inside a placed region: its grid and diagonal rules, every part of
// a large creature, elevation. Null when that cannot be tested, so the caller falls back to the marker.
export function tokensInAreaRegion({ context, action, region }) {
  if (!region) return null;
  const tokens = globalThis.canvas?.tokens?.placeables ?? [];
  try {
    const inside = tokens.filter((token) => typeof token?.document?.testInsideRegion === "function"
      && token.document.testInsideRegion(region));
    if (!tokens.some((token) => typeof token?.document?.testInsideRegion === "function")) return null;
    return inside.filter((token) => areaTargetAllowed(token, context, action));
  } catch (_error) {
    return null;
  }
}
