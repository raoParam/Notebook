'use client';

import React from 'react';
import { FocusStyles } from './focus-styles';

export interface TabItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  badge?: string | number;
  disabled?: boolean;
}

export type TabsVariant = 'underline' | 'pills' | 'contained';

export interface TabsProps {
  items: TabItem[];
  activeTab: string;
  onChange: (id: string) => void;
  variant?: TabsVariant;
  'aria-label'?: string;
  className?: string;
  style?: React.CSSProperties;
}

export function Tabs({
  items,
  activeTab,
  onChange,
  variant = 'underline',
  'aria-label': ariaLabel = 'Tabs',
  className = '',
  style,
}: TabsProps) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLElement>, currentIndex: number) => {
    const enabledTabs = items.filter((item) => !item.disabled);
    const enabledCurrentIndex = enabledTabs.findIndex((item) => item.id === items[currentIndex].id);

    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const nextIndex = (enabledCurrentIndex + 1) % enabledTabs.length;
      onChange(enabledTabs[nextIndex].id);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const prevIndex = (enabledCurrentIndex - 1 + enabledTabs.length) % enabledTabs.length;
      onChange(enabledTabs[prevIndex].id);
    } else if (e.key === 'Home') {
      e.preventDefault();
      onChange(enabledTabs[0].id);
    } else if (e.key === 'End') {
      e.preventDefault();
      onChange(enabledTabs[enabledTabs.length - 1].id);
    }
  };

  const getContainerStyle = (): React.CSSProperties => {
    switch (variant) {
      case 'underline':
        return {
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          borderBottom: '1px solid var(--border)',
          width: '100%',
        };
      case 'pills':
        return {
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          width: '100%',
        };
      case 'contained':
        return {
          display: 'inline-flex',
          alignItems: 'center',
          gap: 3,
          padding: 3,
          background: 'var(--bg-sidebar)',
          borderRadius: 'var(--radius-control)',
          border: '1px solid var(--border)',
        };
    }
  };

  const getTabStyle = (item: TabItem, isActive: boolean): React.CSSProperties => {
    const base: React.CSSProperties = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      border: 'none',
      background: 'transparent',
      fontFamily: 'var(--font)',
      fontSize: 'var(--font-size-sm, 13px)',
      fontWeight: isActive ? 600 : 500,
      cursor: item.disabled ? 'not-allowed' : 'pointer',
      opacity: item.disabled ? 0.5 : 1,
      userSelect: 'none',
      whiteSpace: 'nowrap',
      transition: 'all 0.15s ease',
    };

    switch (variant) {
      case 'underline':
        return {
          ...base,
          padding: '8px 4px',
          marginBottom: -1,
          borderBottom: `2px solid ${isActive ? 'var(--accent)' : 'transparent'}`,
          color: isActive ? 'var(--ink)' : 'var(--ink-soft)',
        };
      case 'pills':
        return {
          ...base,
          padding: '6px 12px',
          borderRadius: 'var(--radius-control)',
          background: isActive ? 'var(--bg-paper)' : 'transparent',
          border: `1px solid ${isActive ? 'var(--border)' : 'transparent'}`,
          boxShadow: isActive ? 'var(--shadow-sm)' : 'none',
          color: isActive ? 'var(--ink)' : 'var(--ink-soft)',
        };
      case 'contained':
        return {
          ...base,
          padding: '5px 12px',
          borderRadius: 'var(--radius-sm)',
          background: isActive ? 'var(--bg-paper)' : 'transparent',
          boxShadow: isActive ? 'var(--shadow-sm)' : 'none',
          color: isActive ? 'var(--ink)' : 'var(--ink-soft)',
        };
    }
  };

  return (
    <>
      <FocusStyles />
      <div
        role="tablist"
        aria-label={ariaLabel}
        className={className}
        style={{ ...getContainerStyle(), ...style }}
      >
        {items.map((item, index) => {
          const isActive = item.id === activeTab;
          return (
            <button
              key={item.id}
              role="tab"
              type="button"
              id={`tab-${item.id}`}
              aria-controls={`tabpanel-${item.id}`}
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              disabled={item.disabled}
              onClick={() => {
                if (!item.disabled) onChange(item.id);
              }}
              onKeyDown={(e) => handleKeyDown(e, index)}
              className="nb-focus-ring"
              style={getTabStyle(item, isActive)}
            >
              {item.icon && (
                <span style={{ display: 'inline-flex', alignItems: 'center' }}>{item.icon}</span>
              )}
              <span>{item.label}</span>
              {item.badge !== undefined && (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '1px 6px',
                    borderRadius: 999,
                    fontSize: '11px',
                    fontWeight: 600,
                    lineHeight: 1.2,
                    background: isActive ? 'var(--accent)' : 'var(--bg-sidebar)',
                    color: isActive ? 'var(--color-action-primary-text)' : 'var(--ink-muted)',
                    border: '1px solid var(--border)',
                  }}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </>
  );
}
