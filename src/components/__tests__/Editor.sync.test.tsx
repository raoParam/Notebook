// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '@/lib/db';
import { Editor } from '@/components/Editor';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/components/MarkdownPreview', () => ({
  MarkdownPreview: ({ note }: { note: Note }) => (
    <div data-testid="mock-preview">{note.content}</div>
  ),
}));

vi.mock('@/components/DrawingCanvas', () => ({
  DrawingCanvas: () => null,
}));

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: 'note-1',
    title: 'Initial Title',
    content: 'Initial body',
    attachments: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    contentHash: 'hash-1',
    ...overrides,
  };
}

function setReactInputValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  descriptor?.set?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('Editor unsaved-changes protection during incoming sync updates', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  it('preserves unsaved local content and flushes it when an incoming sync update arrives during the 350ms debounce', async () => {
    const onUpdate = vi.fn();
    const initialNote = makeNote();

    await act(async () => {
      root.render(
        <Editor
          note={initialNote}
          onUpdate={onUpdate}
          onImportNote={vi.fn()}
          onExportPdf={vi.fn()}
          onExportMd={vi.fn()}
        />
      );
    });

    const titleInput = container.querySelector('input.note-title-input') as HTMLInputElement;
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;

    // User edits content (within 350ms debounce window, not yet saved)
    await act(async () => {
      setReactInputValue(textarea, 'User unsaved typing');
    });
    expect(onUpdate).not.toHaveBeenCalled();

    // Advance 200ms (still inside 350ms debounce) and simulate incoming sync updating both title and content
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    const syncedNote = makeNote({
      title: 'Synced Remote Title',
      content: 'Synced Remote Body That Must Not Clobber Unsaved Content',
      updatedAt: '2026-01-02T00:00:00.000Z',
      contentHash: 'hash-2',
    });

    await act(async () => {
      root.render(
        <Editor
          note={syncedNote}
          onUpdate={onUpdate}
          onImportNote={vi.fn()}
          onExportPdf={vi.fn()}
          onExportMd={vi.fn()}
        />
      );
    });

    // Unsaved local content MUST still be in the editor; non-dirty title can update cleanly
    expect(textarea.value).toBe('User unsaved typing');
    expect(titleInput.value).toBe('Synced Remote Title');

    // Finish remaining 150ms of the 350ms debounce
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith({
      title: 'Synced Remote Title',
      content: 'User unsaved typing',
    });
  });

  it('preserves unsaved local title as well when both title and content are dirty during incoming sync', async () => {
    const onUpdate = vi.fn();
    const initialNote = makeNote();

    await act(async () => {
      root.render(
        <Editor
          note={initialNote}
          onUpdate={onUpdate}
          onImportNote={vi.fn()}
          onExportPdf={vi.fn()}
          onExportMd={vi.fn()}
        />
      );
    });

    const titleInput = container.querySelector('input.note-title-input') as HTMLInputElement;
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;

    await act(async () => {
      setReactInputValue(titleInput, 'Unsaved Local Title');
      setReactInputValue(textarea, 'Unsaved Local Body');
    });

    const syncedNote = makeNote({
      title: 'Remote Title',
      content: 'Remote Body',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });

    await act(async () => {
      root.render(
        <Editor
          note={syncedNote}
          onUpdate={onUpdate}
          onImportNote={vi.fn()}
          onExportPdf={vi.fn()}
          onExportMd={vi.fn()}
        />
      );
    });

    expect(titleInput.value).toBe('Unsaved Local Title');
    expect(textarea.value).toBe('Unsaved Local Body');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith({
      title: 'Unsaved Local Title',
      content: 'Unsaved Local Body',
    });
  });

  it('accepts incoming synced changes normally when there are no unsaved local edits', async () => {
    const onUpdate = vi.fn();
    const initialNote = makeNote();

    await act(async () => {
      root.render(
        <Editor
          note={initialNote}
          onUpdate={onUpdate}
          onImportNote={vi.fn()}
          onExportPdf={vi.fn()}
          onExportMd={vi.fn()}
        />
      );
    });

    const syncedNote = makeNote({
      title: 'Remote Title',
      content: 'Remote Body',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });

    await act(async () => {
      root.render(
        <Editor
          note={syncedNote}
          onUpdate={onUpdate}
          onImportNote={vi.fn()}
          onExportPdf={vi.fn()}
          onExportMd={vi.fn()}
        />
      );
    });

    const titleInput = container.querySelector('input.note-title-input') as HTMLInputElement;
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(titleInput.value).toBe('Remote Title');
    expect(textarea.value).toBe('Remote Body');
    expect(onUpdate).not.toHaveBeenCalled();
  });
});
