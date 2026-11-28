import React from 'react';
import type { ToolType } from './types';

export interface ToolPaletteProps {
  tool: ToolType;
  onSelectTool: (tool: ToolType) => void;
}

const TOOL_DEFINITIONS: Array<{
  id: ToolType;
  label: string;
  icon: React.ReactNode;
}> = [
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
];

export function ToolPalette({ tool, onSelectTool }: ToolPaletteProps) {
  return (
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
      {TOOL_DEFINITIONS.map((item) => {
        const active = tool === item.id;
        return (
          <button
            key={item.id}
            onClick={() => onSelectTool(item.id)}
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
  );
}
