'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FocusStyles } from './focus-styles';

export interface DropdownItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  divider?: boolean;
}

export interface DropdownProps {
  trigger: React.ReactNode | ((props: { isOpen: boolean; toggle: () => void }) => React.ReactNode);
  items: DropdownItem[];
  isOpen?: boolean;
  onClose?: () => void;
  align?: 'left' | 'right';
  minWidth?: string | number;
  className?: string;
  style?: React.CSSProperties;
}

export function Dropdown({
  trigger,
  items,
  isOpen: controlledIsOpen,
  onClose,
  align = 'left',
  minWidth = 180,
  className = '',
  style,
}: DropdownProps) {
  const isControlled = controlledIsOpen !== undefined;
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const isOpen = isControlled ? controlledIsOpen : internalIsOpen;

  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const toggle = () => {
    if (isControlled) {
      if (isOpen) {
        onClose?.();
      }
    } else {
      setInternalIsOpen((prev) => !prev);
    }
  };

  const closeDropdown = useCallback(() => {
    if (isControlled) {
      onClose?.();
    } else {
      setInternalIsOpen(false);
    }
    setHighlightedIndex(-1);
  }, [isControlled, onClose]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;

    const handleOutsideClick = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        closeDropdown();
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('touchstart', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
    };
  }, [isOpen, closeDropdown]);

  // Keyboard navigation
  const selectableItems = items.filter((item) => !item.divider && !item.disabled);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeDropdown();
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightedIndex((prev) => {
          const next = prev + 1;
          return next >= selectableItems.length ? 0 : next;
        });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightedIndex((prev) => {
          const next = prev - 1;
          return next < 0 ? selectableItems.length - 1 : next;
        });
      } else if (e.key === 'Home') {
        e.preventDefault();
        setHighlightedIndex(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        setHighlightedIndex(selectableItems.length - 1);
      } else if (e.key === 'Enter' || e.key === ' ') {
        if (highlightedIndex >= 0 && highlightedIndex < selectableItems.length) {
          e.preventDefault();
          const targetItem = selectableItems[highlightedIndex];
          targetItem.onClick?.();
          closeDropdown();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, highlightedIndex, selectableItems, closeDropdown]);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        display: 'inline-block',
        ...style,
      }}
      className={className}
    >
      <FocusStyles />
      <div
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        style={{ display: 'inline-block' }}
      >
        {typeof trigger === 'function' ? trigger({ isOpen, toggle }) : trigger}
      </div>

      {isOpen && (
        <div
          ref={menuRef}
          role="menu"
          aria-orientation="vertical"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            [align === 'right' ? 'right' : 'left']: 0,
            zIndex: 150,
            minWidth: typeof minWidth === 'number' ? `${minWidth}px` : minWidth,
            background: 'var(--bg-paper)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-control)',
            boxShadow: 'var(--shadow)',
            padding: '4px',
            animation: 'nbFadeIn 0.12s ease-out forwards',
          }}
        >
          {items.map((item, index) => {
            if (item.divider) {
              return (
                <div
                  key={`divider-${index}`}
                  role="separator"
                  style={{
                    height: 1,
                    background: 'var(--border)',
                    margin: '4px 2px',
                  }}
                />
              );
            }

            const selectableIndex = selectableItems.indexOf(item);
            const isHighlighted = selectableIndex === highlightedIndex;

            return (
              <button
                key={item.id}
                role="menuitem"
                type="button"
                disabled={item.disabled}
                aria-disabled={item.disabled}
                onClick={() => {
                  if (item.disabled) return;
                  item.onClick?.();
                  closeDropdown();
                }}
                onMouseEnter={() => {
                  if (!item.disabled) setHighlightedIndex(selectableIndex);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  padding: '7px 10px',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  background: isHighlighted ? 'var(--hover)' : 'transparent',
                  color: item.disabled
                    ? 'var(--ink-muted)'
                    : item.danger
                    ? 'var(--danger)'
                    : 'var(--ink)',
                  fontSize: 'var(--font-size-sm, 13px)',
                  fontFamily: 'var(--font)',
                  fontWeight: 500,
                  cursor: item.disabled ? 'not-allowed' : 'pointer',
                  textAlign: 'left',
                  userSelect: 'none',
                  outline: 'none',
                  transition: 'background-color 0.12s ease, color 0.12s ease',
                }}
              >
                {item.icon && (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      color: item.danger ? 'var(--danger)' : 'var(--ink-soft)',
                      flexShrink: 0,
                    }}
                  >
                    {item.icon}
                  </span>
                )}
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
