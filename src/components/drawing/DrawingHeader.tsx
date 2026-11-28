import React from 'react';

export interface DrawingHeaderProps {
  canUndo: boolean;
  canRedo: boolean;
  hasElements: boolean;
  zoom: number;
  showPropertyPanel: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onFitToScreen: () => void;
  onTogglePropertyPanel: () => void;
  onInsert: () => void;
  onClose: () => void;
}

export function DrawingHeader({
  canUndo,
  canRedo,
  hasElements,
  zoom,
  showPropertyPanel,
  onUndo,
  onRedo,
  onClear,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onFitToScreen,
  onTogglePropertyPanel,
  onInsert,
  onClose,
}: DrawingHeaderProps) {
  return (
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
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 19l7-7 3 3-7 7-3-3z" />
              <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
              <path d="M2 2l7.586 7.586" />
              <circle cx="11" cy="11" r="2" />
            </svg>
          </div>
          <span
            style={{
              fontWeight: 600,
              fontSize: 15,
              color: 'var(--ink)',
              letterSpacing: '-0.01em',
            }}
          >
            Drawing Studio
          </span>
        </div>

        <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }} />

        {/* Undo / Redo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <button
            onClick={onUndo}
            disabled={!canUndo}
            title="Undo (Ctrl+Z)"
            style={{
              padding: '5px 8px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'var(--bg-paper)',
              color: !canUndo ? 'var(--ink-muted)' : 'var(--ink)',
              cursor: !canUndo ? 'not-allowed' : 'pointer',
              opacity: !canUndo ? 0.5 : 1,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 12,
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 7v6h6" />
              <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
            </svg>
          </button>

          <button
            onClick={onRedo}
            disabled={!canRedo}
            title="Redo (Ctrl+Y)"
            style={{
              padding: '5px 8px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'var(--bg-paper)',
              color: !canRedo ? 'var(--ink-muted)' : 'var(--ink)',
              cursor: !canRedo ? 'not-allowed' : 'pointer',
              opacity: !canRedo ? 0.5 : 1,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 12,
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 7v6h-6" />
              <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7" />
            </svg>
          </button>

          <button
            onClick={onClear}
            disabled={!hasElements}
            title="Clear Canvas"
            style={{
              padding: '5px 9px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'var(--bg-paper)',
              color: 'var(--danger)',
              cursor: !hasElements ? 'not-allowed' : 'pointer',
              opacity: !hasElements ? 0.5 : 1,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 12,
              fontWeight: 500,
              marginLeft: 4,
            }}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
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
          onClick={onZoomOut}
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
          onClick={onResetZoom}
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
          onClick={onZoomIn}
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
          onClick={onFitToScreen}
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
          onClick={onTogglePropertyPanel}
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
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
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
          onClick={onInsert}
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
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
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
  );
}
