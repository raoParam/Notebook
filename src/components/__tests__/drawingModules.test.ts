import { describe, expect, it } from 'vitest';
import {
  distanceToSegment,
  elementIntersectsBox,
  generateId,
  getElementBounds,
  getHandles,
  hitTestElement,
  hitTestHandles,
  pointInPolygon,
  screenToWorld,
  worldToScreen,
} from '../drawing/geometry';
import type { DrawingElement } from '../drawing/types';

describe('drawing/geometry', () => {
  it('generates unique non-empty IDs', () => {
    const id1 = generateId();
    const id2 = generateId();
    expect(id1).toBeTruthy();
    expect(id2).toBeTruthy();
    expect(id1).not.toBe(id2);
  });

  it('calculates point to segment distance correctly', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 10, y: 0 };
    expect(distanceToSegment({ x: 5, y: 5 }, a, b)).toBe(5);
    expect(distanceToSegment({ x: -2, y: 0 }, a, b)).toBe(2);
    expect(distanceToSegment({ x: 12, y: 0 }, a, b)).toBe(2);
    expect(distanceToSegment({ x: 5, y: 0 }, a, b)).toBe(0);
  });

  it('determines if a point is inside a polygon', () => {
    const triangle = [
      { x: 10, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
    ];
    expect(pointInPolygon({ x: 10, y: 15 }, triangle)).toBe(true);
    expect(pointInPolygon({ x: 10, y: -5 }, triangle)).toBe(false);
    expect(pointInPolygon({ x: 30, y: 30 }, triangle)).toBe(false);
  });

  it('computes tight bounds and box intersection for shapes and freedraw', () => {
    const rect: DrawingElement = {
      id: 'rect-1',
      type: 'rectangle',
      x: 10,
      y: 20,
      width: 50,
      height: 30,
      strokeColor: '#000',
      fillColor: 'transparent',
      fillStyle: 'none',
      strokeWidth: 2,
      strokeStyle: 'solid',
      opacity: 1,
    };
    expect(getElementBounds(rect)).toEqual({
      minX: 10,
      minY: 20,
      maxX: 60,
      maxY: 50,
    });
    expect(elementIntersectsBox(rect, { x: 0, y: 0, width: 25, height: 25 })).toBe(true);
    expect(elementIntersectsBox(rect, { x: 100, y: 100, width: 10, height: 10 })).toBe(false);

    const freedraw: DrawingElement = {
      id: 'free-1',
      type: 'freedraw',
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      points: [
        { x: 5, y: 10 },
        { x: 15, y: 40 },
        { x: 25, y: 5 },
      ],
      strokeColor: '#000',
      fillColor: 'transparent',
      fillStyle: 'none',
      strokeWidth: 2,
      strokeStyle: 'solid',
      opacity: 1,
    };
    expect(getElementBounds(freedraw)).toEqual({
      minX: 5,
      minY: 5,
      maxX: 25,
      maxY: 40,
    });
  });

  it('performs hit testing on shapes, lines, and handles', () => {
    const rect: DrawingElement = {
      id: 'r1',
      type: 'rectangle',
      x: 100,
      y: 100,
      width: 80,
      height: 60,
      strokeColor: '#000',
      fillColor: 'transparent',
      fillStyle: 'none',
      strokeWidth: 2,
      strokeStyle: 'solid',
      opacity: 1,
    };
    expect(hitTestElement({ x: 140, y: 130 }, rect)).toBe(true);
    expect(hitTestElement({ x: 50, y: 50 }, rect)).toBe(false);

    const handles = getHandles(rect);
    expect(handles?.nw).toEqual({ x: 100, y: 100 });
    expect(handles?.se).toEqual({ x: 180, y: 160 });

    expect(hitTestHandles({ x: 100, y: 100 }, rect, 1)).toBe('nw');
    expect(hitTestHandles({ x: 180, y: 160 }, rect, 1)).toBe('se');
    expect(hitTestHandles({ x: 140, y: 130 }, rect, 1)).toBeNull();
  });

  it('converts between screen and world coordinates', () => {
    const pan = { x: 50, y: 100 };
    const zoom = 2;
    const worldPt = { x: 25, y: 30 };

    const screenPt = worldToScreen(worldPt.x, worldPt.y, pan, zoom);
    expect(screenPt).toEqual({ x: 100, y: 160 });

    const mockCanvas = {
      getBoundingClientRect: () => ({ left: 10, top: 20, width: 500, height: 500 }),
    } as unknown as HTMLCanvasElement;

    // clientX = 110 (100 inside canvas), clientY = 180 (160 inside canvas)
    const converted = screenToWorld(110, 180, mockCanvas, pan, zoom);
    expect(converted).toEqual(worldPt);
  });
});
