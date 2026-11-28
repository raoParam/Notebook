import React from 'react';
import type { ThemeColors } from '@/components/ThemeProvider';

export function ThemeSwatches({ colors }: { colors: ThemeColors }) {
  return (
    <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
      <div
        style={{
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: colors.bgApp,
          border: '1px solid var(--border)',
        }}
        title="App Background"
      />
      <div
        style={{
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: colors.bgSidebar,
          border: '1px solid var(--border)',
        }}
        title="Sidebar"
      />
      <div
        style={{ width: 14, height: 14, borderRadius: '50%', background: colors.accent }}
        title="Primary Accent"
      />
      <div
        style={{ width: 14, height: 14, borderRadius: '50%', background: colors.gold }}
        title="Accent Gold"
      />
    </div>
  );
}

export const navTabStyle: React.CSSProperties = {
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

export const closeBtnStyle: React.CSSProperties = {
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

export const sectionTitleStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  color: 'var(--ink)',
  marginBottom: 2,
};

export const sectionDescStyle: React.CSSProperties = {
  fontSize: 12.5,
  color: 'var(--ink-muted)',
};

export const activeBadgeStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: '#FFFFFF',
  background: 'var(--accent)',
  padding: '2px 8px',
  borderRadius: 10,
};

export const fontCardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: '10px 12px',
  background: 'var(--bg-app)',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border)',
};

export const fontSelectStyle: React.CSSProperties = {
  padding: '8px 10px',
  fontSize: 14,
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border)',
  background: 'var(--bg-paper)',
  color: 'var(--ink)',
  outline: 'none',
  cursor: 'pointer',
};

export const fontPreviewStyle: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--ink-soft)',
  padding: '8px 10px',
  background: 'var(--bg-paper)',
  borderRadius: 4,
  border: '1px dashed var(--border)',
  marginTop: 2,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};
