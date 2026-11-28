import React from 'react';
import {
  THEME_PRESETS,
  type BuiltInThemeId,
  type CustomTheme,
  type ThemeColors,
} from '@/components/ThemeProvider';
import { FontSettings } from './FontSettings';
import {
  activeBadgeStyle,
  sectionDescStyle,
  sectionTitleStyle,
  ThemeSwatches,
} from './styles';
import { COLOR_FIELDS } from './types';

export interface AppearanceSettingsProps {
  themeId: string;
  activeColors: ThemeColors;
  customColors: Partial<ThemeColors>;
  customThemeName: string;
  savedCustomThemes: CustomTheme[];
  fonts: {
    uiFont: string;
    serifFont: string;
    monoFont: string;
  };
  onSelectTheme: (id: string) => void;
  onDeleteCustomTheme: (id: string, name: string) => void;
  onStartCustomizingTheme: () => void;
  onCustomThemeNameChange: (name: string) => void;
  onUpdateCustomColor: (key: keyof ThemeColors, value: string) => void;
  onUpdateFont: (key: 'uiFont' | 'serifFont' | 'monoFont', value: string) => void;
  onResetFonts: () => void;
  onResetCustomTheme: () => void;
  onOpenImportDialog: () => void;
  onExportJSON: () => void;
  onSaveTheme: () => void;
}

export function AppearanceSettings({
  themeId,
  activeColors,
  customColors,
  customThemeName,
  savedCustomThemes,
  fonts,
  onSelectTheme,
  onDeleteCustomTheme,
  onStartCustomizingTheme,
  onCustomThemeNameChange,
  onUpdateCustomColor,
  onUpdateFont,
  onResetFonts,
  onResetCustomTheme,
  onOpenImportDialog,
  onExportJSON,
  onSaveTheme,
}: AppearanceSettingsProps) {
  return (
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
                onClick={() => onSelectTheme(key)}
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
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 600, color: preset.colors.ink }}>
                    {preset.name}
                  </span>
                  {isSelected && (
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="var(--accent)"
                      strokeWidth="3"
                      strokeLinecap="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </div>

                <ThemeSwatches colors={preset.colors} />
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Section 1.5: Your Saved Custom Themes ── */}
      {savedCustomThemes.length > 0 && (
        <>
          <hr style={{ border: 'none', borderTop: '1px solid var(--border)' }} />
          <div>
            <h3 style={sectionTitleStyle}>Your Custom Themes</h3>
            <p style={sectionDescStyle}>Themes you have created, customized, or imported.</p>

            <div
              className="theme-presets-grid"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                gap: 12,
                marginTop: 12,
              }}
            >
              {savedCustomThemes.map((theme) => {
                const isSelected = themeId === theme.id;
                return (
                  <div
                    key={theme.id}
                    onClick={() => onSelectTheme(theme.id)}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 'var(--radius)',
                      border: `2px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                      background: theme.colors.bgPaper,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                      position: 'relative',
                      boxShadow: isSelected ? 'var(--shadow-sm)' : 'none',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: theme.colors.ink,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          maxWidth: '100px',
                        }}
                      >
                        {theme.name}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        {isSelected && (
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="var(--accent)"
                            strokeWidth="3"
                            strokeLinecap="round"
                          >
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteCustomTheme(theme.id, theme.name);
                          }}
                          title="Delete Theme"
                          style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--danger)',
                            cursor: 'pointer',
                            padding: 2,
                            display: 'flex',
                            alignItems: 'center',
                          }}
                        >
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                          >
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        </button>
                      </div>
                    </div>

                    <ThemeSwatches colors={theme.colors} />
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      <hr style={{ border: 'none', borderTop: '1px solid var(--border)' }} />

      {/* ── Section 2: Typography & Fonts ── */}
      <FontSettings fonts={fonts} onUpdateFont={onUpdateFont} onResetFonts={onResetFonts} />

      <hr style={{ border: 'none', borderTop: '1px solid var(--border)' }} />

      {/* ── Section 3: Custom Theme Builder ── */}
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
            <h3 style={sectionTitleStyle}>Custom Theme Builder</h3>
            <p style={sectionDescStyle}>
              Manipulate colors from any active theme and save with your custom theme name!
            </p>
          </div>
          {themeId === 'custom-draft' && <span style={activeBadgeStyle}>Editing Draft</span>}
        </div>

        {/* Theme Name input & customize button row */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 10,
            alignItems: 'center',
            marginTop: 12,
            padding: '12px 14px',
            background: 'var(--bg-app)',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border)',
          }}
        >
          <div
            style={{
              flex: 1,
              minWidth: 200,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>
              Theme Name
            </label>
            <input
              type="text"
              value={customThemeName}
              onChange={(e) => onCustomThemeNameChange(e.target.value)}
              placeholder="Enter theme name (e.g. My Midnight Theme)"
              style={{
                padding: '7px 10px',
                fontSize: 13,
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border)',
                background: 'var(--bg-paper)',
                color: 'var(--ink)',
                outline: 'none',
              }}
            />
          </div>

          <button
            onClick={onStartCustomizingTheme}
            title="Copy current active colors into builder"
            style={{
              alignSelf: 'flex-end',
              padding: '8px 14px',
              fontSize: 12.5,
              fontWeight: 500,
              color: 'var(--ink)',
              background: 'var(--hover)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
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
            >
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
            Customize Current Theme
          </button>
        </div>

        {/* 12 Color Pickers */}
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
            const currentColor = customColors[key] || activeColors[key] || '#000000';
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
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)' }}>
                    {label}
                  </label>
                  <span
                    style={{
                      fontSize: 10,
                      color: 'var(--ink-muted)',
                      fontFamily: 'var(--mono-font)',
                    }}
                  >
                    {cssVar}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="color"
                    value={currentColor}
                    onChange={(e) => onUpdateCustomColor(key, e.target.value)}
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
                  <input
                    type="text"
                    value={currentColor}
                    onChange={(e) => onUpdateCustomColor(key, e.target.value)}
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

        {/* Actions Bar */}
        <div
          className="custom-theme-actions"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 10,
            marginTop: 20,
            paddingTop: 16,
            borderTop: '1px solid var(--border)',
            justifyContent: 'flex-end',
            alignItems: 'center',
          }}
        >
          <button
            onClick={onOpenImportDialog}
            title="Import Theme"
            style={{
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--ink)',
              background: 'var(--bg-paper)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              transition: 'all 0.15s',
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
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Import Theme
          </button>

          <button
            onClick={onExportJSON}
            title="Export Theme"
            style={{
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--ink)',
              background: 'var(--bg-paper)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              transition: 'all 0.15s',
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
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export Theme
          </button>

          <button
            onClick={onResetCustomTheme}
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
            onClick={onSaveTheme}
            style={{
              padding: '8px 18px',
              fontSize: 13,
              fontWeight: 600,
              color: '#FFFFFF',
              background: 'var(--accent)',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              transition: 'background 0.15s',
              boxShadow: 'var(--shadow-sm)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
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
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
              <polyline points="17 21 17 13 7 13 7 21" />
              <polyline points="7 3 7 8 15 8" />
            </svg>
            Save Theme
          </button>
        </div>
      </div>
    </div>
  );
}
