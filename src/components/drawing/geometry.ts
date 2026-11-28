import type { Bounds, Box, DrawingElement, Point, ResizeHandle } from './types';

export function generateId(): string {
  return Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
}

// Distance from point to line segment
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y)));
}

// Check if point is inside a polygon
export function pointInPolygon(p: Point, vs: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i].x;
    const yi = vs[i].y;
    const xj = vs[j].x;
    const yj = vs[j].y;
    const intersect = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Get tight bounding box of an element
export function getElementBounds(el: DrawingElement): Bounds {
  if (
    (el.type === 'freedraw' || el.type === 'line' || el.type === 'arrow') &&
    el.points &&
    el.points.length > 0
  ) {
    const xs = el.points.map((p) => p.x);
    const ys = el.points.map((p) => p.y);
    return {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    };
  }
  const minX = Math.min(el.x, el.x + el.width);
  const maxX = Math.max(el.x, el.x + el.width);
  const minY = Math.min(el.y, el.y + el.height);
  const maxY = Math.max(el.y, el.y + el.height);
  return { minX, minY, maxX, maxY };
}

// Check if an element intersects or is inside a box
export function elementIntersectsBox(el: DrawingElement, box: Box): boolean {
  const b = getElementBounds(el);
  const bx1 = Math.min(box.x, box.x + box.width);
  const bx2 = Math.max(box.x, box.x + box.width);
  const by1 = Math.min(box.y, box.y + box.height);
  const by2 = Math.max(box.y, box.y + box.height);

  return !(b.maxX < bx1 || b.minX > bx2 || b.maxY < by1 || b.minY > by2);
}

// Hit test an element
export function hitTestElement(world: Point, el: DrawingElement): boolean {
  const padding = Math.max(8, el.strokeWidth);

  if (el.type === 'freedraw') {
    if (!el.points || el.points.length === 0) return false;
    return el.points.some((p) => Math.hypot(p.x - world.x, p.y - world.y) <= padding * 1.5);
  }

  if (el.type === 'line' || el.type === 'arrow') {
    if (!el.points || el.points.length < 2) return false;
    const [start, end] = el.points;
    return distanceToSegment(world, start, end) <= padding * 1.5;
  }

  if (el.type === 'rectangle' || el.type === 'rounded-rectangle' || el.type === 'text') {
    const minX = Math.min(el.x, el.x + el.width);
    const maxX = Math.max(el.x, el.x + el.width);
    const minY = Math.min(el.y, el.y + el.height);
    const maxY = Math.max(el.y, el.y + el.height);
    return (
      world.x >= minX - padding &&
      world.x <= maxX + padding &&
      world.y >= minY - padding &&
      world.y <= maxY + padding
    );
  }

  if (el.type === 'ellipse') {
    const rx = Math.abs(el.width) / 2;
    const ry = Math.abs(el.height) / 2;
    const cx = el.x + el.width / 2;
    const cy = el.y + el.height / 2;
    if (rx <= 0 || ry <= 0) return false;
    const val =
      ((world.x - cx) ** 2) / (rx + padding) ** 2 + ((world.y - cy) ** 2) / (ry + padding) ** 2;
    return val <= 1.1;
  }

  if (el.type === 'diamond') {
    const pts = [
      { x: el.x + el.width / 2, y: el.y },
      { x: el.x + el.width, y: el.y + el.height / 2 },
      { x: el.x + el.width / 2, y: el.y + el.height },
      { x: el.x, y: el.y + el.height / 2 },
    ];
    return pointInPolygon(world, pts);
  }

  if (el.type === 'triangle') {
    const pts = [
      { x: el.x + el.width / 2, y: el.y },
      { x: el.x + el.width, y: el.y + el.height },
      { x: el.x, y: el.y + el.height },
    ];
    return pointInPolygon(world, pts);
  }

  return false;
}

// Get resize handles for a single selected element
export function getHandles(el: DrawingElement): Partial<Record<ResizeHandle, Point>> | null {
  if (el.type === 'line' || el.type === 'arrow') {
    if (!el.points || el.points.length < 2) return null;
    return {
      start: el.points[0],
      end: el.points[1],
    };
  }

  const { x, y, width, height } = el;
  return {
    nw: { x, y },
    n: { x: x + width / 2, y },
    ne: { x: x + width, y },
    e: { x: x + width, y: y + height / 2 },
    se: { x: x + width, y: y + height },
    s: { x: x + width / 2, y: y + height },
    sw: { x, y: y + height },
    w: { x, y: y + height / 2 },
  };
}

// Hit test handles
export function hitTestHandles(
  world: Point,
  el: DrawingElement,
  zoom: number
): ResizeHandle | null {
  const handles = getHandles(el);
  if (!handles) return null;
  const handleRadius = 8 / zoom;

  for (const [key, pt] of Object.entries(handles)) {
    if (Math.hypot(world.x - pt.x, world.y - pt.y) <= handleRadius) {
      return key as ResizeHandle;
    }
  }
  return null;
}

// Convert client/screen coordinate to world canvas coordinate
export function screenToWorld(
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement | null,
  pan: Point,
  zoom: number
): Point {
  if (!canvas) return { x: 0, y: 0 };
  const rect = canvas.getBoundingClientRect();
  const screenX = clientX - rect.left;
  const screenY = clientY - rect.top;
  return {
    x: (screenX - pan.x) / zoom,
    y: (screenY - pan.y) / zoom,
  };
}

// Convert world coordinate to screen coordinate
export function worldToScreen(worldX: number, worldY: number, pan: Point, zoom: number): Point {
  return {
    x: worldX * zoom + pan.x,
    y: worldY * zoom + pan.y,
  };
}

export function computeElementsBoundingBox(
  elements: readonly DrawingElement[],
  pad = 0
): Bounds | null {
  if (elements.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const el of elements) {
    const b = getElementBounds(el);
    minX = Math.min(minX, b.minX - pad);
    minY = Math.min(minY, b.minY - pad);
    maxX = Math.max(maxX, b.maxX + pad);
    maxY = Math.max(maxY, b.maxY + pad);
  }

  return { minX, minY, maxX, maxY };
}
