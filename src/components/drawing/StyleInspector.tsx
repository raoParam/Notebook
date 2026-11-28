import React from 'react';
import { FILL_COLORS, FONT_SIZES, STROKE_COLORS, STROKE_WIDTHS } from './constants';
import type { DrawingElement, FillStyle, StrokeStyle, ToolType } from './types';

export interface StyleInspectorProps {
  tool: ToolType;
  selectedIds: readonly string[];
  primarySelected: DrawingElement | null;
  strokeColor: string;
  fillColor: string;
  fillStyle: FillStyle;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  fontSize: number;
  opacity: number;
  onUpdateProperty: (patch: Partial<DrawingElement>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

export function StyleInspector({
  tool,
  selectedIds,
  primarySelected,
  strokeColor,
  fillColor,
  fillStyle,
  strokeWidth,
  strokeStyle,
  fontSize,
  opacity,
  onUpdateProperty,
  onDuplicate,
  onDelete,
}: StyleInspectorProps) {
  return (
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
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            color: 'var(--ink-muted)',
          }}
        >
          {selectedIds.length > 1
            ? `${selectedIds.length} Selected`
            : primarySelected
            ? 'Element Properties'
            : 'Tool Defaults'}
        </span>
        {primarySelected && (
          <span
            style={{
              fontSize: 11,
              background: 'var(--hover)',
              padding: '2px 6px',
              borderRadius: 4,
              color: 'var(--ink-soft)',
            }}
          >
            {selectedIds.length > 1 ? 'Multiple' : primarySelected.type}
          </span>
        )}
      </div>

      {/* Stroke Color */}
      <div>
        <label
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--ink-soft)',
            marginBottom: 6,
            display: 'block',
          }}
        >
          Stroke Color
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
          {STROKE_COLORS.map((c) => (
            <button
              key={c.value}
              onClick={() => onUpdateProperty({ strokeColor: c.value })}
              title={c.label}
              style={{
                width: 22,
                height: 22,
                borderRadius: 5,
                background: c.value,
                border:
                  strokeColor === c.value ? '2px solid var(--accent)' : '1px solid var(--border)',
                boxShadow:
                  strokeColor === c.value ? '0 0 0 2px rgba(59, 130, 246, 0.3)' : 'none',
                cursor: 'pointer',
              }}
            />
          ))}
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
              onChange={(e) => onUpdateProperty({ strokeColor: e.target.value })}
              style={{
                position: 'absolute',
                opacity: 0,
                width: '100%',
                height: '100%',
                cursor: 'pointer',
              }}
            />
          </label>
        </div>
      </div>

      {/* Background / Fill Color */}
      <div>
        <label
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--ink-soft)',
            marginBottom: 6,
            display: 'block',
          }}
        >
          Fill Background
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
          {FILL_COLORS.map((c) => (
            <button
              key={c.value}
              onClick={() => {
                const newStyle =
                  c.value === 'transparent' ? 'none' : fillStyle === 'none' ? 'semi' : fillStyle;
                onUpdateProperty({ fillColor: c.value, fillStyle: newStyle });
              }}
              title={c.label}
              style={{
                width: 22,
                height: 22,
                borderRadius: 5,
                background:
                  c.value === 'transparent'
                    ? 'linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)'
                    : c.value,
                backgroundSize: '8px 8px',
                border:
                  fillColor === c.value ? '2px solid var(--accent)' : '1px solid var(--border)',
                boxShadow:
                  fillColor === c.value ? '0 0 0 2px rgba(59, 130, 246, 0.3)' : 'none',
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
                const newStyle = fillStyle === 'none' ? 'solid' : fillStyle;
                onUpdateProperty({ fillColor: e.target.value, fillStyle: newStyle });
              }}
              style={{
                position: 'absolute',
                opacity: 0,
                width: '100%',
                height: '100%',
                cursor: 'pointer',
              }}
            />
          </label>
        </div>
      </div>

      {/* Fill Style */}
      {fillColor !== 'transparent' && (
        <div>
          <label
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--ink-soft)',
              marginBottom: 5,
              display: 'block',
            }}
          >
            Fill Style
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
            {(['none', 'semi', 'solid'] as FillStyle[]).map((st) => (
              <button
                key={st}
                onClick={() => onUpdateProperty({ fillStyle: st })}
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
        <label
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--ink-soft)',
            marginBottom: 5,
            display: 'block',
          }}
        >
          Stroke Width
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
          {STROKE_WIDTHS.map((sw) => (
            <button
              key={sw.value}
              onClick={() => onUpdateProperty({ strokeWidth: sw.value })}
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
        <label
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--ink-soft)',
            marginBottom: 5,
            display: 'block',
          }}
        >
          Stroke Style
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
          {(['solid', 'dashed', 'dotted'] as StrokeStyle[]).map((st) => (
            <button
              key={st}
              onClick={() => onUpdateProperty({ strokeStyle: st })}
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
          <label
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--ink-soft)',
              marginBottom: 5,
              display: 'block',
            }}
          >
            Font Size
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
            {FONT_SIZES.map((fs) => (
              <button
                key={fs.value}
                onClick={() => onUpdateProperty({ fontSize: fs.value })}
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
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)' }}>
            Opacity
          </label>
          <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>
            {Math.round(opacity * 100)}%
          </span>
        </div>
        <input
          type="range"
          min="0.1"
          max="1"
          step="0.05"
          value={opacity}
          onChange={(e) => onUpdateProperty({ opacity: parseFloat(e.target.value) })}
          style={{ width: '100%', cursor: 'pointer' }}
        />
      </div>

      {/* Actions for Selected Elements */}
      {selectedIds.length > 0 && (
        <div
          style={{
            borderTop: '1px solid var(--border)',
            paddingTop: 10,
            display: 'flex',
            gap: 6,
          }}
        >
          <button
            onClick={onDuplicate}
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
            onClick={onDelete}
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
  );
}
