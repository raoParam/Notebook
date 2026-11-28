'use client';

import React, { useEffect, useId, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { FocusStyles } from './focus-styles';
import { IconButton } from './IconButton';
import { CloseIcon } from './icons';

function subscribeToClient() {
  return () => {};
}

export interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: string | number;
  closeOnBackdropClick?: boolean;
  closeOnEsc?: boolean;
  showCloseButton?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function Dialog({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  maxWidth = 540,
  closeOnBackdropClick = true,
  closeOnEsc = true,
  showCloseButton = true,
  className = '',
  style,
}: DialogProps) {
  const mounted = useSyncExternalStore(subscribeToClient, () => true, () => false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const idPrefix = useId();
  const titleId = `dialog-title-${idPrefix}`;
  const descId = `dialog-desc-${idPrefix}`;

  // Trap focus and restore focus on open/close
  useEffect(() => {
    if (!isOpen) return;

    previousActiveElementRef.current = document.activeElement as HTMLElement | null;

    // Body scroll lock
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Focus the dialog panel or first focusable element
    const timer = setTimeout(() => {
      if (dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length > 0) {
          focusable[0].focus();
        } else {
          dialogRef.current.focus();
        }
      }
    }, 10);

    return () => {
      clearTimeout(timer);
      document.body.style.overflow = originalOverflow;
      if (previousActiveElementRef.current && typeof previousActiveElementRef.current.focus === 'function') {
        previousActiveElementRef.current.focus();
      }
    };
  }, [isOpen]);

  // Handle Escape key and Tab focus trapping
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && closeOnEsc) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }

      if (e.key === 'Tab' && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;

        const firstElement = focusables[0];
        const lastElement = focusables[focusables.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, closeOnEsc, onClose]);

  if (!mounted || !isOpen) return null;

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
          background: 'color-mix(in srgb, var(--ink) 48%, transparent)',
          backdropFilter: 'blur(2px)',
          WebkitBackdropFilter: 'blur(2px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px',
          animation: 'nbFadeIn 0.15s ease-out forwards',
        }}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? titleId : undefined}
          aria-describedby={description ? descId : undefined}
          tabIndex={-1}
          className={`nb-dialog-panel ${className}`.trim()}
          style={{
            position: 'relative',
            width: '100%',
            maxWidth: typeof maxWidth === 'number' ? `${maxWidth}px` : maxWidth,
            maxHeight: 'calc(100vh - 48px)',
            background: 'var(--bg-paper)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-panel)',
            boxShadow: 'var(--shadow)',
            display: 'flex',
            flexDirection: 'column',
            outline: 'none',
            animation: 'nbModalEnter 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards',
            boxSizing: 'border-box',
            ...style,
          }}
        >
          {/* Header */}
          {(title || showCloseButton) && (
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                padding: '18px 22px 14px',
                borderBottom: '1px solid var(--border)',
                flexShrink: 0,
              }}
            >
              <div style={{ flex: 1, paddingRight: 12 }}>
                {title && (
                  <h2
                    id={titleId}
                    style={{
                      fontFamily: 'var(--serif-font)',
                      fontSize: 'var(--font-size-lg, 18px)',
                      fontWeight: 600,
                      color: 'var(--ink)',
                      margin: 0,
                      lineHeight: 1.3,
                    }}
                  >
                    {title}
                  </h2>
                )}
                {description && (
                  <p
                    id={descId}
                    style={{
                      fontFamily: 'var(--font)',
                      fontSize: 'var(--font-size-sm, 13px)',
                      color: 'var(--ink-soft)',
                      margin: '4px 0 0',
                      lineHeight: 1.45,
                    }}
                  >
                    {description}
                  </p>
                )}
              </div>

              {showCloseButton && (
                <IconButton
                  aria-label="Close dialog"
                  size="sm"
                  variant="ghost"
                  onClick={onClose}
                  style={{
                    color: 'var(--ink-muted)',
                    marginTop: -2,
                    marginRight: -4,
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
              padding: '20px 22px',
              overflowY: 'auto',
              flex: 1,
              color: 'var(--ink)',
              fontFamily: 'var(--font)',
              fontSize: 'var(--font-size-base, 14px)',
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
                padding: '14px 22px',
                borderTop: '1px solid var(--border)',
                background: 'var(--bg-app)',
                borderRadius: '0 0 var(--radius-panel) var(--radius-panel)',
                flexShrink: 0,
              }}
            >
              {footer}
            </div>
          )}
        </div>
      </div>
    </>
  );

  return createPortal(content, document.body);
}
