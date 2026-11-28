'use client';

import React, { forwardRef, useId } from 'react';
import { FocusStyles } from './focus-styles';

export type InputSize = 'sm' | 'md' | 'lg';

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  error?: string;
  helperText?: string;
  startAdornment?: React.ReactNode;
  endAdornment?: React.ReactNode;
  inputSize?: InputSize;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    id,
    label,
    error,
    helperText,
    startAdornment,
    endAdornment,
    inputSize = 'md',
    disabled = false,
    className = '',
    style,
    ...props
  },
  ref
) {
  const generatedId = useId();
  const inputId = id ?? `input-${generatedId}`;
  const errorId = `${inputId}-error`;
  const helperId = `${inputId}-helper`;

  const sizeStyles: Record<InputSize, { containerHeight: number; padding: string; fontSize: string }> = {
    sm: {
      containerHeight: 28,
      padding: '0 8px',
      fontSize: 'var(--font-size-xs, 12px)',
    },
    md: {
      containerHeight: 36,
      padding: '0 11px',
      fontSize: 'var(--font-size-sm, 13px)',
    },
    lg: {
      containerHeight: 44,
      padding: '0 14px',
      fontSize: 'var(--font-size-base, 15px)',
    },
  };

  const currentSize = sizeStyles[inputSize];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, width: '100%', ...style }}>
      <FocusStyles />
      {label && (
        <label
          htmlFor={inputId}
          style={{
            fontSize: 'var(--font-size-xs, 12px)',
            fontWeight: 500,
            color: error ? 'var(--danger)' : 'var(--ink-soft)',
            fontFamily: 'var(--font)',
          }}
        >
          {label}
        </label>
      )}

      <div
        className={error ? 'nb-focus-within-error' : 'nb-focus-within'}
        style={{
          display: 'flex',
          alignItems: 'center',
          height: currentSize.containerHeight,
          padding: currentSize.padding,
          borderRadius: 'var(--radius-control)',
          background: disabled ? 'var(--bg-sidebar)' : 'var(--bg-paper)',
          border: `1px solid ${error ? 'var(--danger)' : 'var(--border)'}`,
          opacity: disabled ? 0.65 : 1,
          transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
          boxSizing: 'border-box',
          gap: 7,
        }}
      >
        {startAdornment && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              color: 'var(--ink-muted)',
              flexShrink: 0,
            }}
          >
            {startAdornment}
          </span>
        )}

        <input
          ref={ref}
          id={inputId}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : helperText ? helperId : undefined}
          className={className}
          style={{
            flex: 1,
            minWidth: 0,
            width: '100%',
            height: '100%',
            border: 'none',
            outline: 'none',
            background: 'transparent',
            color: 'var(--ink)',
            fontFamily: 'var(--font)',
            fontSize: currentSize.fontSize,
            lineHeight: 1.5,
          }}
          {...props}
        />

        {endAdornment && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              color: 'var(--ink-muted)',
              flexShrink: 0,
            }}
          >
            {endAdornment}
          </span>
        )}
      </div>

      {error ? (
        <span
          id={errorId}
          role="alert"
          style={{
            fontSize: 'var(--font-size-xs, 12px)',
            color: 'var(--danger)',
            fontFamily: 'var(--font)',
            marginTop: 1,
          }}
        >
          {error}
        </span>
      ) : helperText ? (
        <span
          id={helperId}
          style={{
            fontSize: 'var(--font-size-xs, 12px)',
            color: 'var(--ink-muted)',
            fontFamily: 'var(--font)',
            marginTop: 1,
          }}
        >
          {helperText}
        </span>
      ) : null}
    </div>
  );
});

Input.displayName = 'Input';
