'use client';

import React, { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { FocusStyles } from './focus-styles';
import { IconButton } from './IconButton';
import { CloseIcon } from './icons';

function subscribeToClient() {
  return () => {};
}

export type DrawerSide = 'left' | 'right';

export interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  side?: DrawerSide;
  title?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: string | number;
  closeOnBackdropClick?: boolean;
  closeOnEsc?: boolean;
  showCloseButton?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function Drawer({
  isOpen,
  onClose,
  side = 'right',
  title,
  children,
  footer,
  width = 320,
  closeOnBackdropClick = true,
  closeOnEsc = true,
  showCloseButton = true,
  className = '',
  style,
}: DrawerProps) {
  const mounted = useSyncExternalStore(subscribeToClient, () => true, () => false);
  const [active, setActive] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const idPrefix = useId();
  const titleId = `drawer-title-${idPrefix}`;

  // Control animation state for smooth exit/entrance
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    if (isOpen) {
      timer = setTimeout(() => setActive(true), 0);
    } else {
      timer = setTimeout(() => setActive(false), 260);
    }
    return () => clearTimeout(timer);
  }, [isOpen]);

  // Trap focus and restore focus on open/close
  useEffect(() => {
    if (!isOpen) return;

    previousActiveElementRef.current = document.activeElement as HTMLElement | null;

    // Body scroll lock
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Focus drawer or first interactive element
    const timer = setTimeout(() => {
      if (drawerRef.current) {
        const focusable = drawerRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length > 0) {
          focusable[0].focus();
        } else {
          drawerRef.current.focus();
        }
      }
    }, 20);

    return () => {
      clearTimeout(timer);
      document.body.style.overflow = originalOverflow;
      if (previousActiveElementRef.current && typeof previousActiveElementRef.current.focus === 'function') {
        previousActiveElementRef.current.focus();
      }
    };
  }, [isOpen]);

  // Escape key and Tab trapping
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && closeOnEsc) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }

      if (e.key === 'Tab' && drawerRef.current) {
        const focusables = drawerRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;

        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, closeOnEsc, onClose]);

  if (!mounted || (!isOpen && !active)) return null;

  const resolvedWidth = typeof width === 'number' ? `${width}px` : width;

  const content = (
    <>
      <FocusStyles />
      <div
        role="presentation"
        onClick={(e) => {
          if (e.target === e.currentTarget && closeOnBackdropClick) {
            onClose();
          }
        }}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1000,
          background: 'color-mix(in srgb, var(--ink) 45%, transparent)',
          backdropFilter: 'blur(2px)',
          WebkitBackdropFilter: 'blur(2px)',
          opacity: isOpen ? 1 : 0,
          transition: 'opacity 0.25s ease',
        }}
      >
        <aside
          ref={drawerRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? titleId : undefined}
          tabIndex={-1}
          className={className}
          style={{
            position: 'fixed',
            top: 0,
            bottom: 0,
            [side]: 0,
            width: resolvedWidth,
            maxWidth: '90vw',
            background: 'var(--bg-paper)',
            boxShadow: 'var(--shadow)',
            borderLeft: side === 'right' ? '1px solid var(--border)' : 'none',
            borderRight: side === 'left' ? '1px solid var(--border)' : 'none',
            display: 'flex',
            flexDirection: 'column',
            outline: 'none',
            transform: isOpen
              ? 'translateX(0)'
              : side === 'right'
              ? 'translateX(100%)'
              : 'translateX(-100%)',
            transition: 'transform 0.26s cubic-bezier(0.16, 1, 0.3, 1)',
            boxSizing: 'border-box',
            ...style,
          }}
        >
          {/* Header */}
          {(title || showCloseButton) && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px 20px',
                borderBottom: '1px solid var(--border)',
                flexShrink: 0,
              }}
            >
              {title && (
                <h2
                  id={titleId}
                  style={{
                    fontFamily: 'var(--serif-font)',
                    fontSize: 'var(--font-size-base, 16px)',
                    fontWeight: 600,
                    color: 'var(--ink)',
                    margin: 0,
                  }}
                >
                  {title}
                </h2>
              )}
              {showCloseButton && (
                <IconButton
                  aria-label="Close drawer"
                  size="sm"
                  variant="ghost"
                  onClick={onClose}
                  style={{
                    color: 'var(--ink-muted)',
                    marginLeft: 'auto',
                  }}
                >
                  <CloseIcon size={14} />
                </IconButton>
              )}
            </div>
          )}

          {/* Body */}
          <div
            style={{
              padding: '18px 20px',
              overflowY: 'auto',
              flex: 1,
              color: 'var(--ink)',
              fontFamily: 'var(--font)',
              fontSize: 'var(--font-size-sm, 14px)',
              lineHeight: 1.5,
            }}
          >
            {children}
          </div>

          {/* Footer */}
          {footer && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                gap: 8,
                padding: '12px 20px',
                borderTop: '1px solid var(--border)',
                background: 'var(--bg-app)',
                flexShrink: 0,
              }}
            >
              {footer}
            </div>
          )}
        </aside>
      </div>
    </>
  );

  return createPortal(content, document.body);
}
