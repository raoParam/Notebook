'use client';

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

export interface DrawingCanvasProps {
  onInsert: (dataUrl: string) => void;
  onClose: () => void;
}

export type ToolType =
  | 'select'
  | 'freedraw'
  | 'eraser'
  | 'rectangle'
  | 'rounded-rectangle'
  | 'ellipse'
  | 'diamond'
  | 'triangle'
  | 'line'
  | 'arrow'
  | 'text';

export type FillStyle = 'none' | 'semi' | 'solid';
export type StrokeStyle = 'solid' | 'dashed' | 'dotted';

export interface Point {
  x: number;
  y: number;
}

export interface DrawingElement {
  id: string;
  type: ToolType;
  x: number;
  y: number;
  width: number;
  height: number;
  points?: Point[]; // for freedraw, line, arrow
  strokeColor: string;
  fillColor: string;
  fillStyle: FillStyle;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  opacity: number;
  text?: string;
  fontSize?: number;
}

type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'start' | 'end';
type InteractionAction = 'drawing' | 'moving' | 'resizing' | 'panning' | 'marquee' | 'idle';

const STROKE_COLORS = [
  { label: 'Black', value: '#1e1e1e' },
  { label: 'Dark Slate', value: '#495057' },
  { label: 'Red', value: '#e03131' },
  { label: 'Orange', value: '#f76707' },
  { label: 'Yellow', value: '#f59f00' },
  { label: 'Green', value: '#2f9e44' },
  { label: 'Blue', value: '#1971c2' },
  { label: 'Purple', value: '#9c36b5' },
  { label: 'White', value: '#ffffff' },
];

const FILL_COLORS = [
  { label: 'Transparent', value: 'transparent' },
  { label: 'White', value: '#ffffff' },
  { label: 'Soft Gray', value: '#e9ecef' },
  { label: 'Soft Red', value: '#ffc9c9' },
  { label: 'Soft Orange', value: '#ffe8cc' },
  { label: 'Soft Yellow', value: '#ffec99' },
  { label: 'Soft Green', value: '#b2f2bb' },
  { label: 'Soft Blue', value: '#a5d8ff' },
  { label: 'Soft Purple', value: '#eebefa' },
];

const STROKE_WIDTHS = [
  { label: 'Thin', value: 2 },
  { label: 'Medium', value: 4 },
  { label: 'Thick', value: 6 },
  { label: 'Extra', value: 10 },
];

const FONT_SIZES = [
  { label: 'S', value: 16 },
  { label: 'M', value: 22 },
  { label: 'L', value: 30 },
  { label: 'XL', value: 40 },
];

function generateId(): string {
  return Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
}

// Distance from point to line segment
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y)));
}

// Check if point is inside a polygon
function pointInPolygon(p: Point, vs: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i].x, yi = vs[i].y;
    const xj = vs[j].x, yj = vs[j].y;
    const intersect = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Get tight bounding box of an element
