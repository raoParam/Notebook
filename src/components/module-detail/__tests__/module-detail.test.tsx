// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Notebook } from '@/types/workspace';
import {
  stripMarkdown,
  formatNotebookDate,
  NotebookCard,
  RenameNotebookDialog,
  DeleteNotebookDialog,
} from '../index';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('Module Detail Components & Helpers', () => {
  const roots: Array<{ unmount: () => Promise<void> }> = [];

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(async () => {
    while (roots.length > 0) {
      const item = roots.pop();
      if (item) await item.unmount();
    }
    vi.restoreAllMocks();
  });

  async function renderElement(element: React.ReactElement) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    let root!: Root;
    await act(async () => {
      root = createRoot(container);
      root.render(element);
    });
    roots.push({
      unmount: async () => {
        await act(async () => {
          root.unmount();
        });
        container.remove();
      },
    });
    return container;
  }

  describe('stripMarkdown', () => {
    it('cleans headers, bold, italics, backticks, links, and HTML tags', () => {
      const raw = '# Header 1\n\n**Bold text** and *italic* and `code` with <span class="tag">HTML</span> and [Link](https://example.com)';
      const cleaned = stripMarkdown(raw);
      expect(cleaned).toBe('Header 1 Bold text and italic and code with HTML and Link');
    });

    it('removes fenced code blocks entirely', () => {
      const raw = 'Intro paragraph\n```ts\nconst x = 1;\n```\nAfter code block';
      const cleaned = stripMarkdown(raw);
      expect(cleaned).toBe('Intro paragraph After code block');
    });

    it('handles empty or non-string input safely', () => {
      expect(stripMarkdown('')).toBe('Empty notebook');
      expect(stripMarkdown('   ')).toBe('Empty notebook');
    });

    it('truncates content exceeding maxLength with ellipsis', () => {
      const longText = 'A'.repeat(200);
      const cleaned = stripMarkdown(longText, 50);
      expect(cleaned.length).toBeLessThanOrEqual(52);
      expect(cleaned.endsWith('…')).toBe(true);
    });
  });

  describe('formatNotebookDate', () => {
    it('formats valid ISO dates', () => {
      const formatted = formatNotebookDate('2026-11-28T12:00:00.000Z');
      expect(formatted).toContain('Nov');
      expect(formatted).toContain('2026');
    });

    it('returns fallback for invalid dates', () => {
      expect(formatNotebookDate('invalid-date')).toBe('Recently');
      expect(formatNotebookDate('')).toBe('Recently');
    });
  });

  describe('NotebookCard', () => {
    const mockNote: Notebook = {
      id: 'test-note-1',
      title: 'Design Specifications',
      content: '## Executive Summary\n\nDetailed specifications for the redesign.',
      attachments: {},
      createdAt: '2026-11-20T10:00:00.000Z',
      updatedAt: '2026-11-28T12:00:00.000Z',
      contentHash: 'abc123hash',
      moduleId: 'mod-1',
      isPinned: true,
    };

    it('renders notebook title, preview snippet, and pinned badge', async () => {
      const container = await renderElement(
        <NotebookCard
          notebook={mockNote}
          onOpen={vi.fn()}
          onRename={vi.fn()}
          onMove={vi.fn()}
          onDelete={vi.fn()}
        />
      );

      expect(container.textContent).toContain('Design Specifications');
      expect(container.textContent).toContain('Executive Summary');
      expect(container.textContent).toContain('Pinned');
      expect(container.textContent).toContain('Updated');
    });

    it('triggers onOpen when clicked or on Enter key', async () => {
      const onOpen = vi.fn();
      const container = await renderElement(
        <NotebookCard
          notebook={mockNote}
          onOpen={onOpen}
          onRename={vi.fn()}
          onMove={vi.fn()}
          onDelete={vi.fn()}
        />
      );

      const card = container.querySelector('[role="button"]') as HTMLElement;
      expect(card).not.toBeNull();

      await act(async () => {
        card.click();
      });
      expect(onOpen).toHaveBeenCalledWith('test-note-1');

      await act(async () => {
        card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      });
      expect(onOpen).toHaveBeenCalledTimes(2);
    });
  });

  describe('RenameNotebookDialog', () => {
    const mockNote: Notebook = {
      id: 'test-note-1',
      title: 'Old Title',
      content: 'Some note text',
      attachments: {},
      createdAt: '2026-11-20T10:00:00.000Z',
      updatedAt: '2026-11-28T12:00:00.000Z',
      contentHash: 'hash',
      moduleId: 'mod-1',
    };

    it('allows typing new title and saving', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      const onClose = vi.fn();

      await renderElement(
        <RenameNotebookDialog
          isOpen={true}
          notebook={mockNote}
          onClose={onClose}
          onSave={onSave}
        />
      );

      const input = document.querySelector('input') as HTMLInputElement;
      expect(input).not.toBeNull();
      expect(input.value).toBe('Old Title');

      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;

      await act(async () => {
        nativeInputValueSetter?.call(input, 'New Title');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });

      const saveBtn = Array.from(document.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Save')
      );
      expect(saveBtn).not.toBeUndefined();

      await act(async () => {
        saveBtn?.click();
      });

      expect(onSave).toHaveBeenCalledWith('test-note-1', 'New Title');
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('DeleteNotebookDialog', () => {
    const mockNote: Notebook = {
      id: 'test-note-delete',
      title: 'Note To Remove',
      content: '',
      attachments: {},
      createdAt: '2026-11-20T10:00:00.000Z',
      updatedAt: '2026-11-28T12:00:00.000Z',
      contentHash: 'hash',
      moduleId: 'mod-1',
    };

    it('confirms deletion on confirm button click', async () => {
      const onConfirm = vi.fn().mockResolvedValue(undefined);
      const onClose = vi.fn();

      await renderElement(
        <DeleteNotebookDialog
          isOpen={true}
          notebook={mockNote}
          onClose={onClose}
          onConfirm={onConfirm}
        />
      );

      const deleteBtn = Array.from(document.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Delete')
      );
      expect(deleteBtn).not.toBeUndefined();

      await act(async () => {
        deleteBtn?.click();
      });

      expect(onConfirm).toHaveBeenCalledWith('test-note-delete');
      expect(onClose).toHaveBeenCalled();
    });
  });
});
