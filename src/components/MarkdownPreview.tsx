'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { Note } from '@/lib/db';
import { renderSafeMarkdown } from '@/lib/markdown';

interface MarkdownPreviewProps {
  note: Note;
}

export function MarkdownPreview({ note }: MarkdownPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState('');

  useEffect(() => {
    let cancelled = false;
    renderSafeMarkdown(note.content, note.attachments).then((rendered) => {
      if (!cancelled) {
        setHtml(rendered);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [note.content, note.attachments]);

  return (
    <div
      ref={containerRef}
      className="prose-notebook"
      style={{
        position: 'absolute',
        inset: 0,
        overflowY: 'auto',
        padding: '16px 24px 140px', // Extra bottom space for phone browser status bar
        background: 'var(--bg-paper)',
        color: 'var(--ink)',
      }}
      dangerouslySetInnerHTML={{ __html: html || '<p style="color:var(--ink-muted);font-style:italic">Nothing to preview</p>' }}
    />
  );
}