function getElementBounds(el: DrawingElement): { minX: number; minY: number; maxX: number; maxY: number } {
  if ((el.type === 'freedraw' || el.type === 'line' || el.type === 'arrow') && el.points && el.points.length > 0) {
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
function elementIntersectsBox(
  el: DrawingElement,
  box: { x: number; y: number; width: number; height: number }
): boolean {
  const b = getElementBounds(el);
  const bx1 = Math.min(box.x, box.x + box.width);
  const bx2 = Math.max(box.x, box.x + box.width);
  const by1 = Math.min(box.y, box.y + box.height);
  const by2 = Math.max(box.y, box.y + box.height);

  return !(b.maxX < bx1 || b.minX > bx2 || b.maxY < by1 || b.minY > by2);
}

export function DrawingCanvas({ onInsert, onClose }: DrawingCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Tools & properties state
  const [tool, setTool] = useState<ToolType>('freedraw');
  const [strokeColor, setStrokeColor] = useState<string>('#1e1e1e');
  const [fillColor, setFillColor] = useState<string>('transparent');
  const [fillStyle, setFillStyle] = useState<FillStyle>('none');
  const [strokeWidth, setStrokeWidth] = useState<number>(2);
  const [strokeStyle, setStrokeStyle] = useState<StrokeStyle>('solid');
  const [opacity, setOpacity] = useState<number>(1);
  const [fontSize, setFontSize] = useState<number>(22);
  const [showPropertyPanel, setShowPropertyPanel] = useState<boolean>(true);

  // Canvas viewport: pan & zoom
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isSpacePressed, setIsSpacePressed] = useState<boolean>(false);
  const isSpacePressedRef = useRef<boolean>(false);
  const panStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Elements & History
  const [elements, setElements] = useState<DrawingElement[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [history, setHistory] = useState<DrawingElement[][]>([[]]);
  const [historyIndex, setHistoryIndex] = useState<number>(0);

  // Interaction State
  const [interactionAction, setInteractionAction] = useState<InteractionAction>('idle');
  const currentActionRef = useRef<InteractionAction>('idle');
  const activeHandleRef = useRef<ResizeHandle | null>(null);
  const dragStartRef = useRef<Point>({ x: 0, y: 0 });
  const marqueeRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);

  // Stores original snapshot of moving elements
  const origElementsBoundsRef = useRef<
    { id: string; x: number; y: number; width: number; height: number; points?: Point[] }[]
  >([]);

  // Current element being created
  const currentElementRef = useRef<DrawingElement | null>(null);

  // Text editor popup state
  const [textEditor, setTextEditor] = useState<{
    x: number;
    y: number;
    worldX: number;
    worldY: number;
    text: string;
    id?: string;
    fontSize: number;
    color: string;
  } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const selectedElements = elements.filter((e) => selectedIds.includes(e.id));
  const primarySelected = selectedElements[0] || null;

  const updateSelection = useCallback(
    (nextIds: string[], sourceElements: DrawingElement[] = elements) => {
      setSelectedIds(nextIds);
      const primary = sourceElements.find((e) => e.id === nextIds[0]);
      if (primary) {
        setStrokeColor(primary.strokeColor);
        setFillColor(primary.fillColor);
        setFillStyle(primary.fillStyle);
        setStrokeWidth(primary.strokeWidth);
        setStrokeStyle(primary.strokeStyle);
        setOpacity(primary.opacity);
        if (primary.fontSize) setFontSize(primary.fontSize);
      }
    },
    [elements]
  );

  const setActiveAction = useCallback((action: InteractionAction) => {
    currentActionRef.current = action;
    setInteractionAction(action);
  }, []);

  // Push new state to history
  const pushHistory = useCallback((newElements: DrawingElement[]) => {
    setHistory((prev) => {
      const nextHistory = prev.slice(0, historyIndex + 1);
      nextHistory.push(newElements);
      if (nextHistory.length > 50) nextHistory.shift();
      return nextHistory;
    });
    setHistoryIndex((prev) => Math.min(prev + 1, 49));
    setElements(newElements);
  }, [historyIndex]);

  const undo = useCallback(() => {
    if (historyIndex > 0) {
      const nextIndex = historyIndex - 1;
      setHistoryIndex(nextIndex);
      setElements(history[nextIndex]);
      setSelectedIds([]);
    }
  }, [history, historyIndex]);

  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const nextIndex = historyIndex + 1;
      setHistoryIndex(nextIndex);
      setElements(history[nextIndex]);
      setSelectedIds([]);
    }
  }, [history, historyIndex]);

  const clearCanvas = useCallback(() => {
    if (elements.length === 0) return;
    if (window.confirm('Clear the entire drawing canvas?')) {
      pushHistory([]);
      setSelectedIds([]);
    }
  }, [elements.length, pushHistory]);

  const deleteSelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    const nextElements = elements.filter((e) => !selectedIds.includes(e.id));
    pushHistory(nextElements);
    setSelectedIds([]);
  }, [selectedIds, elements, pushHistory]);

  const duplicateSelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    const duplicates: DrawingElement[] = [];
    const newSelectedIds: string[] = [];

    elements.forEach((el) => {
      if (selectedIds.includes(el.id)) {
        const newId = generateId();
        newSelectedIds.push(newId);
        duplicates.push({
          ...el,
          id: newId,
          x: el.x + 20,
          y: el.y + 20,
          points: el.points ? el.points.map((p) => ({ x: p.x + 20, y: p.y + 20 })) : undefined,
        });
      }
    });

    const next = [...elements, ...duplicates];
    pushHistory(next);
    updateSelection(newSelectedIds, next);
  }, [selectedIds, elements, pushHistory, updateSelection]);

  // Update selected element property directly
  const updateSelectedProperty = useCallback(
    (patch: Partial<DrawingElement>) => {
      if (selectedIds.length === 0) return;
      const next = elements.map((e) => (selectedIds.includes(e.id) ? { ...e, ...patch } : e));
      pushHistory(next);
    },
    [selectedIds, elements, pushHistory]
  );

  // Convert client/screen coordinate to world canvas coordinate
  const screenToWorld = useCallback(
    (clientX: number, clientY: number): Point => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      const screenX = clientX - rect.left;
      const screenY = clientY - rect.top;
      return {
        x: (screenX - pan.x) / zoom,
        y: (screenY - pan.y) / zoom,
      };
    },
    [pan, zoom]
  );

  // Convert world coordinate to screen coordinate
  const worldToScreen = useCallback(
    (worldX: number, worldY: number): Point => {
      return {
        x: worldX * zoom + pan.x,
        y: worldY * zoom + pan.y,
      };
    },
    [pan, zoom]
  );

  // Hit test an element
  const hitTestElement = useCallback((world: Point, el: DrawingElement): boolean => {
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
      const val = ((world.x - cx) ** 2) / (rx + padding) ** 2 + ((world.y - cy) ** 2) / (ry + padding) ** 2;
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
  }, []);

  // Get resize handles for a single selected element
  const getHandles = useCallback((el: DrawingElement): Partial<Record<ResizeHandle, Point>> | null => {
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
  }, []);

  // Hit test handles
  const hitTestHandles = useCallback(
    (world: Point, el: DrawingElement): ResizeHandle | null => {
      const handles = getHandles(el);
      if (!handles) return null;
      const handleRadius = 8 / zoom;

      for (const [key, pt] of Object.entries(handles)) {
        if (Math.hypot(world.x - pt.x, world.y - pt.y) <= handleRadius) {
          return key as ResizeHandle;
        }
      }
      return null;
    },
    [getHandles, zoom]
  );

  // Render element on Canvas
  const drawElement = useCallback((ctx: CanvasRenderingContext2D, el: DrawingElement) => {
    ctx.save();
    ctx.globalAlpha = el.opacity ?? 1;
    ctx.strokeStyle = el.strokeColor;
    ctx.lineWidth = el.strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (el.strokeStyle === 'dashed') {
      ctx.setLineDash([8, 8]);
    } else if (el.strokeStyle === 'dotted') {
      ctx.setLineDash([3, 6]);
    } else {
      ctx.setLineDash([]);
    }

    const hasFill = el.fillColor !== 'transparent' && el.fillStyle !== 'none';
    if (hasFill) {
      if (el.fillStyle === 'semi') {
        ctx.fillStyle = el.fillColor;
        ctx.globalAlpha = (el.opacity ?? 1) * 0.35;
      } else {
        ctx.fillStyle = el.fillColor;
      }
    }

    if (el.type === 'freedraw') {
      if (el.points && el.points.length > 0) {
        ctx.beginPath();
        ctx.moveTo(el.points[0].x, el.points[0].y);
        for (let i = 1; i < el.points.length; i++) {
          const xc = (el.points[i].x + el.points[i - 1].x) / 2;
          const yc = (el.points[i].y + el.points[i - 1].y) / 2;
          ctx.quadraticCurveTo(el.points[i - 1].x, el.points[i - 1].y, xc, yc);
        }
        ctx.stroke();
      }
    } else if (el.type === 'rectangle') {
      if (hasFill) ctx.fillRect(el.x, el.y, el.width, el.height);
      ctx.globalAlpha = el.opacity ?? 1;
      ctx.strokeRect(el.x, el.y, el.width, el.height);
    } else if (el.type === 'rounded-rectangle') {
      const radius = Math.min(16, Math.abs(el.width) / 4, Math.abs(el.height) / 4);
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(el.x, el.y, el.width, el.height, radius);
      } else {
        ctx.rect(el.x, el.y, el.width, el.height);
      }
      if (hasFill) ctx.fill();
      ctx.globalAlpha = el.opacity ?? 1;
      ctx.stroke();
    } else if (el.type === 'ellipse') {
      const rx = Math.abs(el.width) / 2;
      const ry = Math.abs(el.height) / 2;
      const cx = el.x + el.width / 2;
      const cy = el.y + el.height / 2;
      if (rx > 0 && ry > 0) {
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        if (hasFill) ctx.fill();
        ctx.globalAlpha = el.opacity ?? 1;
        ctx.stroke();
      }
    } else if (el.type === 'diamond') {
      const cx = el.x + el.width / 2;
      const cy = el.y + el.height / 2;
      ctx.beginPath();
      ctx.moveTo(cx, el.y);
      ctx.lineTo(el.x + el.width, cy);
      ctx.lineTo(cx, el.y + el.height);
      ctx.lineTo(el.x, cy);
      ctx.closePath();
      if (hasFill) ctx.fill();
      ctx.globalAlpha = el.opacity ?? 1;
      ctx.stroke();
    } else if (el.type === 'triangle') {
      const cx = el.x + el.width / 2;
      ctx.beginPath();
      ctx.moveTo(cx, el.y);
      ctx.lineTo(el.x + el.width, el.y + el.height);
      ctx.lineTo(el.x, el.y + el.height);
      ctx.closePath();
      if (hasFill) ctx.fill();
      ctx.globalAlpha = el.opacity ?? 1;
      ctx.stroke();
    } else if (el.type === 'line' || el.type === 'arrow') {
      if (el.points && el.points.length >= 2) {
        const [start, end] = el.points;
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();

        if (el.type === 'arrow') {
          const angle = Math.atan2(end.y - start.y, end.x - start.x);
          const headLen = Math.max(12, el.strokeWidth * 3.5);
          ctx.beginPath();
          ctx.moveTo(end.x, end.y);
          ctx.lineTo(end.x - headLen * Math.cos(angle - Math.PI / 6), end.y - headLen * Math.sin(angle - Math.PI / 6));
          ctx.moveTo(end.x, end.y);
          ctx.lineTo(end.x - headLen * Math.cos(angle + Math.PI / 6), end.y - headLen * Math.sin(angle + Math.PI / 6));
          ctx.stroke();
        }
      }
    } else if (el.type === 'text') {
      if (el.text) {
        const fSize = el.fontSize || 22;
        ctx.font = `${fSize}px "Inter", sans-serif`;
        ctx.fillStyle = el.strokeColor;
        ctx.textBaseline = 'top';
        const lines = el.text.split('\n');
        lines.forEach((line, idx) => {
          ctx.fillText(line, el.x, el.y + idx * (fSize * 1.3));
        });
      }
    }

    ctx.restore();
  }, []);

  // Main Render Loop
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Clean canvas background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // Draw Excalidraw-like subtle dot grid
    const gridSize = 24 * zoom;
    const offsetX = pan.x % gridSize;
    const offsetY = pan.y % gridSize;

    ctx.fillStyle = '#e2e8f0';
    const dotRadius = Math.max(0.8, 1.2 * Math.min(1.5, zoom));
    for (let x = offsetX; x < width; x += gridSize) {
      for (let y = offsetY; y < height; y += gridSize) {
        ctx.beginPath();
        ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Apply viewport transform (pan & zoom)
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    // Draw all elements
    elements.forEach((el) => {
      if (textEditor && textEditor.id === el.id) return;
      drawElement(ctx, el);
    });

    // Draw element currently being drawn
    if (currentElementRef.current) {
      drawElement(ctx, currentElementRef.current);
    }

    // Draw Marquee selection box
    if (marqueeRef.current) {
      const { x, y, width: mw, height: mh } = marqueeRef.current;
      ctx.save();
      ctx.fillStyle = 'rgba(59, 130, 246, 0.12)';
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 1.2 / zoom;
      ctx.setLineDash([4 / zoom, 4 / zoom]);
      ctx.fillRect(x, y, mw, mh);
      ctx.strokeRect(x, y, mw, mh);
      ctx.restore();
    }

    // Draw Selection Bounding Box & Handles for all selected elements
    if (selectedElements.length > 0 && (!textEditor || !selectedIds.includes(textEditor.id || ''))) {
      ctx.save();
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 1.5 / zoom;
      ctx.setLineDash([4 / zoom, 4 / zoom]);

      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;

      selectedElements.forEach((el) => {
        const b = getElementBounds(el);
        minX = Math.min(minX, b.minX);
        minY = Math.min(minY, b.minY);
        maxX = Math.max(maxX, b.maxX);
        maxY = Math.max(maxY, b.maxY);
      });

      const selW = maxX - minX;
      const selH = maxY - minY;
      const pad = 6 / zoom;

      // Draw dashed selection outline
      ctx.strokeRect(minX - pad, minY - pad, selW + pad * 2, selH + pad * 2);

      // If exactly one element is selected, draw individual resize handles
      if (selectedElements.length === 1) {
        const el = selectedElements[0];
        const handles = getHandles({ ...el, x: minX, y: minY, width: selW, height: selH });
        if (handles) {
          ctx.setLineDash([]);
          const handleSize = 7 / zoom;
          for (const pt of Object.values(handles)) {
            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = '#2563eb';
            ctx.lineWidth = 1.5 / zoom;
            ctx.beginPath();
            ctx.rect(pt.x - handleSize / 2, pt.y - handleSize / 2, handleSize, handleSize);
            ctx.fill();
            ctx.stroke();
          }
        }
      }

      ctx.restore();
    }

    ctx.restore();
  }, [elements, pan, zoom, selectedElements, selectedIds, textEditor, drawElement, getHandles]);

  // Resize canvas on mount/resize
  const handleResize = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    render();
  }, [render]);

  useEffect(() => {
    handleResize();
    const ro = new ResizeObserver(handleResize);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [handleResize]);

  useEffect(() => {
    render();
  }, [render]);

  // Commit inline text element
  const commitText = useCallback(() => {
    if (!textEditor) return;
    const trimmed = textEditor.text.trim();
    if (trimmed) {
      const fSize = textEditor.fontSize;
      const lines = trimmed.split('\n');
      const maxLineLen = Math.max(...lines.map((l) => l.length));
      const width = Math.max(40, maxLineLen * (fSize * 0.6));
      const height = lines.length * (fSize * 1.3);

      if (textEditor.id) {
        // Update existing text
        const next = elements.map((el) =>
          el.id === textEditor.id
            ? { ...el, text: trimmed, width, height, strokeColor: textEditor.color, fontSize: fSize }
            : el
        );
        pushHistory(next);
      } else {
        // Create new text element
        const newEl: DrawingElement = {
          id: generateId(),
          type: 'text',
          x: textEditor.worldX,
          y: textEditor.worldY,
          width,
          height,
          strokeColor: textEditor.color,
          fillColor: 'transparent',
          fillStyle: 'none',
          strokeWidth: 2,
          strokeStyle: 'solid',
          opacity: 1,
          text: trimmed,
          fontSize: fSize,
        };
        const next = [...elements, newEl];
        pushHistory(next);
        updateSelection([newEl.id], next);
      }
    } else if (textEditor.id) {
      // Removed text
      const next = elements.filter((el) => el.id !== textEditor.id);
      pushHistory(next);
    }
    setTextEditor(null);
  }, [textEditor, elements, pushHistory, updateSelection]);

  // Keyboard Shortcuts Handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore shortcut when editing text inside textarea
      if (textEditor) {
        if (e.key === 'Escape') {
          commitText();
        }
        return;
      }

      // Space for panning
      if (e.code === 'Space' && !e.repeat) {
        isSpacePressedRef.current = true;
        setIsSpacePressed(true);
      }

      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }

      if (ctrl && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }

      if (ctrl && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicateSelected();
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedIds.length > 0) {
          e.preventDefault();
          deleteSelected();
        }
        return;
      }

      if (e.key === 'Escape') {
        if (selectedIds.length > 0) {
          setSelectedIds([]);
        } else {
          setTool('select');
        }
        return;
      }

      // Tool shortcut keys
      if (!ctrl && !e.altKey && !e.shiftKey) {
        switch (e.key.toLowerCase()) {
          case 'v':
          case '1':
            setTool('select');
            break;
          case 'p':
          case '2':
            setTool('freedraw');
            break;
          case 'e':
          case '3':
            setTool('eraser');
            break;
          case 'r':
          case '4':
            setTool('rectangle');
            break;
          case 'o':
          case '5':
            setTool('ellipse');
            break;
          case 'd':
          case '6':
            setTool('diamond');
            break;
          case 'l':
          case '7':
            setTool('line');
            break;
          case 'a':
          case '8':
            setTool('arrow');
            break;
          case 't':
          case '9':
            setTool('text');
            break;
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        isSpacePressedRef.current = false;
        setIsSpacePressed(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [selectedIds, textEditor, undo, redo, deleteSelected, duplicateSelected, commitText]);

  // Pointer Down Handler
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (textEditor) {
        commitText();
      }

      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      const world = screenToWorld(e.clientX, e.clientY);
      dragStartRef.current = world;

      // Spacebar or Middle Click -> Pan
      if (isSpacePressedRef.current || e.button === 1) {
        panStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
        setActiveAction('panning');
        return;
      }

      // Eraser Mode: Erase clicked element or start drag erasing
      if (tool === 'eraser') {
        setActiveAction('drawing');
        const hit = [...elements].reverse().find((el) => hitTestElement(world, el));
        if (hit) {
          const next = elements.filter((el) => el.id !== hit.id);
          pushHistory(next);
          setSelectedIds((prev) => prev.filter((id) => id !== hit.id));
        }
        return;
      }

      // Select Mode: Check handle click first, then element click, else start Area/Marquee selection
      if (tool === 'select') {
        // Check single element resize handles
        if (selectedElements.length === 1) {
          const singleEl = selectedElements[0];
          const handle = hitTestHandles(world, singleEl);
          if (handle) {
            activeHandleRef.current = handle;
            origElementsBoundsRef.current = [
              {
                id: singleEl.id,
                x: singleEl.x,
                y: singleEl.y,
                width: singleEl.width,
                height: singleEl.height,
                points: singleEl.points ? [...singleEl.points] : undefined,
              },
            ];
            setActiveAction('resizing');
            return;
          }
        }

        // Check if clicked directly on an existing element
        const hit = [...elements].reverse().find((el) => hitTestElement(world, el));

        if (hit) {
          let nextSelectedIds = [...selectedIds];
          if (e.shiftKey) {
            // Shift click toggles selection
            if (nextSelectedIds.includes(hit.id)) {
              nextSelectedIds = nextSelectedIds.filter((id) => id !== hit.id);
            } else {
              nextSelectedIds.push(hit.id);
            }
          } else if (!selectedIds.includes(hit.id)) {
            // New single selection
            nextSelectedIds = [hit.id];
          }

          updateSelection(nextSelectedIds);
          setActiveAction('moving');

          // Snapshot all currently selected elements for group drag
          const targets = elements.filter((el) => nextSelectedIds.includes(el.id));
          origElementsBoundsRef.current = targets.map((el) => ({
            id: el.id,
            x: el.x,
            y: el.y,
            width: el.width,
            height: el.height,
            points: el.points ? el.points.map((p) => ({ ...p })) : undefined,
          }));
        } else {
          // Clicked empty canvas -> Start Marquee Area Selection!
          if (!e.shiftKey) {
            setSelectedIds([]);
          }
          marqueeRef.current = { x: world.x, y: world.y, width: 0, height: 0 };
          setActiveAction('marquee');
          render();
        }
        return;
      }

      // Text Tool: Open inline text editor
      if (tool === 'text') {
        const screenPt = worldToScreen(world.x, world.y);
        setTextEditor({
          x: screenPt.x,
          y: screenPt.y,
          worldX: world.x,
          worldY: world.y,
          text: '',
          fontSize,
          color: strokeColor,
        });
        setTimeout(() => textareaRef.current?.focus(), 50);
        return;
      }

      // Shape or Freehand Drawing Creation
      setActiveAction('drawing');

      const baseElement: DrawingElement = {
        id: generateId(),
        type: tool,
        x: world.x,
        y: world.y,
        width: 0,
        height: 0,
        strokeColor,
        fillColor,
        fillStyle,
        strokeWidth,
        strokeStyle,
        opacity,
        fontSize,
      };

      if (tool === 'freedraw') {
        baseElement.points = [world];
      } else if (tool === 'line' || tool === 'arrow') {
        baseElement.points = [world, world];
      }

      currentElementRef.current = baseElement;
      render();
    },
    [
      tool,
      selectedElements,
      selectedIds,
      elements,
      strokeColor,
      fillColor,
      fillStyle,
      strokeWidth,
      strokeStyle,
      opacity,
      fontSize,
      pan,
      textEditor,
      screenToWorld,
      worldToScreen,
      hitTestElement,
      hitTestHandles,
      pushHistory,
      commitText,
      render,
      setActiveAction,
      updateSelection,
    ]
  );

  // Pointer Move Handler
  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const world = screenToWorld(e.clientX, e.clientY);

      // Panning
      if (currentActionRef.current === 'panning') {
        setPan({
          x: e.clientX - panStartRef.current.x,
          y: e.clientY - panStartRef.current.y,
        });
        return;
      }

      // Marquee Area Selection Drag
      if (currentActionRef.current === 'marquee') {
        const mx = Math.min(dragStartRef.current.x, world.x);
        const my = Math.min(dragStartRef.current.y, world.y);
        const mw = Math.abs(world.x - dragStartRef.current.x);
        const mh = Math.abs(world.y - dragStartRef.current.y);

        marqueeRef.current = { x: mx, y: my, width: mw, height: mh };

        // Real-time highlight intersecting elements
        const enclosed = elements.filter((el) => elementIntersectsBox(el, { x: mx, y: my, width: mw, height: mh }));
        updateSelection(enclosed.map((el) => el.id));
        render();
        return;
      }

      // Eraser Drag
      if (tool === 'eraser' && currentActionRef.current === 'drawing') {
        const hit = [...elements].reverse().find((el) => hitTestElement(world, el));
        if (hit) {
          const next = elements.filter((el) => el.id !== hit.id);
          pushHistory(next);
          setSelectedIds((prev) => prev.filter((id) => id !== hit.id));
        }
        return;
      }

      // Moving Selected Elements as a Group
      if (currentActionRef.current === 'moving' && selectedIds.length > 0) {
        const dx = world.x - dragStartRef.current.x;
        const dy = world.y - dragStartRef.current.y;
        const origMap = new Map(origElementsBoundsRef.current.map((item) => [item.id, item]));

        setElements((prev) =>
          prev.map((el) => {
            const orig = origMap.get(el.id);
            if (!orig) return el;

            if (el.type === 'freedraw') {
              const pts = orig.points ? orig.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) : undefined;
              return { ...el, x: orig.x + dx, y: orig.y + dy, points: pts };
            }
            if (el.type === 'line' || el.type === 'arrow') {
              const pts = orig.points ? orig.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) : undefined;
              return { ...el, points: pts };
            }
            return { ...el, x: orig.x + dx, y: orig.y + dy };
          })
        );
        return;
      }

      // Resizing Element (for single element)
      if (currentActionRef.current === 'resizing' && selectedElements.length === 1 && activeHandleRef.current) {
        const handle = activeHandleRef.current;
        const orig = origElementsBoundsRef.current[0];
        if (!orig) return;

        const dx = world.x - dragStartRef.current.x;
        const dy = world.y - dragStartRef.current.y;

        setElements((prev) =>
          prev.map((el) => {
            if (el.id !== orig.id) return el;

            if (el.type === 'line' || el.type === 'arrow') {
              if (!orig.points) return el;
              const newPts = [...orig.points];
              if (handle === 'start') newPts[0] = world;
              if (handle === 'end') newPts[1] = world;
              return { ...el, points: newPts };
            }

            let newX = orig.x;
            let newY = orig.y;
            let newW = orig.width;
            let newH = orig.height;

            if (handle.includes('e')) newW = orig.width + dx;
            if (handle.includes('s')) newH = orig.height + dy;
            if (handle.includes('w')) {
              newX = orig.x + dx;
              newW = orig.width - dx;
            }
            if (handle.includes('n')) {
              newY = orig.y + dy;
              newH = orig.height - dy;
            }

            return {
              ...el,
              x: newX,
              y: newY,
              width: newW,
              height: newH,
            };
          })
        );
        return;
      }

      // Creating new element on drag
      if (currentActionRef.current === 'drawing' && currentElementRef.current) {
        const cur = currentElementRef.current;
        if (cur.type === 'freedraw') {
          cur.points = [...(cur.points || []), world];
        } else if (cur.type === 'line' || cur.type === 'arrow') {
          if (cur.points) cur.points[1] = world;
        } else {
          cur.x = Math.min(dragStartRef.current.x, world.x);
          cur.y = Math.min(dragStartRef.current.y, world.y);
          cur.width = Math.abs(world.x - dragStartRef.current.x);
          cur.height = Math.abs(world.y - dragStartRef.current.y);
        }
        render();
      }
    },
    [tool, selectedIds, selectedElements, elements, screenToWorld, hitTestElement, pushHistory, render, updateSelection]
  );

  // Pointer Up Handler
  const handlePointerUp = useCallback(() => {
    if (currentActionRef.current === 'marquee') {
      marqueeRef.current = null;
      render();
    } else if (currentActionRef.current === 'drawing' && currentElementRef.current) {
      const created = currentElementRef.current;
      currentElementRef.current = null;

      // Ensure minimum size for shapes
      const isValid =
        created.type === 'freedraw'
          ? (created.points?.length || 0) > 1
          : created.type === 'line' || created.type === 'arrow'
          ? Math.hypot((created.points?.[1]?.x || 0) - (created.points?.[0]?.x || 0), (created.points?.[1]?.y || 0) - (created.points?.[0]?.y || 0)) > 5
          : created.width > 5 || created.height > 5;

      if (isValid) {
        const next = [...elements, created];
        pushHistory(next);
      } else {
        render();
      }
    } else if (currentActionRef.current === 'moving' || currentActionRef.current === 'resizing') {
      pushHistory(elements);
    }

    activeHandleRef.current = null;
    setActiveAction('idle');
  }, [elements, pushHistory, render, setActiveAction]);

  // Double Click Handler (for editing existing text element)
  const handleDoubleClick = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const world = screenToWorld(e.clientX, e.clientY);
      const hit = [...elements].reverse().find((el) => el.type === 'text' && hitTestElement(world, el));
      if (hit && hit.text) {
        const screenPt = worldToScreen(hit.x, hit.y);
        setTextEditor({
          x: screenPt.x,
          y: screenPt.y,
          worldX: hit.x,
          worldY: hit.y,
          text: hit.text,
          id: hit.id,
          fontSize: hit.fontSize || 22,
          color: hit.strokeColor,
        });
        setTimeout(() => textareaRef.current?.focus(), 50);
      }
    },
    [elements, screenToWorld, worldToScreen, hitTestElement]
  );

  // Zoom Handling
  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
        const newZoom = Math.min(3, Math.max(0.2, zoom * zoomFactor));

        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        setPan({
          x: mouseX - (mouseX - pan.x) * (newZoom / zoom),
          y: mouseY - (mouseY - pan.y) * (newZoom / zoom),
        });
        setZoom(newZoom);
      } else {
        setPan((prev) => ({
          x: prev.x - e.deltaX,
          y: prev.y - e.deltaY,
        }));
      }
    },
    [zoom, pan]
  );

  const resetZoom = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const fitToScreen = useCallback(() => {
    if (elements.length === 0) {
      resetZoom();
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    elements.forEach((el) => {
      const b = getElementBounds(el);
      minX = Math.min(minX, b.minX);
      minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX);
      maxY = Math.max(maxY, b.maxY);
    });

    const pad = 60;
    const boundingW = maxX - minX + pad * 2;
    const boundingH = maxY - minY + pad * 2;

    const dpr = window.devicePixelRatio || 1;
    const viewW = canvas.width / dpr;
    const viewH = canvas.height / dpr;

    const fitZoom = Math.min(1.5, Math.max(0.3, Math.min(viewW / boundingW, viewH / boundingH)));
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    setZoom(fitZoom);
    setPan({
      x: viewW / 2 - centerX * fitZoom,
      y: viewH / 2 - centerY * fitZoom,
    });
  }, [elements, resetZoom]);

  // Insert Drawing into notebook
  const handleInsertDrawing = useCallback(() => {
    if (elements.length === 0) {
      alert('Please draw something on the canvas before inserting.');
      return;
    }

    // Calculate bounding box of all elements
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    elements.forEach((el) => {
      const pad = el.strokeWidth || 4;
      const b = getElementBounds(el);
      minX = Math.min(minX, b.minX - pad);
      minY = Math.min(minY, b.minY - pad);
      maxX = Math.max(maxX, b.maxX + pad);
      maxY = Math.max(maxY, b.maxY + pad);
    });

    const padding = 28;
    const exportWidth = Math.max(120, Math.ceil(maxX - minX + padding * 2));
    const exportHeight = Math.max(80, Math.ceil(maxY - minY + padding * 2));

    const exportCanvas = document.createElement('canvas');
    const scale = 2; // high-resolution 2x export
    exportCanvas.width = exportWidth * scale;
    exportCanvas.height = exportHeight * scale;

    const ctx = exportCanvas.getContext('2d');
    if (!ctx) return;

    ctx.scale(scale, scale);

    // Clean background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, exportWidth, exportHeight);

    // Offset elements to fit export canvas
    ctx.translate(padding - minX, padding - minY);

    elements.forEach((el) => {
      drawElement(ctx, el);
    });

    const dataUrl = exportCanvas.toDataURL('image/png', 0.95);
    onInsert(dataUrl);
  }, [elements, drawElement, onInsert]);

  const cursor =
    isSpacePressed || interactionAction === 'panning'
      ? 'grab'
      : tool === 'select'
      ? interactionAction === 'moving'
        ? 'move'
        : interactionAction === 'resizing' || interactionAction === 'marquee'
        ? 'crosshair'
        : 'default'
      : tool === 'eraser'
      ? 'cell'
      : tool === 'text'
      ? 'text'
      : 'crosshair';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(8px)',
        padding: '12px',
        animation: 'modalIn 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Centered Modal Card */}
      <div
        style={{
          width: 'min(95vw, 1160px)',
          height: 'min(90vh, 790px)',
          minHeight: '520px',
          background: 'var(--bg-paper)',
          border: '1px solid var(--border)',
          borderRadius: '16px',
          boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.38), 0 0 0 1px rgba(255,255,255,0.05)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          position: 'relative',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Top Header Bar */}
        <div
          style={{
            height: 54,
            padding: '0 16px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg-sidebar)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexShrink: 0,
            userSelect: 'none',
          }}
        >
          {/* Left Title & Undo/Redo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 7,
                  background: 'var(--accent)',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 19l7-7 3 3-7 7-3-3z" />
                  <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
                  <path d="M2 2l7.586 7.586" />
                  <circle cx="11" cy="11" r="2" />
                </svg>
              </div>
              <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--ink)', letterSpacing: '-0.01em' }}>
                Drawing Studio
              </span>
            </div>

            <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }} />

            {/* Undo / Redo */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <button
                onClick={undo}
                disabled={historyIndex <= 0}
                title="Undo (Ctrl+Z)"
                style={{
                  padding: '5px 8px',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--bg-paper)',
                  color: historyIndex <= 0 ? 'var(--ink-muted)' : 'var(--ink)',
                  cursor: historyIndex <= 0 ? 'not-allowed' : 'pointer',
                  opacity: historyIndex <= 0 ? 0.5 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 12,
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 7v6h6" />
                  <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
                </svg>
              </button>

              <button
                onClick={redo}
                disabled={historyIndex >= history.length - 1}
                title="Redo (Ctrl+Y)"
                style={{
                  padding: '5px 8px',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--bg-paper)',
                  color: historyIndex >= history.length - 1 ? 'var(--ink-muted)' : 'var(--ink)',
                  cursor: historyIndex >= history.length - 1 ? 'not-allowed' : 'pointer',
                  opacity: historyIndex >= history.length - 1 ? 0.5 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 12,
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 7v6h-6" />
                  <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7" />
                </svg>
              </button>

              <button
                onClick={clearCanvas}
                disabled={elements.length === 0}
                title="Clear Canvas"
                style={{
                  padding: '5px 9px',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--bg-paper)',
                  color: 'var(--danger)',
                  cursor: elements.length === 0 ? 'not-allowed' : 'pointer',
                  opacity: elements.length === 0 ? 0.5 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 12,
                  fontWeight: 500,
                  marginLeft: 4,
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                  <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
                Clear
              </button>
            </div>
          </div>

          {/* Center Zoom Controls */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              background: 'var(--bg-paper)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '2px 4px',
              gap: 2,
            }}
          >
            <button
              onClick={() => setZoom((z) => Math.max(0.2, z - 0.1))}
              title="Zoom out"
              style={{
                padding: '3px 7px',
                border: 'none',
                background: 'transparent',
                color: 'var(--ink)',
                cursor: 'pointer',
                borderRadius: 4,
                fontSize: 14,
                fontWeight: 'bold',
              }}
            >
              −
            </button>
            <span
              onClick={resetZoom}
              title="Click to reset zoom (100%)"
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--ink-soft)',
                padding: '0 6px',
                minWidth: 46,
                textAlign: 'center',
                cursor: 'pointer',
              }}
            >
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => setZoom((z) => Math.min(3, z + 0.1))}
              title="Zoom in"
              style={{
                padding: '3px 7px',
                border: 'none',
                background: 'transparent',
                color: 'var(--ink)',
                cursor: 'pointer',
                borderRadius: 4,
                fontSize: 14,
                fontWeight: 'bold',
              }}
            >
              +
            </button>
            <button
              onClick={fitToScreen}
              title="Fit to elements"
              style={{
                padding: '3px 6px',
                border: 'none',
                background: 'transparent',
                color: 'var(--ink-muted)',
                cursor: 'pointer',
                borderRadius: 4,
                fontSize: 11,
                fontWeight: 500,
                marginLeft: 2,
              }}
            >
              Fit
            </button>
          </div>

          {/* Right Action Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={() => setShowPropertyPanel((p) => !p)}
              title="Toggle styling panel"
              style={{
                padding: '6px 10px',
                borderRadius: 7,
                border: '1px solid var(--border)',
                background: showPropertyPanel ? 'var(--hover)' : 'var(--bg-paper)',
                color: 'var(--ink)',
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              Styles
            </button>

            <button
              onClick={onClose}
              style={{
                padding: '6px 12px',
                borderRadius: 7,
                border: '1px solid var(--border)',
                background: 'var(--bg-paper)',
                color: 'var(--ink-soft)',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.12s',
              }}
            >
              Cancel
            </button>

            <button
              onClick={handleInsertDrawing}
              style={{
                padding: '6px 15px',
                borderRadius: 7,
                border: '1px solid var(--gold)',
                background: 'var(--gold)',
                color: '#ffffff',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                boxShadow: '0 2px 8px rgba(173, 138, 78, 0.3)',
                transition: 'all 0.15s',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14" />
                <path d="M12 5l7 7-7 7" />
              </svg>
              Insert Drawing
            </button>

            <button
              onClick={onClose}
              title="Close (Esc)"
              style={{
                width: 32,
                height: 32,
                borderRadius: 7,
                border: 'none',
                background: 'transparent',
                color: 'var(--ink-muted)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 16,
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Modal Main Body (Canvas + Floating Tools + Inspector) */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex' }}>
          {/* Floating Excalidraw-style Main Tool Palette */}
          <div
            style={{
              position: 'absolute',
              top: 14,
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 30,
              background: 'var(--bg-paper)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              boxShadow: '0 8px 24px -4px rgba(0, 0, 0, 0.18)',
              userSelect: 'none',
            }}
          >
            {/* Tool items */}
            {[
              {
                id: 'select',
                label: 'Select / Area Marquee (V)',
                icon: (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 3l7 18 3-7 7-3L3 3z" />
                  </svg>
                ),
              },
              {
                id: 'freedraw',
                label: 'Freehand Pen (P)',
                icon: (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                  </svg>
                ),
              },
              {
                id: 'eraser',
                label: 'Eraser (E)',
                icon: (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 21H8" />
                    <path d="M5.5 16.5 3 14l9-9a2.121 2.121 0 0 1 3 0l4 4a2.121 2.121 0 0 1 0 3l-7.5 7.5" />
                  </svg>
                ),
              },
              {
                id: 'rectangle',
                label: 'Rectangle (R)',
                icon: (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="1" />
                  </svg>
                ),
              },
              {
                id: 'rounded-rectangle',
                label: 'Rounded Rectangle',
                icon: (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="5" />
                  </svg>
                ),
              },
              {
                id: 'ellipse',
                label: 'Circle / Ellipse (O)',
                icon: (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="9" />
                  </svg>
                ),
              },
              {
                id: 'diamond',
                label: 'Diamond (D)',
                icon: (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2l10 10-10 10L2 12 12 2z" />
                  </svg>
                ),
              },
              {
                id: 'triangle',
                label: 'Triangle',
                icon: (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 3l10 18H2L12 3z" />
                  </svg>
                ),
              },
              {
                id: 'line',
                label: 'Line (L)',
                icon: (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="4" y1="20" x2="20" y2="4" />
                  </svg>
                ),
              },
              {
                id: 'arrow',
                label: 'Arrow (A)',
                icon: (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="5" y1="19" x2="19" y2="5" />
                    <polyline points="10 5 19 5 19 14" />
                  </svg>
                ),
              },
              {
                id: 'text',
                label: 'Text (T)',
                icon: (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="4 7 4 4 20 4 20 7" />
                    <line x1="9" y1="20" x2="15" y2="20" />
                    <line x1="12" y1="4" x2="12" y2="20" />
                  </svg>
                ),
              },
            ].map((item) => {
              const active = tool === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setTool(item.id as ToolType);
                    if (item.id !== 'select') setSelectedIds([]);
                  }}
                  title={item.label}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    border: 'none',
                    background: active ? 'var(--accent)' : 'transparent',
                    color: active ? '#ffffff' : 'var(--ink)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.12s ease',
                  }}
                >
                  {item.icon}
                </button>
              );
            })}
          </div>

          {/* Left Contextual Property / Style Inspector */}
          {showPropertyPanel && (
            <div
              style={{
                position: 'absolute',
                top: 14,
                left: 14,
                zIndex: 25,
                width: 230,
                maxHeight: 'calc(100% - 28px)',
                overflowY: 'auto',
                background: 'var(--bg-paper)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                padding: '14px',
                boxShadow: '0 8px 24px -4px rgba(0, 0, 0, 0.14)',
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
                userSelect: 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--ink-muted)' }}>
                  {selectedIds.length > 1
                    ? `${selectedIds.length} Selected`
                    : primarySelected
                    ? 'Element Properties'
                    : 'Tool Defaults'}
                </span>
                {primarySelected && (
                  <span style={{ fontSize: 11, background: 'var(--hover)', padding: '2px 6px', borderRadius: 4, color: 'var(--ink-soft)' }}>
                    {selectedIds.length > 1 ? 'Multiple' : primarySelected.type}
                  </span>
                )}
              </div>

              {/* Stroke Color */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)', marginBottom: 6, display: 'block' }}>
                  Stroke Color
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                  {STROKE_COLORS.map((c) => (
                    <button
                      key={c.value}
                      onClick={() => {
                        setStrokeColor(c.value);
                        if (selectedIds.length > 0) updateSelectedProperty({ strokeColor: c.value });
                      }}
                      title={c.label}
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 5,
                        background: c.value,
                        border: strokeColor === c.value ? '2px solid var(--accent)' : '1px solid var(--border)',
                        boxShadow: strokeColor === c.value ? '0 0 0 2px rgba(59, 130, 246, 0.3)' : 'none',
                        cursor: 'pointer',
                      }}
                    />
                  ))}
                  {/* Custom color picker */}
                  <label
                    title="Custom color"
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 5,
                      border: '1px dashed var(--border)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      fontSize: 10,
                      color: 'var(--ink-muted)',
                      position: 'relative',
                    }}
                  >
                    +
                    <input
                      type="color"
                      value={strokeColor}
                      onChange={(e) => {
                        setStrokeColor(e.target.value);
                        if (selectedIds.length > 0) updateSelectedProperty({ strokeColor: e.target.value });
                      }}
                      style={{ position: 'absolute', opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }}
                    />
                  </label>
                </div>
              </div>

              {/* Background / Fill Color (for shapes) */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)', marginBottom: 6, display: 'block' }}>
                  Fill Background
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                  {FILL_COLORS.map((c) => (
                    <button
                      key={c.value}
                      onClick={() => {
                        setFillColor(c.value);
                        const newStyle = c.value === 'transparent' ? 'none' : fillStyle === 'none' ? 'semi' : fillStyle;
                        setFillStyle(newStyle);
                        if (selectedIds.length > 0) updateSelectedProperty({ fillColor: c.value, fillStyle: newStyle });
                      }}
                      title={c.label}
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 5,
                        background: c.value === 'transparent' ? 'linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)' : c.value,
                        backgroundSize: '8px 8px',
                        border: fillColor === c.value ? '2px solid var(--accent)' : '1px solid var(--border)',
                        boxShadow: fillColor === c.value ? '0 0 0 2px rgba(59, 130, 246, 0.3)' : 'none',
                        cursor: 'pointer',
                      }}
                    />
                  ))}
                  <label
                    title="Custom fill color"
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 5,
                      border: '1px dashed var(--border)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      fontSize: 10,
                      color: 'var(--ink-muted)',
                      position: 'relative',
                    }}
                  >
                    +
                    <input
                      type="color"
                      value={fillColor === 'transparent' ? '#ffffff' : fillColor}
                      onChange={(e) => {
                        setFillColor(e.target.value);
                        const newStyle = fillStyle === 'none' ? 'solid' : fillStyle;
                        setFillStyle(newStyle);
                        if (selectedIds.length > 0) updateSelectedProperty({ fillColor: e.target.value, fillStyle: newStyle });
                      }}
                      style={{ position: 'absolute', opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }}
                    />
                  </label>
                </div>
              </div>

              {/* Fill Style (Solid / Semi / None) */}
              {fillColor !== 'transparent' && (
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)', marginBottom: 5, display: 'block' }}>
                    Fill Style
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
                    {(['none', 'semi', 'solid'] as FillStyle[]).map((st) => (
                      <button
                        key={st}
                        onClick={() => {
                          setFillStyle(st);
                          if (selectedIds.length > 0) updateSelectedProperty({ fillStyle: st });
                        }}
                        style={{
                          padding: '4px',
                          fontSize: 11,
                          fontWeight: 500,
                          borderRadius: 6,
                          border: `1px solid ${fillStyle === st ? 'var(--accent)' : 'var(--border)'}`,
                          background: fillStyle === st ? 'var(--accent)' : 'var(--bg-paper)',
                          color: fillStyle === st ? '#fff' : 'var(--ink)',
                          cursor: 'pointer',
                          textTransform: 'capitalize',
                        }}
                      >
                        {st}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Stroke Width */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)', marginBottom: 5, display: 'block' }}>
                  Stroke Width
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
                  {STROKE_WIDTHS.map((sw) => (
                    <button
                      key={sw.value}
                      onClick={() => {
                        setStrokeWidth(sw.value);
                        if (selectedIds.length > 0) updateSelectedProperty({ strokeWidth: sw.value });
                      }}
                      style={{
                        padding: '4px',
                        fontSize: 11,
                        fontWeight: 500,
                        borderRadius: 6,
                        border: `1px solid ${strokeWidth === sw.value ? 'var(--accent)' : 'var(--border)'}`,
                        background: strokeWidth === sw.value ? 'var(--accent)' : 'var(--bg-paper)',
                        color: strokeWidth === sw.value ? '#fff' : 'var(--ink)',
                        cursor: 'pointer',
                      }}
                    >
                      {sw.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Stroke Style */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)', marginBottom: 5, display: 'block' }}>
                  Stroke Style
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
                  {(['solid', 'dashed', 'dotted'] as StrokeStyle[]).map((st) => (
                    <button
                      key={st}
                      onClick={() => {
                        setStrokeStyle(st);
                        if (selectedIds.length > 0) updateSelectedProperty({ strokeStyle: st });
                      }}
                      style={{
                        padding: '4px',
                        fontSize: 11,
                        fontWeight: 500,
                        borderRadius: 6,
                        border: `1px solid ${strokeStyle === st ? 'var(--accent)' : 'var(--border)'}`,
                        background: strokeStyle === st ? 'var(--accent)' : 'var(--bg-paper)',
                        color: strokeStyle === st ? '#fff' : 'var(--ink)',
                        cursor: 'pointer',
                        textTransform: 'capitalize',
                      }}
                    >
                      {st}
                    </button>
                  ))}
                </div>
              </div>

              {/* Font Size (for Text) */}
              {(tool === 'text' || (primarySelected && primarySelected.type === 'text')) && (
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)', marginBottom: 5, display: 'block' }}>
                    Font Size
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
                    {FONT_SIZES.map((fs) => (
                      <button
                        key={fs.value}
                        onClick={() => {
                          setFontSize(fs.value);
                          if (selectedIds.length > 0) updateSelectedProperty({ fontSize: fs.value });
                        }}
                        style={{
                          padding: '4px',
                          fontSize: 11,
                          fontWeight: 500,
                          borderRadius: 6,
                          border: `1px solid ${fontSize === fs.value ? 'var(--accent)' : 'var(--border)'}`,
                          background: fontSize === fs.value ? 'var(--accent)' : 'var(--bg-paper)',
                          color: fontSize === fs.value ? '#fff' : 'var(--ink)',
                          cursor: 'pointer',
                        }}
                      >
                        {fs.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Opacity */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)' }}>Opacity</label>
                  <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{Math.round(opacity * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="1"
                  step="0.05"
                  value={opacity}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setOpacity(val);
                    if (selectedIds.length > 0) updateSelectedProperty({ opacity: val });
                  }}
                  style={{ width: '100%', cursor: 'pointer' }}
                />
              </div>

              {/* Actions for Selected Elements */}
              {selectedIds.length > 0 && (
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, display: 'flex', gap: 6 }}>
                  <button
                    onClick={duplicateSelected}
                    style={{
                      flex: 1,
                      padding: '5px',
                      borderRadius: 6,
                      border: '1px solid var(--border)',
                      background: 'var(--bg-paper)',
                      color: 'var(--ink)',
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: 'pointer',
                    }}
                  >
                    Duplicate
                  </button>
                  <button
                    onClick={deleteSelected}
                    style={{
                      flex: 1,
                      padding: '5px',
                      borderRadius: 6,
                      border: '1px solid var(--danger)',
                      background: 'var(--bg-paper)',
                      color: 'var(--danger)',
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: 'pointer',
                    }}
                  >
                    Delete ({selectedIds.length})
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Drawing Canvas Area */}
          <div
            ref={containerRef}
            style={{
              flex: 1,
              width: '100%',
              height: '100%',
              position: 'relative',
              touchAction: 'none',
              background: '#ffffff',
            }}
          >
            <canvas
              ref={canvasRef}
              style={{
                display: 'block',
                width: '100%',
                height: '100%',
                cursor,
                touchAction: 'none',
              }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onDoubleClick={handleDoubleClick}
              onWheel={handleWheel}
            />

            {/* Inline Textarea Overlay when typing text */}
            {textEditor && (
              <textarea
                ref={textareaRef}
                value={textEditor.text}
                onChange={(e) => setTextEditor({ ...textEditor, text: e.target.value })}
                onBlur={commitText}
                placeholder="Type here..."
                style={{
                  position: 'absolute',
                  left: textEditor.x,
                  top: textEditor.y,
                  fontFamily: '"Inter", sans-serif',
                  fontSize: `${textEditor.fontSize * zoom}px`,
                  lineHeight: 1.3,
                  color: textEditor.color,
                  background: 'rgba(255, 255, 255, 0.95)',
                  border: '1.5px solid #3b82f6',
                  borderRadius: 4,
                  padding: 4,
                  outline: 'none',
                  resize: 'both',
                  minWidth: 120,
                  minHeight: textEditor.fontSize * 1.5,
                  zIndex: 40,
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
                }}
              />
            )}

            {/* Floating Navigation / Hint Badge */}
            <div
              style={{
                position: 'absolute',
                bottom: 12,
                right: 14,
                fontSize: 11,
                color: 'var(--ink-muted)',
                background: 'rgba(255, 255, 255, 0.85)',
                backdropFilter: 'blur(4px)',
                padding: '4px 8px',
                borderRadius: 6,
                border: '1px solid var(--border)',
                userSelect: 'none',
                pointerEvents: 'none',
              }}
            >
              Select (V): Drag region to select multiple • Hold <kbd style={{ background: '#eee', padding: '1px 4px', borderRadius: 3, border: '1px solid #ccc' }}>Space</kbd> to pan • <kbd style={{ background: '#eee', padding: '1px 4px', borderRadius: 3, border: '1px solid #ccc' }}>Ctrl</kbd> + Scroll to zoom
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
