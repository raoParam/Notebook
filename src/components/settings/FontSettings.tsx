import React from 'react';
import { cleanFont, FONT_OPTIONS } from '@/components/ThemeProvider';
import {
  fontCardStyle,
  fontPreviewStyle,
  fontSelectStyle,
  sectionDescStyle,
  sectionTitleStyle,
} from './styles';

export interface FontSettingsProps {
  fonts: {
    uiFont: string;
    serifFont: string;
    monoFont: string;
  };
  onUpdateFont: (key: 'uiFont' | 'serifFont' | 'monoFont', value: string) => void;
  onResetFonts: () => void;
}

export function FontSettings({ fonts, onUpdateFont, onResetFonts }: FontSettingsProps) {
  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 6,
        }}
      >
        <div>
          <h3 style={sectionTitleStyle}>Typography & Fonts</h3>
          <p style={sectionDescStyle}>
            Select fonts for app interface, headings, and code editor. Works on both mobile and
            desktop.
          </p>
        </div>
        <button
          onClick={onResetFonts}
          style={{
            padding: '5px 12px',
            fontSize: 12,
            fontWeight: 500,
            color: 'var(--ink-soft)',
            background: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
            transition: 'background 0.15s',
          }}
        >
          Reset Fonts
        </button>
      </div>

      <div
        className="font-pickers-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: 12,
          marginTop: 12,
        }}
      >
        {/* UI Font */}
        <div style={fontCardStyle}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>
            Interface Font (UI)
          </span>
          <select
            value={fonts.uiFont}
            onChange={(e) => onUpdateFont('uiFont', e.target.value)}
            className="mobile-friendly-select"
            style={{ ...fontSelectStyle, fontFamily: cleanFont(fonts.uiFont) }}
          >
            {FONT_OPTIONS.ui.map((opt) => (
              <option
                key={opt.value}
                value={opt.value}
                style={{ fontFamily: cleanFont(opt.value) }}
              >
                {opt.label}
              </option>
            ))}
          </select>
          <div style={{ ...fontPreviewStyle, fontFamily: cleanFont(fonts.uiFont) }}>
            Aa Bb Cc 123 — Interface Preview
          </div>
        </div>

        {/* Reading & Title Font */}
        <div style={fontCardStyle}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>
            Reading & Title Font
          </span>
          <select
            value={fonts.serifFont}
            onChange={(e) => onUpdateFont('serifFont', e.target.value)}
            className="mobile-friendly-select"
            style={{ ...fontSelectStyle, fontFamily: cleanFont(fonts.serifFont) }}
          >
            {FONT_OPTIONS.serif.map((opt) => (
              <option
                key={opt.value}
                value={opt.value}
                style={{ fontFamily: cleanFont(opt.value) }}
              >
                {opt.label}
              </option>
            ))}
          </select>
          <div style={{ ...fontPreviewStyle, fontFamily: cleanFont(fonts.serifFont) }}>
            Notebook — Title Heading Preview
          </div>
        </div>

        {/* Monospace Code Font */}
        <div style={fontCardStyle}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>
            Editor & Code (Mono)
          </span>
          <select
            value={fonts.monoFont}
            onChange={(e) => onUpdateFont('monoFont', e.target.value)}
            className="mobile-friendly-select"
            style={{ ...fontSelectStyle, fontFamily: cleanFont(fonts.monoFont) }}
          >
            {FONT_OPTIONS.mono.map((opt) => (
              <option
                key={opt.value}
                value={opt.value}
                style={{ fontFamily: cleanFont(opt.value) }}
              >
                {opt.label}
              </option>
            ))}
          </select>
          <div style={{ ...fontPreviewStyle, fontFamily: cleanFont(fonts.monoFont) }}>
            const note = &quot;Markdown&quot;;
          </div>
        </div>
      </div>
    </div>
  );
}
