'use client';

import React, { forwardRef, useState } from 'react';
import { FocusStyles } from './focus-styles';
import { SpinnerIcon } from './icons';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    children,
    variant = 'primary',
    size = 'md',
    isLoading = false,
    leftIcon,
    rightIcon,
    fullWidth = false,
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

  // Size specifications
  const sizeStyles: Record<ButtonSize, React.CSSProperties> = {
    sm: {
      height: 28,
      minHeight: 28,
      padding: '0 10px',
      fontSize: 'var(--font-size-xs, 12px)',
      gap: 6,
      borderRadius: 'var(--radius-sm)',
    },
    md: {
      height: 36,
      minHeight: 36,
      padding: '0 14px',
      fontSize: 'var(--font-size-sm, 13px)',
      gap: 8,
      borderRadius: 'var(--radius-control)',
    },
    lg: {
      height: 44,
      minHeight: 44,
      padding: '0 18px',
      fontSize: 'var(--font-size-base, 15px)',
      gap: 10,
      borderRadius: 'var(--radius-control)',
    },
  };

  // Base variant styles & dynamic hover colors using design-system tokens
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
      case 'danger':
        return {
          background: hovered && !isDisabled ? 'var(--danger-hover)' : 'var(--danger)',
          color: 'var(--color-action-primary-text)',
          border: '1px solid transparent',
          boxShadow: 'var(--shadow-sm)',
        };
    }
  };

  const combinedStyles: React.CSSProperties = {
    display: fullWidth ? 'flex' : 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: fullWidth ? '100%' : 'auto',
    fontFamily: 'var(--font)',
    fontWeight: 500,
    lineHeight: 1,
    cursor: isDisabled ? 'not-allowed' : 'pointer',
    opacity: isDisabled ? 0.6 : 1,
    userSelect: 'none',
    whiteSpace: 'nowrap',
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
        aria-busy={isLoading ? true : undefined}
        aria-disabled={isDisabled ? true : undefined}
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
          <SpinnerIcon size={size === 'sm' ? 13 : size === 'md' ? 15 : 18} />
        ) : (
          leftIcon && <span style={{ display: 'inline-flex', alignItems: 'center' }}>{leftIcon}</span>
        )}
        <span>{children}</span>
        {!isLoading && rightIcon && (
          <span style={{ display: 'inline-flex', alignItems: 'center' }}>{rightIcon}</span>
        )}
      </button>
    </>
  );
});

Button.displayName = 'Button';
