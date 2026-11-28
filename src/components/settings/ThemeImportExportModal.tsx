import React, { useState } from 'react';
import { closeBtnStyle } from './styles';
import type { ImportMode } from './types';

export interface ThemeImportExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectFile: () => void;
  onApplyPastedJSON: (pastedText: string) => void;
}

export function ThemeImportExportModal({
  isOpen,
  onClose,
  onSelectFile,
  onApplyPastedJSON,
}: ThemeImportExportModalProps) {
  const [importMode, setImportMode] = useState<ImportMode>('file');
  const [pastedJson, setPastedJson] = useState('');

  if (!isOpen) return null;

  return (
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
        onClose();
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
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="2.2"
              strokeLinecap="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>Import Theme</h3>
          </div>
          <button onClick={onClose} style={closeBtnStyle}>
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

        {/* Dialog Body */}
        <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Segmented Selector */}
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
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
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
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
              </svg>
              Option 2: Paste JSON
            </button>
          </div>

          {/* Option 1: File Upload */}
          {importMode === 'file' && (
            <div
              onClick={(e) => {
                e.stopPropagation();
                onSelectFile();
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
              <svg
                width="34"
                height="34"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--accent)"
                strokeWidth="1.8"
                strokeLinecap="round"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
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

          {/* Option 2: Paste JSON Code */}
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
                  onClick={() => onApplyPastedJSON(pastedJson)}
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
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Apply Pasted Theme
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
