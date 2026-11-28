'use client';

import React, { forwardRef, useEffect, useRef, useState } from 'react';
import { CloseIcon, SearchIcon } from './icons';
import { Input, type InputProps } from './Input';

export interface SearchInputProps extends Omit<InputProps, 'startAdornment'> {
  onClear?: () => void;
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  {
    value: controlledValue,
    defaultValue,
    onChange,
    onClear,
    placeholder = 'Search…',
    endAdornment,
    onKeyDown,
    ...props
  },
  ref
) {
  const isControlled = controlledValue !== undefined;
  const [internalValue, setInternalValue] = useState<string>(
    isControlled ? String(controlledValue ?? '') : String(defaultValue ?? '')
  );
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isControlled) {
      setInternalValue(String(controlledValue ?? ''));
    }
  }, [isControlled, controlledValue]);

  const hasValue = Boolean(internalValue && internalValue.length > 0);

  const handleClear = () => {
    if (!isControlled) {
      setInternalValue('');
    }
    onClear?.();

    // Trigger synthetic change event for form listeners if element exists
    const el = inputRef.current;
    if (el) {
      el.value = '';
      const event = new Event('input', { bubbles: true });
      el.dispatchEvent(event);
      el.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape' && hasValue) {
      e.preventDefault();
      e.stopPropagation();
      handleClear();
    }
    onKeyDown?.(e);
  };

  const clearButton = hasValue ? (
    <button
      type="button"
      onClick={handleClear}
      aria-label="Clear search"
      title="Clear search"
      className="nb-focus-ring"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
        border: 'none',
        borderRadius: 'var(--radius-sm)',
        color: 'var(--ink-muted)',
        cursor: 'pointer',
        padding: 3,
        marginRight: 2,
        transition: 'color 0.15s ease, background-color 0.15s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = 'var(--ink)';
        e.currentTarget.style.backgroundColor = 'var(--hover)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = 'var(--ink-muted)';
        e.currentTarget.style.backgroundColor = 'transparent';
      }}
    >
      <CloseIcon size={12} />
    </button>
  ) : null;

  return (
    <Input
      ref={(node) => {
        inputRef.current = node;
        if (typeof ref === 'function') {
          ref(node);
        } else if (ref) {
          ref.current = node;
        }
      }}
      type="search"
      value={isControlled ? controlledValue : internalValue}
      placeholder={placeholder}
      onChange={(e) => {
        if (!isControlled) {
          setInternalValue(e.target.value);
        }
        onChange?.(e);
      }}
      onKeyDown={handleKeyDown}
      startAdornment={<SearchIcon size={15} />}
      endAdornment={
        <>
          {clearButton}
          {endAdornment}
        </>
      }
      {...props}
    />
  );
});

SearchInput.displayName = 'SearchInput';
