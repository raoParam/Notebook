'use client';

import React, { useRef, useState } from 'react';
import { useTheme } from '@/components/ThemeProvider';
import { AppearanceSettings } from './settings/AppearanceSettings';
import { closeBtnStyle, navTabStyle } from './settings/styles';
import { SyncSettings } from './settings/SyncSettings';
import { ThemeImportExportModal } from './settings/ThemeImportExportModal';
import type { SettingsModalProps, SettingsTab } from './settings/types';

export type { SettingsModalProps } from './settings/types';

export function SettingsModal({
  onClose,
  autoSyncEnabled = false,
  onToggleAutoSync,
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showImportDialog, setShowImportDialog] = useState(false);

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

  const handleExportJSON = () => {
    try {
      const { jsonString, filename } = exportThemeToJSON();
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
    } else {
      setNotification({
        type: 'error',
        message:
          res.error ||
          'The theme configuration could not be imported. Please verify the JSON data and try again.',
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
        message:
          'Could not read the selected file. Please ensure the file is accessible and try again.',
      });
      setShowImportDialog(false);
    };
    reader.readAsText(file);
  };

  const handleApplyPastedJSON = (pastedJson: string) => {
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
        {/* Hidden File Input for Import Option 1 */}
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
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: 'var(--accent)' }}
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>
              Settings & Themes
            </h2>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={onClose} title="Close Settings" style={closeBtnStyle}>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
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
              background:
                notification.type === 'success'
                  ? 'rgba(34, 197, 94, 0.15)'
                  : 'rgba(239, 68, 68, 0.15)',
              color: notification.type === 'success' ? '#14532d' : '#991b1b',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {notification.type === 'success' ? (
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#16a34a"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#dc2626"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              )}
              <span style={{ lineHeight: 1.4 }}>{notification.message}</span>
            </div>
            <button
              onClick={() => setNotification(null)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'inherit',
                padding: '2px 6px',
                fontSize: 16,
              }}
            >
              &times;
            </button>
          </div>
        )}

        {/* Modal Body */}
        <div
          className="settings-modal-body"
          style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}
        >
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
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 2a7 7 0 1 0 10 10" />
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
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
              Sync
            </button>
          </div>

          {/* Settings Tab Content */}
          <div
            className="settings-content-area"
            style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '20px 22px' }}
          >
            {activeTab === 'appearance' && (
              <AppearanceSettings
                themeId={themeId}
                activeColors={activeColors}
                customColors={customColors}
                customThemeName={customThemeName}
                savedCustomThemes={savedCustomThemes}
                fonts={fonts}
                onSelectTheme={(id) => {
                  selectTheme(id);
                  setNotification(null);
                }}
                onDeleteCustomTheme={(id, name) => {
                  deleteCustomTheme(id);
                  setNotification({ type: 'success', message: `Deleted theme "${name}"` });
                }}
                onStartCustomizingTheme={() => startCustomizingTheme()}
                onCustomThemeNameChange={setCustomThemeName}
                onUpdateCustomColor={updateCustomColor}
                onUpdateFont={updateFont}
                onResetFonts={() => {
                  resetFonts();
                  setNotification({ type: 'success', message: 'Fonts reset to defaults.' });
                }}
                onResetCustomTheme={resetCustomTheme}
                onOpenImportDialog={() => setShowImportDialog(true)}
                onExportJSON={handleExportJSON}
                onSaveTheme={handleSave}
              />
            )}

            {activeTab === 'sync' && (
              <SyncSettings
                autoSyncEnabled={autoSyncEnabled}
                onToggleAutoSync={onToggleAutoSync}
                onNotify={setNotification}
              />
            )}
          </div>
        </div>

        {/* Sub-Modal: Import Theme Dialog */}
        <ThemeImportExportModal
          isOpen={showImportDialog}
          onClose={() => setShowImportDialog(false)}
          onSelectFile={() => fileInputRef.current?.click()}
          onApplyPastedJSON={handleApplyPastedJSON}
        />

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
