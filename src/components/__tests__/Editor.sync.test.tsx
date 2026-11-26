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
    expect(onUpdate).toHaveBeenCalledWith(
      {
        title: 'Synced Remote Title',
        content: 'User unsaved typing',
      },
      'note-1'
    );
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
    expect(onUpdate).toHaveBeenCalledWith(
      {
        title: 'Unsaved Local Title',
        content: 'Unsaved Local Body',
      },
      'note-1'
    );
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

  it('persists pending content edits for the original note when switching notes before 350ms', async () => {
    const updateCalls: Array<{ targetId: string; patch: { title?: string; content?: string } }> = [];
    const note1 = makeNote({ id: 'note-1', title: 'Note One', content: 'Body 1' });
    const note2 = makeNote({ id: 'note-2', title: 'Note Two', content: 'Body 2' });

    const makeParentHandler = (boundActiveId: string) =>
      (patch: Partial<Pick<Note, 'title' | 'content' | 'attachments'>>, targetNoteId?: string) => {
        updateCalls.push({ targetId: targetNoteId ?? boundActiveId, patch });
      };

    await act(async () => {
      root.render(
        <Editor
          note={note1}
          onUpdate={makeParentHandler('note-1')}
          onImportNote={vi.fn()}
          onExportPdf={vi.fn()}
          onExportMd={vi.fn()}
        />
      );
    });

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    await act(async () => {
      setReactInputValue(textarea, 'Edited Body 1 before switch');
    });
    expect(updateCalls).toHaveLength(0);

    // Switch to note-2 before 350ms expires, passing a NEW onUpdate bound to 'note-2'
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
      root.render(
        <Editor
          note={note2}
          onUpdate={makeParentHandler('note-2')}
          onImportNote={vi.fn()}
          onExportPdf={vi.fn()}
          onExportMd={vi.fn()}
        />
      );
    });

    // Pending save must flush immediately targeting 'note-1', NOT 'note-2'
    expect(updateCalls).toEqual([
      {
        targetId: 'note-1',
        patch: { title: 'Note One', content: 'Edited Body 1 before switch' },
      },
    ]);

    // Advancing past 350ms must NOT fire a duplicate or misdirected save for note-2
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(updateCalls).toHaveLength(1);
    expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Body 2');
  });

  it('persists pending title edits for the original note when switching notes before 350ms', async () => {
    const onUpdateForNote1 = vi.fn();
    const onUpdateForNote2 = vi.fn();
    const note1 = makeNote({ id: 'note-1', title: 'Old Title 1', content: 'Body 1' });
    const note2 = makeNote({ id: 'note-2', title: 'Title 2', content: 'Body 2' });

    await act(async () => {
      root.render(
        <Editor
          note={note1}
          onUpdate={onUpdateForNote1}
          onImportNote={vi.fn()}
          onExportPdf={vi.fn()}
          onExportMd={vi.fn()}
        />
      );
    });

    const titleInput = container.querySelector('input.note-title-input') as HTMLInputElement;
    await act(async () => {
      setReactInputValue(titleInput, 'Edited Title 1');
    });
    expect(onUpdateForNote1).not.toHaveBeenCalled();

    await act(async () => {
      root.render(
        <Editor
          note={note2}
          onUpdate={onUpdateForNote2}
          onImportNote={vi.fn()}
          onExportPdf={vi.fn()}
          onExportMd={vi.fn()}
        />
      );
    });

    expect(onUpdateForNote1).toHaveBeenCalledTimes(1);
    expect(onUpdateForNote1).toHaveBeenCalledWith(
      { title: 'Edited Title 1', content: 'Body 1' },
      'note-1'
    );
    expect(onUpdateForNote2).not.toHaveBeenCalled();
  });

  it('persists pending edits when the Editor unmounts before 350ms', async () => {
    const onUpdate = vi.fn();
    const note1 = makeNote({ id: 'note-1', title: 'Title', content: 'Original' });

    await act(async () => {
      root.render(
        <Editor
          note={note1}
          onUpdate={onUpdate}
          onImportNote={vi.fn()}
          onExportPdf={vi.fn()}
          onExportMd={vi.fn()}
        />
      );
    });

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    await act(async () => {
      setReactInputValue(textarea, 'Unsaved before unmount');
    });
    expect(onUpdate).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith(
      { title: 'Title', content: 'Unsaved before unmount' },
      'note-1'
    );

    // Re-create root so afterEach cleanup succeeds cleanly
    root = createRoot(container);
  });

  it('maintains ordinary 350ms debounced save timing when staying on the same note', async () => {
    const onUpdate = vi.fn();
    const note1 = makeNote({ id: 'note-1', title: 'Title', content: 'Start' });

    await act(async () => {
      root.render(
        <Editor
          note={note1}
          onUpdate={onUpdate}
          onImportNote={vi.fn()}
          onExportPdf={vi.fn()}
          onExportMd={vi.fn()}
        />
      );
    });

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    await act(async () => {
      setReactInputValue(textarea, 'Draft 1');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(onUpdate).not.toHaveBeenCalled();

    // Second edit resets the 350ms debounce window
    await act(async () => {
      setReactInputValue(textarea, 'Draft 2');
      await vi.advanceTimersByTimeAsync(349);
    });
    expect(onUpdate).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith(
      { title: 'Title', content: 'Draft 2' },
      'note-1'
    );
  });
});
