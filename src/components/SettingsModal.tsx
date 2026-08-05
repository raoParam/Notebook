'use client';

import React, { useState } from 'react';
import { useTheme, THEME_PRESETS, BuiltInThemeId, ThemeColors, ThemeId, FONT_OPTIONS } from '@/components/ThemeProvider';

interface SettingsModalProps {
  onClose: () => void;
}

type SettingsTab = 'appearance' | 'sync';

const COLOR_FIELDS: { key: keyof ThemeColors; label: string; cssVar: string }[] = [
  { key: 'bgApp', label: 'App Background', cssVar: '--bg-app' },
  { key: 'bgPaper', label: 'Surface / Card', cssVar: '--bg-paper' },
  { key: 'bgSidebar', label: 'Sidebar Background', cssVar: '--bg-sidebar' },
  { key: 'accent', label: 'Primary Color', cssVar: '--accent' },
  { key: 'accentSoft', label: 'Secondary Color', cssVar: '--accent-soft' },
  { key: 'gold', label: 'Accent Color', cssVar: '--gold' },
  { key: 'border', label: 'Border Color', cssVar: '--border' },
  { key: 'ink', label: 'Primary Text', cssVar: '--ink' },
  { key: 'inkSoft', label: 'Secondary Text', cssVar: '--ink-soft' },
  { key: 'inkMuted', label: 'Muted Text', cssVar: '--ink-muted' },
  { key: 'hover', label: 'Hover Background', cssVar: '--hover' },
  { key: 'danger', label: 'Danger Color', cssVar: '--danger' },
];

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance');
  const {
    themeId,
    activeColors,
    customColors,
    fonts,
    selectTheme,
    updateCustomColor,
    saveCustomTheme,
    resetCustomTheme,
    updateFont,
    resetFonts,
  } = useTheme();

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.5)',
        backdropFilter: 'blur(3px)',
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        className="settings-modal-card"
        style={{
          width: '100%',
          maxWidth: 680,
          maxHeight: '85vh',
          background: 'var(--bg-paper)',
          borderRadius: 'var(--radius)',
          border: '1px solid var(--border)',
          boxShadow: 'var(--shadow)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: 'modalIn 0.2s ease-out',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: '14px 18px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--bg-app)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent)' }}>
              <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>
              Settings
            </h2>
          </div>
          <button
            onClick={onClose}
            title="Close Settings"
            style={closeBtnStyle}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Modal Body with Sidebar Tabs */}
        <div className="settings-modal-body" style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {/* Settings Nav Tabs */}
          <div
            className="settings-nav-tabs"
            style={{
              width: 140,
              borderRight: '1px solid var(--border)',
              background: 'var(--bg-sidebar)',
              padding: '10px 6px',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              flexShrink: 0,
            }}
          >
            <button
              onClick={() => setActiveTab('appearance')}
              style={{
                ...navTabStyle,
                background: activeTab === 'appearance' ? 'var(--bg-paper)' : 'transparent',
                color: activeTab === 'appearance' ? 'var(--accent)' : 'var(--ink-soft)',
                fontWeight: activeTab === 'appearance' ? 600 : 400,
                boxShadow: activeTab === 'appearance' ? 'var(--shadow-sm)' : 'none',
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><path d="M12 2a7 7 0 1 0 10 10"/>
              </svg>
              Appearance
            </button>
          </div>

          {/* Settings Tab Content */}
          <div className="settings-content-area" style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '20px 22px' }}>
            {activeTab === 'appearance' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
                {/* ── Section 1: Default Themes ── */}
                <div>
                  <h3 style={sectionTitleStyle}>Default Themes</h3>
                  <p style={sectionDescStyle}>
                    Choose from built-in curated color palettes for the application.
                  </p>

                  <div
                    className="theme-presets-grid"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
                      gap: 12,
                      marginTop: 12,
                    }}
                  >
                    {(Object.keys(THEME_PRESETS) as BuiltInThemeId[]).map((key) => {
                      const preset = THEME_PRESETS[key];
                      const isSelected = themeId === key;
                      return (
                        <div
                          key={key}
                          onClick={() => selectTheme(key)}
                          style={{
                            padding: '10px 12px',
                            borderRadius: 'var(--radius)',
                            border: `2px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                            background: preset.colors.bgPaper,
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 8,
                            boxShadow: isSelected ? 'var(--shadow-sm)' : 'none',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: preset.colors.ink }}>
                              {preset.name}
                            </span>
                            {isSelected && (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round">
                                <polyline points="20 6 9 17 4 12"/>
                              </svg>
                            )}
                          </div>

                          {/* Color dots preview */}
                          <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                            <div style={{ width: 14, height: 14, borderRadius: '50%', background: preset.colors.bgApp, border: '1px solid var(--border)' }} title="App Background" />
                            <div style={{ width: 14, height: 14, borderRadius: '50%', background: preset.colors.bgSidebar, border: '1px solid var(--border)' }} title="Sidebar" />
                            <div style={{ width: 14, height: 14, borderRadius: '50%', background: preset.colors.accent }} title="Primary Accent" />
                            <div style={{ width: 14, height: 14, borderRadius: '50%', background: preset.colors.gold }} title="Accent Gold" />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <hr style={{ border: 'none', borderTop: '1px solid var(--border)' }} />

                {/* ── Section 2: Typography & Fonts ── */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <div>
                      <h3 style={sectionTitleStyle}>Typography & Fonts</h3>
                      <p style={sectionDescStyle}>
                        Choose custom font families for application interface, note titles, and editor code.
                      </p>
                    </div>
                    <button
                      onClick={resetFonts}
                      style={{
                        padding: '4px 10px',
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
                        onChange={(e) => updateFont('uiFont', e.target.value)}
                        style={fontSelectStyle}
                      >
                        {FONT_OPTIONS.ui.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      <div style={{ ...fontPreviewStyle, fontFamily: fonts.uiFont }}>
                        Aa Bb Cc 123 — Interface
                      </div>
                    </div>

                    {/* Reading & Title Font */}
                    <div style={fontCardStyle}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>
                        Reading & Title (Serif)
                      </span>
                      <select
                        value={fonts.serifFont}
                        onChange={(e) => updateFont('serifFont', e.target.value)}
                        style={fontSelectStyle}
                      >
                        {FONT_OPTIONS.serif.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      <div style={{ ...fontPreviewStyle, fontFamily: fonts.serifFont }}>
                        Notebook — Title Heading
                      </div>
                    </div>

                    {/* Monospace Code Font */}
                    <div style={fontCardStyle}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>
                        Editor & Code (Mono)
                      </span>
                      <select
                        value={fonts.monoFont}
                        onChange={(e) => updateFont('monoFont', e.target.value)}
                        style={fontSelectStyle}
                      >
                        {FONT_OPTIONS.mono.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      <div style={{ ...fontPreviewStyle, fontFamily: fonts.monoFont }}>
                        const x = 42; // code
                      </div>
                    </div>
                  </div>
                </div>

                <hr style={{ border: 'none', borderTop: '1px solid var(--border)' }} />

                {/* ── Section 3: Custom Theme ── */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <div>
                      <h3 style={sectionTitleStyle}>Custom Theme</h3>
                      <p style={sectionDescStyle}>
                        Customize component colors in real-time using HEX values or color pickers.
                      </p>
                    </div>
                    {themeId === 'custom' && (
                      <span style={activeBadgeStyle}>Active</span>
                    )}
                  </div>

                  {/* Color pickers grid */}
                  <div
                    className="color-pickers-grid"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                      gap: 12,
                      marginTop: 14,
                    }}
                  >
                    {COLOR_FIELDS.map(({ key, label, cssVar }) => {
                      const currentColor = (themeId === 'custom' ? customColors : activeColors)[key] || '#000000';
                      return (
                        <div
                          key={key}
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 4,
                            padding: '8px 10px',
                            background: 'var(--bg-app)',
                            borderRadius: 'var(--radius-sm)',
                            border: '1px solid var(--border)',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)' }}>
                              {label}
                            </label>
                            <span style={{ fontSize: 10, color: 'var(--ink-muted)', fontFamily: 'var(--mono-font)' }}>
                              {cssVar}
                            </span>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {/* Color picker box */}
                            <input
                              type="color"
                              value={currentColor}
                              onChange={(e) => updateCustomColor(key, e.target.value)}
                              style={{
                                width: 28,
                                height: 28,
                                padding: 0,
                                border: '1px solid var(--border)',
                                borderRadius: 4,
                                cursor: 'pointer',
                                background: 'none',
                              }}
                            />
                            {/* HEX text input */}
                            <input
                              type="text"
                              value={currentColor}
                              onChange={(e) => updateCustomColor(key, e.target.value)}
                              style={{
                                flex: 1,
                                padding: '4px 7px',
                                fontSize: 12,
                                fontFamily: 'var(--mono-font)',
                                background: 'var(--bg-paper)',
                                color: 'var(--ink)',
                                border: '1px solid var(--border)',
                                borderRadius: 4,
                                outline: 'none',
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Actions: Save Theme & Reset */}
                  <div className="custom-theme-actions" style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
                    <button
                      onClick={resetCustomTheme}
                      style={{
                        padding: '8px 14px',
                        fontSize: 13,
                        fontWeight: 500,
                        color: 'var(--ink-soft)',
                        background: 'transparent',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm)',
                        cursor: 'pointer',
                        transition: 'background 0.15s',
                      }}
                    >
                      Reset to Default
                    </button>
                    <button
                      onClick={saveCustomTheme}
                      style={{
                        padding: '8px 16px',
                        fontSize: 13,
                        fontWeight: 500,
                        color: '#FFFFFF',
                        background: 'var(--accent)',
                        border: 'none',
                        borderRadius: 'var(--radius-sm)',
                        cursor: 'pointer',
                        transition: 'background 0.15s',
                      }}
                    >
                      Save Custom Theme
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Responsive CSS for mobile phone view */}
        <style>{`
          .settings-modal-card {
            width: 94vw !important;
            max-width: 680px !important;
            max-height: 85vh !important;
          }

          .settings-nav-tabs button {
            white-space: nowrap;
          }

          @media (max-width: 640px) {
            .settings-modal-card {
              width: 95vw !important;
              max-height: 90vh !important;
            }
            .settings-modal-body {
              flex-direction: column !important;
            }
            .settings-nav-tabs {
              width: 100% !important;
              flex-direction: row !important;
              border-right: none !important;
              border-bottom: 1px solid var(--border) !important;
              padding: 6px 8px !important;
            }
            .settings-nav-tabs button {
              width: auto !important;
              padding: 6px 12px !important;
            }
            .settings-content-area {
              padding: 14px 14px 20px !important;
            }
            .font-pickers-grid, .color-pickers-grid {
              grid-template-columns: 1fr !important;
            }
            .theme-presets-grid {
              grid-template-columns: repeat(auto-fill, minmax(105px, 1fr)) !important;
            }
            .custom-theme-actions {
              flex-wrap: wrap !important;
              justify-content: stretch !important;
            }
            .custom-theme-actions button {
              flex: 1 1 auto !important;
              text-align: center !important;
            }
          }
        `}</style>
      </div>
    </div>
  );
}

const navTabStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 12px',
  borderRadius: 'var(--radius-sm)',
  border: 'none',
  fontSize: 13,
  textAlign: 'left',
  cursor: 'pointer',
  transition: 'all 0.12s ease',
  width: '100%',
};

const closeBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  padding: 6,
  color: 'var(--ink-soft)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  color: 'var(--ink)',
  marginBottom: 2,
};

const sectionDescStyle: React.CSSProperties = {
  fontSize: 12.5,
  color: 'var(--ink-muted)',
};

const activeBadgeStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: '#FFFFFF',
  background: 'var(--accent)',
  padding: '2px 8px',
  borderRadius: 10,
};

const fontCardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: '10px 12px',
  background: 'var(--bg-app)',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border)',
};

const fontSelectStyle: React.CSSProperties = {
  padding: '5px 8px',
  fontSize: 12.5,
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border)',
  background: 'var(--bg-paper)',
  color: 'var(--ink)',
  outline: 'none',
  cursor: 'pointer',
  fontFamily: 'var(--font)',
};

const fontPreviewStyle: React.CSSProperties = {
  fontSize: 12.5,
  color: 'var(--ink-soft)',
  padding: '6px 8px',
  background: 'var(--bg-paper)',
  borderRadius: 4,
  border: '1px border-dashed var(--border)',
  marginTop: 2,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};
