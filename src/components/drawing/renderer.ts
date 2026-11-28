import { getElementBounds, getHandles } from './geometry';
import type { Box, DrawingElement, Point } from './types';

export function drawElement(ctx: CanvasRenderingContext2D, el: DrawingElement): void {
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
        ctx.lineTo(
          end.x - headLen * Math.cos(angle - Math.PI / 6),
          end.y - headLen * Math.sin(angle - Math.PI / 6)
        );
        ctx.moveTo(end.x, end.y);
        ctx.lineTo(
          end.x - headLen * Math.cos(angle + Math.PI / 6),
          end.y - headLen * Math.sin(angle + Math.PI / 6)
        );
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
}

export interface RenderCanvasParams {
  canvas: HTMLCanvasElement;
  elements: readonly DrawingElement[];
  currentElement: DrawingElement | null;
  selectedElements: readonly DrawingElement[];
  selectedIds: readonly string[];
  marquee: Box | null;
  pan: Point;
  zoom: number;
  editingTextId?: string | null;
}

export function renderCanvasScene({
  canvas,
  elements,
  currentElement,
  selectedElements,
  selectedIds,
  marquee,
  pan,
  zoom,
  editingTextId,
}: RenderCanvasParams): void {
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

  // Dot grid background
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

  // Draw all elements (except currently edited inline text)
  for (const el of elements) {
    if (editingTextId && editingTextId === el.id) continue;
    drawElement(ctx, el);
  }

  // Draw current element being drawn
  if (currentElement) {
    drawElement(ctx, currentElement);
  }

  // Draw Marquee selection box
  if (marquee) {
    const { x, y, width: mw, height: mh } = marquee;
    ctx.save();
    ctx.fillStyle = 'rgba(59, 130, 246, 0.12)';
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 1.2 / zoom;
    ctx.setLineDash([4 / zoom, 4 / zoom]);
    ctx.fillRect(x, y, mw, mh);
    ctx.strokeRect(x, y, mw, mh);
    ctx.restore();
  }

  // Draw Selection Bounding Box & Handles
  if (selectedElements.length > 0 && (!editingTextId || !selectedIds.includes(editingTextId))) {
    ctx.save();
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 1.5 / zoom;
    ctx.setLineDash([4 / zoom, 4 / zoom]);

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const el of selectedElements) {
      const b = getElementBounds(el);
      minX = Math.min(minX, b.minX);
      minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX);
      maxY = Math.max(maxY, b.maxY);
    }

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
}

export function exportDrawingToDataUrl(elements: readonly DrawingElement[]): string | null {
  if (elements.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const el of elements) {
    const pad = el.strokeWidth || 4;
    const b = getElementBounds(el);
    minX = Math.min(minX, b.minX - pad);
    minY = Math.min(minY, b.minY - pad);
    maxX = Math.max(maxX, b.maxX + pad);
    maxY = Math.max(maxY, b.maxY + pad);
  }

  const padding = 28;
  const exportWidth = Math.max(120, Math.ceil(maxX - minX + padding * 2));
  const exportHeight = Math.max(80, Math.ceil(maxY - minY + padding * 2));

  const exportCanvas = document.createElement('canvas');
  const scale = 2; // high-resolution 2x export
  exportCanvas.width = exportWidth * scale;
  exportCanvas.height = exportHeight * scale;

  const ctx = exportCanvas.getContext('2d');
  if (!ctx) return null;

  ctx.scale(scale, scale);

  // Clean background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, exportWidth, exportHeight);

  // Offset elements to fit export canvas
  ctx.translate(padding - minX, padding - minY);

  for (const el of elements) {
    drawElement(ctx, el);
  }

  return exportCanvas.toDataURL('image/png', 0.95);
}
