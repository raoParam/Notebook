'use client';

import React, { useRef, useState } from 'react';
import {
  useTheme,
  THEME_PRESETS,
  BuiltInThemeId,
  ThemeColors,
  FONT_OPTIONS,
  cleanFont,
} from '@/components/ThemeProvider';

interface SettingsModalProps {
  onClose: () => void;
  autoSyncEnabled?: boolean;
  onToggleAutoSync?: (enabled: boolean) => void;
}

type SettingsTab = 'appearance' | 'sync';
type ImportMode = 'file' | 'text';

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

export function SettingsModal({
  onClose,
  autoSyncEnabled = false,
  onToggleAutoSync,
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importMode, setImportMode] = useState<ImportMode>('file');
  const [pastedJson, setPastedJson] = useState('');

  const [notification, setNotification] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const {
    themeId,
    activeColors,
    customColors,
    customThemeName,
    savedCustomThemes,
    fonts,
    selectTheme,
    startCustomizingTheme,
    updateCustomColor,
    setCustomThemeName,
    saveCustomTheme,
    deleteCustomTheme,
    resetCustomTheme,
    importThemeFromJSON,
    exportThemeToJSON,
    updateFont,
    resetFonts,
  } = useTheme();

  const handleSave = () => {
    saveCustomTheme(customThemeName);
    setNotification({
      type: 'success',
      message: `Theme "${customThemeName}" saved successfully.`,
    });
  };

  const handleExportJSON = (targetId?: string) => {
    try {
      const { jsonString, filename } = exportThemeToJSON(targetId);
      const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setNotification({
        type: 'success',
        message: `Theme exported successfully as ${filename}`,
      });
    } catch {
      setNotification({
        type: 'error',
        message: 'Unable to export theme. Please try again.',
      });
    }
  };

  const processImportContent = (content: string) => {
    const res = importThemeFromJSON(content);
    if (res.success) {
      setNotification({
        type: 'success',
        message: `Theme "${res.themeName || 'Imported Theme'}" successfully imported and applied!`,
      });
      setShowImportDialog(false);
      setPastedJson('');
    } else {
      setNotification({
        type: 'error',
        message: res.error || 'The theme configuration could not be imported. Please verify the JSON data and try again.',
      });
      setShowImportDialog(false);
    }
  };

  const handleImportFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const content = evt.target?.result as string;
      processImportContent(content);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    };
    reader.onerror = () => {
      setNotification({
        type: 'error',
        message: 'Could not read the selected file. Please ensure the file is accessible and try again.',
      });
      setShowImportDialog(false);
    };
    reader.readAsText(file);
  };

  const handleApplyPastedJSON = () => {
    if (!pastedJson.trim()) {
      setNotification({
        type: 'error',
        message: 'The pasted JSON content is empty. Please paste a valid theme configuration.',
      });
      return;
    }
    processImportContent(pastedJson);
  };

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
          maxWidth: 740,
          maxHeight: '88vh',
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
        {/* Hidden File Input for Option 1 */}
        <input
          type="file"
          ref={fileInputRef}
          accept=".json,application/json"
          onClick={(e) => e.stopPropagation()}
          onChange={handleImportFileChange}
          style={{ display: 'none' }}
        />

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
              Settings & Themes
            </h2>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
        </div>

        {/* Status / Notification Banner */}
        {notification && (
          <div
            style={{
              padding: '12px 18px',
              fontSize: 13,
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: notification.type === 'success' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
              color: notification.type === 'success' ? '#14532d' : '#991b1b',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {notification.type === 'success' ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.5" strokeLinecap="round">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
              )}
              <span style={{ lineHeight: 1.4 }}>{notification.message}</span>
            </div>
            <button
              onClick={() => setNotification(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: '2px 6px', fontSize: 16 }}
            >
              &times;
            </button>
          </div>
        )}

        {/* Modal Body */}
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
              type="button"
              onClick={() => setActiveTab('appearance')}
              style={{
                ...navTabStyle,
                background: activeTab === 'appearance' ? 'var(--bg-paper)' : 'transparent',
                color: activeTab === 'appearance' ? 'var(--accent)' : 'var(--ink-soft)',
                fontWeight: activeTab === 'appearance' ? 600 : 500,
                boxShadow: activeTab === 'appearance' ? 'var(--shadow-sm)' : 'none',
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><path d="M12 2a7 7 0 1 0 10 10"/>
              </svg>
              Appearance
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('sync')}
              style={{
                ...navTabStyle,
                background: activeTab === 'sync' ? 'var(--bg-paper)' : 'transparent',
                color: activeTab === 'sync' ? 'var(--accent)' : 'var(--ink-soft)',
                fontWeight: activeTab === 'sync' ? 600 : 500,
                boxShadow: activeTab === 'sync' ? 'var(--shadow-sm)' : 'none',
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
              </svg>
              Sync
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
                          onClick={() => {
                            selectTheme(key);
                            setNotification(null);
                          }}
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

                {/* ── Section 1.5: Your Saved Custom Themes ── */}
                {savedCustomThemes.length > 0 && (
                  <>
                    <hr style={{ border: 'none', borderTop: '1px solid var(--border)' }} />
                    <div>
                      <h3 style={sectionTitleStyle}>Your Custom Themes</h3>
                      <p style={sectionDescStyle}>
                        Themes you have created, customized, or imported.
                      </p>

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
                              onClick={() => {
                                selectTheme(theme.id);
                                setNotification(null);
                              }}
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
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <span style={{ fontSize: 13, fontWeight: 600, color: theme.colors.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100px' }}>
                                  {theme.name}
                                </span>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                  {isSelected && (
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round">
                                      <polyline points="20 6 9 17 4 12"/>
                                    </svg>
                                  )}
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      deleteCustomTheme(theme.id);
                                      setNotification({ type: 'success', message: `Deleted theme "${theme.name}"` });
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
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                      <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                                    </svg>
                                  </button>
                                </div>
                              </div>

                              <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                                <div style={{ width: 14, height: 14, borderRadius: '50%', background: theme.colors.bgApp, border: '1px solid var(--border)' }} title="App Background" />
                                <div style={{ width: 14, height: 14, borderRadius: '50%', background: theme.colors.bgSidebar, border: '1px solid var(--border)' }} title="Sidebar" />
                                <div style={{ width: 14, height: 14, borderRadius: '50%', background: theme.colors.accent }} title="Primary Accent" />
                                <div style={{ width: 14, height: 14, borderRadius: '50%', background: theme.colors.gold }} title="Accent Gold" />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}

                <hr style={{ border: 'none', borderTop: '1px solid var(--border)' }} />

                {/* ── Section 2: Typography & Fonts ── */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <div>
                      <h3 style={sectionTitleStyle}>Typography & Fonts</h3>
                      <p style={sectionDescStyle}>
                        Select fonts for app interface, headings, and code editor. Works on both mobile and desktop.
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        resetFonts();
                        setNotification({ type: 'success', message: 'Fonts reset to defaults.' });
                      }}
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
                        onChange={(e) => updateFont('uiFont', e.target.value)}
                        className="mobile-friendly-select"
                        style={{ ...fontSelectStyle, fontFamily: cleanFont(fonts.uiFont) }}
                      >
                        {FONT_OPTIONS.ui.map((opt) => (
                          <option key={opt.value} value={opt.value} style={{ fontFamily: cleanFont(opt.value) }}>
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
                        onChange={(e) => updateFont('serifFont', e.target.value)}
                        className="mobile-friendly-select"
                        style={{ ...fontSelectStyle, fontFamily: cleanFont(fonts.serifFont) }}
                      >
                        {FONT_OPTIONS.serif.map((opt) => (
                          <option key={opt.value} value={opt.value} style={{ fontFamily: cleanFont(opt.value) }}>
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
                        onChange={(e) => updateFont('monoFont', e.target.value)}
                        className="mobile-friendly-select"
                        style={{ ...fontSelectStyle, fontFamily: cleanFont(fonts.monoFont) }}
                      >
                        {FONT_OPTIONS.mono.map((opt) => (
                          <option key={opt.value} value={opt.value} style={{ fontFamily: cleanFont(opt.value) }}>
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

                <hr style={{ border: 'none', borderTop: '1px solid var(--border)' }} />

                {/* ── Section 3: Custom Theme Builder ── */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <div>
                      <h3 style={sectionTitleStyle}>Custom Theme Builder</h3>
                      <p style={sectionDescStyle}>
                        Manipulate colors from any active theme and save with your custom theme name!
                      </p>
                    </div>
                    {themeId === 'custom-draft' && (
                      <span style={activeBadgeStyle}>Editing Draft</span>
                    )}
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
                    <div style={{ flex: 1, minWidth: 200, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>
                        Theme Name
                      </label>
                      <input
                        type="text"
                        value={customThemeName}
                        onChange={(e) => setCustomThemeName(e.target.value)}
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
                      onClick={() => startCustomizingTheme()}
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
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
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
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)' }}>
                              {label}
                            </label>
                            <span style={{ fontSize: 10, color: 'var(--ink-muted)', fontFamily: 'var(--mono-font)' }}>
                              {cssVar}
                            </span>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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

                  {/* Actions Bar */}
                  <div className="custom-theme-actions" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)', justifyContent: 'flex-end', alignItems: 'center' }}>
                    <button
                      onClick={() => setShowImportDialog(true)}
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
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                      </svg>
                      Import Theme
                    </button>

                    <button
                      onClick={() => handleExportJSON()}
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
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                      </svg>
                      Export Theme
                    </button>

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
                      onClick={handleSave}
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
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
                      </svg>
                      Save Theme
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'sync' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                <div>
                  <h3 style={sectionTitleStyle}>Automatic Synchronization</h3>
                  <p style={sectionDescStyle}>
                    Control whether this device automatically synchronizes notes with paired devices.
                  </p>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 16,
                    padding: '14px 16px',
                    background: 'var(--bg-app)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border)',
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>
                      Auto-sync
                    </div>
                    <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 3, lineHeight: 1.5 }}>
                      Off by default. Automatic sync runs only when <strong>both</strong> this device
                      and a connected paired device have Auto-sync enabled. Manual sync remains
                      available at any time.
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={autoSyncEnabled}
                    aria-label="Toggle Auto-sync"
                    onClick={() => {
                      const next = !autoSyncEnabled;
                      onToggleAutoSync?.(next);
                      setNotification({
                        type: 'success',
                        message: next
                          ? 'Auto-sync enabled for this device.'
                          : 'Auto-sync disabled for this device.',
                      });
                    }}
                    style={{
                      width: 46,
                      height: 26,
                      borderRadius: 999,
                      border: '1px solid var(--border)',
                      background: autoSyncEnabled ? 'var(--accent)' : 'var(--bg-sidebar)',
                      position: 'relative',
                      cursor: 'pointer',
                      flexShrink: 0,
                      transition: 'background 0.15s ease',
                    }}
                  >
                    <span
                      style={{
                        position: 'absolute',
                        top: 2,
                        left: autoSyncEnabled ? 22 : 2,
                        width: 20,
                        height: 20,
                        borderRadius: '50%',
                        background: '#ffffff',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                        transition: 'left 0.15s ease',
                      }}
                    />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Sub-Modal: Import Theme Dialog (2 Options: File or Paste JSON) ── */}
        {showImportDialog && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 250,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(0, 0, 0, 0.6)',
              backdropFilter: 'blur(4px)',
              padding: 16,
            }}
            onClick={(e) => {
              e.stopPropagation();
              setShowImportDialog(false);
            }}
          >
            <div
              style={{
                width: '100%',
                maxWidth: 520,
                background: 'var(--bg-paper)',
                borderRadius: 'var(--radius)',
                border: '1px solid var(--border)',
                boxShadow: 'var(--shadow)',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                animation: 'modalIn 0.18s ease-out',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Dialog Header */}
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                  <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>
                    Import Theme
                  </h3>
                </div>
                <button
                  onClick={() => setShowImportDialog(false)}
                  style={closeBtnStyle}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>

              {/* Dialog Body */}
              <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* 2 Options Segmented Selector */}
                <div
                  style={{
                    display: 'flex',
                    background: 'var(--bg-app)',
                    padding: 4,
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border)',
                  }}
                >
                  <button
                    onClick={() => setImportMode('file')}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      fontSize: 13,
                      fontWeight: 600,
                      border: 'none',
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                      background: importMode === 'file' ? 'var(--bg-paper)' : 'transparent',
                      color: importMode === 'file' ? 'var(--accent)' : 'var(--ink-soft)',
                      boxShadow: importMode === 'file' ? 'var(--shadow-sm)' : 'none',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      transition: 'all 0.15s',
                    }}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                    </svg>
                    Option 1: Import File
                  </button>

                  <button
                    onClick={() => setImportMode('text')}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      fontSize: 13,
                      fontWeight: 600,
                      border: 'none',
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                      background: importMode === 'text' ? 'var(--bg-paper)' : 'transparent',
                      color: importMode === 'text' ? 'var(--accent)' : 'var(--ink-soft)',
                      boxShadow: importMode === 'text' ? 'var(--shadow-sm)' : 'none',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      transition: 'all 0.15s',
                    }}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
                    </svg>
                    Option 2: Paste JSON
                  </button>
                </div>

                {/* Option 1 View: File Upload */}
                {importMode === 'file' && (
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                    style={{
                      border: '2px dashed var(--border)',
                      borderRadius: 'var(--radius)',
                      padding: '28px 20px',
                      textAlign: 'center',
                      background: 'var(--bg-app)',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 10,
                      transition: 'border-color 0.15s',
                    }}
                  >
                    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                    <div>
                      <p style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>
                        Choose a JSON Theme file from your device
                      </p>
                      <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 2 }}>
                        Click anywhere in this box to select your .json file
                      </p>
                    </div>
                    <button
                      style={{
                        marginTop: 4,
                        padding: '7px 16px',
                        fontSize: 13,
                        fontWeight: 500,
                        color: '#FFFFFF',
                        background: 'var(--accent)',
                        border: 'none',
                        borderRadius: 'var(--radius-sm)',
                        cursor: 'pointer',
                      }}
                    >
                      Browse JSON File
                    </button>
                  </div>
                )}

                {/* Option 2 View: Paste JSON Code */}
                {importMode === 'text' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>
                      Paste JSON Theme Code:
                    </label>
                    <textarea
                      value={pastedJson}
                      onChange={(e) => setPastedJson(e.target.value)}
                      placeholder={`{\n  "name": "My Custom Theme",\n  "colors": {\n    "bgApp": "#14171C",\n    "bgPaper": "#1B1F26",\n    "accent": "#7FA8CC",\n    "ink": "#E7E5DE"\n  }\n}`}
                      rows={8}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        fontSize: 12.5,
                        fontFamily: 'var(--mono-font)',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--border)',
                        background: 'var(--bg-app)',
                        color: 'var(--ink)',
                        outline: 'none',
                        resize: 'vertical',
                      }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
                      <button
                        onClick={() => setPastedJson('')}
                        style={{
                          padding: '7px 12px',
                          fontSize: 12.5,
                          fontWeight: 500,
                          color: 'var(--ink-soft)',
                          background: 'transparent',
                          border: '1px solid var(--border)',
                          borderRadius: 'var(--radius-sm)',
                          cursor: 'pointer',
                        }}
                      >
                        Clear
                      </button>
                      <button
                        onClick={handleApplyPastedJSON}
                        style={{
                          padding: '7px 16px',
                          fontSize: 13,
                          fontWeight: 600,
                          color: '#FFFFFF',
                          background: 'var(--accent)',
                          border: 'none',
                          borderRadius: 'var(--radius-sm)',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                        Apply Pasted Theme
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Responsive CSS for mobile phone view */}
        <style>{`
          .settings-modal-card {
            width: 94vw !important;
            max-width: 740px !important;
            max-height: 88vh !important;
          }

          .mobile-friendly-select {
            font-size: 15px !important;
            padding: 8px 10px !important;
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
              grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)) !important;
            }
          }
        `}</style>
      </div>
    </div>
  );
}

const actionHeaderBtnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  padding: '6px 10px',
  fontSize: 12,
  fontWeight: 500,
  color: 'var(--ink)',
  background: 'var(--bg-paper)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
  transition: 'all 0.12s ease',
};

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
  padding: '8px 10px',
  fontSize: 14,
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border)',
  background: 'var(--bg-paper)',
  color: 'var(--ink)',
  outline: 'none',
  cursor: 'pointer',
};

const fontPreviewStyle: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--ink-soft)',
  padding: '8px 10px',
  background: 'var(--bg-paper)',
  borderRadius: 4,
  border: '1px border-dashed var(--border)',
  marginTop: 2,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};
