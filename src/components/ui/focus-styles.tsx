'use client';

import React from 'react';

/**
 * FocusStyles hoists standard notebook focus-ring CSS rules into the document <head>.
 * This ensures strong keyboard focus rings (outline: 2px solid var(--color-focus-ring))
 * across all interactive UI components without manual class duplication.
 */
export function FocusStyles() {
  return (
    <style href="notebook-ui-focus-styles" precedence="default">{`
      .nb-focus-ring:focus-visible {
        outline: 2px solid var(--color-focus-ring) !important;
        outline-offset: 2px !important;
      }
      .nb-focus-within:focus-within {
        outline: 2px solid var(--color-focus-ring) !important;
        outline-offset: 1px !important;
        border-color: var(--color-focus-ring) !important;
      }
      .nb-focus-within-error:focus-within {
        outline: 2px solid var(--danger) !important;
        outline-offset: 1px !important;
        border-color: var(--danger) !important;
      }
      @keyframes nbFadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes nbModalEnter {
        from { opacity: 0; transform: scale(0.96) translateY(6px); }
        to { opacity: 1; transform: scale(1) translateY(0); }
      }
    `}</style>
  );
}
