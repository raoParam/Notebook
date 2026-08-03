'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { Note } from '@/lib/db';

interface MarkdownPreviewProps {
  note: Note;
}

export function MarkdownPreview({ note }: MarkdownPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState('');

  useEffect(() => {
    renderContent(note).then(setHtml);
  }, [note.content, note.attachments]);

  return (
    <div
      ref={containerRef}
      className="prose-notebook"
      style={{
        position: 'absolute',
        inset: 0,
        overflowY: 'auto',
        padding: '16px 24px',
        background: 'var(--bg-paper)',
        color: 'var(--ink)',
      }}
      dangerouslySetInnerHTML={{ __html: html || '<p style="color:var(--ink-muted);font-style:italic">Nothing to preview</p>' }}
    />
  );
}

async function renderContent(note: Note): Promise<string> {
  if (!note.content.trim()) return '';

  const { marked } = await import('marked');
  marked.setOptions({ breaks: true, gfm: true });

  // Resolve attachment labels to data URLs
  let content = resolveAttachments(note.content, note.attachments);

  // Extract math blocks before markdown parsing to protect them
  const mathBlocks: Array<{ id: string; math: string; display: boolean }> = [];

  content = content.replace(/\$\$([\s\S]+?)\$\$/g, (_, math) => {
    const id = `MATH_B_${mathBlocks.length}`;
    mathBlocks.push({ id, math: math.trim(), display: true });
    return id;
  });
  content = content.replace(/\$(?!\s)([^$]*?\S)\$/g, (_, math) => {
    const id = `MATH_I_${mathBlocks.length}`;
    mathBlocks.push({ id, math: math.trim(), display: false });
    return id;
  });

  let html = await marked.parse(content);

  // Restore math with KaTeX
  if (mathBlocks.length > 0 && typeof window !== 'undefined') {
    const katex = await import('katex');
    for (const { id, math, display } of mathBlocks) {
      try {
        const rendered = katex.default.renderToString(math, {
          displayMode: display,
          throwOnError: false,
        });
        html = html.replace(id, rendered);
      } catch {
        html = html.replace(id, `<code>${escHtml(math)}</code>`);
      }
    }
  }

  return html;
}

function resolveAttachments(
  content: string,
  attachments: Record<string, import('@/lib/db').AttachmentEntry>
): string {
  return content.replace(/!\[([^\]\r\n]+)\](?!\()/g, (match, label) => {
    const att = attachments[label.trim()];
    return att ? `![${label}](${att.data})` : match;
  });
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
