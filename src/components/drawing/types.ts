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

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'start' | 'end';
export type InteractionAction = 'drawing' | 'moving' | 'resizing' | 'panning' | 'marquee' | 'idle';

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextEditorState {
  x: number;
  y: number;
  worldX: number;
  worldY: number;
  text: string;
  id?: string;
  fontSize: number;
  color: string;
}

export interface DrawingCanvasProps {
  onInsert: (dataUrl: string) => void;
  onClose: () => void;
}
