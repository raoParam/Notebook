'use client';

import React, { forwardRef, useState } from 'react';
import { FocusStyles } from './focus-styles';
import { SpinnerIcon } from './icons';

export type IconButtonVariant = 'ghost' | 'outline' | 'secondary' | 'primary';
export type IconButtonSize = 'sm' | 'md' | 'lg';

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required accessible label for screen readers */
  'aria-label': string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  isLoading?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    children,
    'aria-label': ariaLabel,
    variant = 'ghost',
    size = 'md',
    isLoading = false,
    title,
    disabled = false,
    type = 'button',
    className = '',
    style,
    onMouseEnter,
    onMouseLeave,
    ...props
  },
  ref
) {
  const [hovered, setHovered] = useState(false);
  const isDisabled = disabled || isLoading;

  // Exact sizes for square icon buttons
  const sizeStyles: Record<IconButtonSize, React.CSSProperties> = {
    sm: {
      width: 28,
      height: 28,
      minWidth: 28,
      minHeight: 28,
      borderRadius: 'var(--radius-sm)',
    },
    md: {
      width: 36,
      height: 36,
      minWidth: 36,
      minHeight: 36,
      borderRadius: 'var(--radius-control)',
    },
    lg: {
      width: 44,
      height: 44,
      minWidth: 44,
      minHeight: 44,
      borderRadius: 'var(--radius-control)',
    },
  };

  const getVariantStyles = (): React.CSSProperties => {
    switch (variant) {
      case 'primary':
        return {
          background: hovered && !isDisabled
            ? 'var(--color-action-primary-hover)'
            : 'var(--color-action-primary)',
          color: 'var(--color-action-primary-text)',
          border: '1px solid transparent',
          boxShadow: 'var(--shadow-sm)',
        };
      case 'secondary':
        return {
          background: hovered && !isDisabled ? 'var(--hover)' : 'var(--bg-sidebar)',
          color: 'var(--ink)',
          border: '1px solid var(--border)',
        };
      case 'outline':
        return {
          background: hovered && !isDisabled ? 'var(--hover)' : 'transparent',
          color: 'var(--ink)',
          border: '1px solid var(--border)',
        };
      case 'ghost':
        return {
          background: hovered && !isDisabled ? 'var(--hover)' : 'transparent',
          color: hovered && !isDisabled ? 'var(--ink)' : 'var(--ink-soft)',
          border: '1px solid transparent',
        };
    }
  };

  const combinedStyles: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    cursor: isDisabled ? 'not-allowed' : 'pointer',
    opacity: isDisabled ? 0.6 : 1,
    userSelect: 'none',
    transition: 'background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease, opacity 0.15s ease',
    ...sizeStyles[size],
    ...getVariantStyles(),
    ...style,
  };

  return (
    <>
      <FocusStyles />
      <button
        ref={ref}
        type={type}
        disabled={isDisabled}
        aria-label={ariaLabel}
        aria-busy={isLoading ? true : undefined}
        aria-disabled={isDisabled ? true : undefined}
        title={title ?? ariaLabel}
        className={`nb-focus-ring ${className}`.trim()}
        style={combinedStyles}
        onMouseEnter={(e) => {
          setHovered(true);
          onMouseEnter?.(e);
        }}
        onMouseLeave={(e) => {
          setHovered(false);
          onMouseLeave?.(e);
        }}
        {...props}
      >
        {isLoading ? (
          <SpinnerIcon size={size === 'sm' ? 14 : size === 'md' ? 16 : 20} />
        ) : (
          children
        )}
      </button>
    </>
  );
});

IconButton.displayName = 'IconButton';
