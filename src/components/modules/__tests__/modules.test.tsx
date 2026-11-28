// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Module } from '@/types/workspace';
import { DEFAULT_MODULE_ID } from '@/types/workspace';
import { ModuleCard } from '../ModuleCard';
import { CreateModuleDialog, RenameModuleDialog } from '../ModuleDialog';
import { DeleteModuleDialog } from '../DeleteModuleDialog';
import { ModulesHeader } from '../ModulesHeader';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('Modules Components', () => {
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

  function changeInput(input: HTMLInputElement, value: string) {
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (nativeSetter) {
      nativeSetter.call(input, value);
    } else {
      input.value = value;
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  const mockModule: Module = {
    id: 'mod-1',
    name: 'Philosophy',
    slug: 'philosophy',
    description: 'Notes on ethics and epistemology',
    color: 'var(--accent)',
    order: 1,
    isArchived: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  };

  describe('ModuleCard', () => {
    it('renders module title, description, and notebook count', async () => {
      const handleOpen = vi.fn();
      const container = await renderElement(
        <ModuleCard
          module={mockModule}
          notebookCount={5}
          onOpen={handleOpen}
        />
      );

      expect(container.textContent).toContain('Philosophy');
      expect(container.textContent).toContain('Notes on ethics and epistemology');
      expect(container.textContent).toContain('5 notebooks');

      const card = container.querySelector('[role="button"]') as HTMLElement;
      await act(async () => {
        card.click();
      });
      expect(handleOpen).toHaveBeenCalledWith(mockModule);
    });

    it('renders compact variant for recently opened section', async () => {
      const handleOpen = vi.fn();
      const container = await renderElement(
        <ModuleCard
          module={mockModule}
          notebookCount={3}
          variant="compact"
          onOpen={handleOpen}
        />
      );

      expect(container.textContent).toContain('Philosophy');
      expect(container.textContent).toContain('3 notebooks');

      const card = container.querySelector('[role="button"]') as HTMLElement;
      await act(async () => {
        card.click();
      });
      expect(handleOpen).toHaveBeenCalledWith(mockModule);
    });

    it('renders default badge when module id is DEFAULT_MODULE_ID', async () => {
      const defaultMod: Module = {
        ...mockModule,
        id: DEFAULT_MODULE_ID,
        name: 'General',
      };

      const container = await renderElement(
        <ModuleCard module={defaultMod} onOpen={vi.fn()} />
      );

      expect(container.textContent).toContain('General');
      expect(container.textContent).toContain('Default');
    });

    it('renders archived badge when module isArchived is true', async () => {
      const archivedMod: Module = {
        ...mockModule,
        isArchived: true,
      };

      const container = await renderElement(
        <ModuleCard module={archivedMod} onOpen={vi.fn()} />
      );

      expect(container.textContent).toContain('Archived');
    });
  });

  describe('CreateModuleDialog', () => {
    it('submits valid module details and color', async () => {
      const handleSubmit = vi.fn();
      const handleClose = vi.fn();

      await renderElement(
        <CreateModuleDialog
          isOpen={true}
          onClose={handleClose}
          onSubmit={handleSubmit}
        />
      );

      const nameInput = document.querySelector('input[placeholder*="Work Projects"]') as HTMLInputElement;
      expect(nameInput).toBeTruthy();

      await act(async () => {
        changeInput(nameInput, 'Quantum Physics');
      });

      const submitBtn = Array.from(document.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Create Module')
      );
      expect(submitBtn).toBeTruthy();

      await act(async () => {
        submitBtn?.click();
      });

      expect(handleSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Quantum Physics',
        })
      );
      expect(handleClose).toHaveBeenCalled();
    });

    it('shows error when submitting empty name', async () => {
      const handleSubmit = vi.fn();
      await renderElement(
        <CreateModuleDialog
          isOpen={true}
          onClose={vi.fn()}
          onSubmit={handleSubmit}
        />
      );

      const submitBtn = Array.from(document.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Create Module')
      );
      await act(async () => {
        submitBtn?.click();
      });

      expect(handleSubmit).not.toHaveBeenCalled();
      expect(document.body.textContent).toContain('Module name is required');
    });
  });

  describe('RenameModuleDialog', () => {
    it('prefills current name and submits updated name', async () => {
      const handleSubmit = vi.fn();
      const handleClose = vi.fn();

      await renderElement(
        <RenameModuleDialog
          module={mockModule}
          isOpen={true}
          onClose={handleClose}
          onSubmit={handleSubmit}
        />
      );

      const nameInput = document.querySelector('input[value="Philosophy"]') as HTMLInputElement;
      expect(nameInput).toBeTruthy();

      await act(async () => {
        changeInput(nameInput, 'Modern Philosophy');
      });

      const saveBtn = Array.from(document.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Save Changes')
      );
      await act(async () => {
        saveBtn?.click();
      });

      expect(handleSubmit).toHaveBeenCalledWith('mod-1', 'Modern Philosophy');
      expect(handleClose).toHaveBeenCalled();
    });
  });

  describe('DeleteModuleDialog', () => {
    it('prevents deleting default module', async () => {
      const defaultMod: Module = {
        ...mockModule,
        id: DEFAULT_MODULE_ID,
        name: 'General',
      };
      const handleConfirm = vi.fn();

      await renderElement(
        <DeleteModuleDialog
          module={defaultMod}
          isOpen={true}
          onClose={vi.fn()}
          onConfirm={handleConfirm}
        />
      );

      expect(document.body.textContent).toContain('Cannot Delete Default Module');
      const deleteButtons = Array.from(document.querySelectorAll('button')).filter((b) =>
        b.textContent?.includes('Delete Module')
      );
      expect(deleteButtons.length).toBe(0);
    });

    it('confirms deletion for custom module and explains notebook reassignment', async () => {
      const handleConfirm = vi.fn();
      const handleClose = vi.fn();

      await renderElement(
        <DeleteModuleDialog
          module={mockModule}
          notebookCount={4}
          isOpen={true}
          onClose={handleClose}
          onConfirm={handleConfirm}
        />
      );

      expect(document.body.textContent).toContain('Delete Module');
      expect(document.body.textContent).toContain('4 notebooks');
      expect(document.body.textContent).toContain('General');

      const deleteBtn = Array.from(document.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Delete Module')
      );
      await act(async () => {
        deleteBtn?.click();
      });

      expect(handleConfirm).toHaveBeenCalledWith('mod-1');
      expect(handleClose).toHaveBeenCalled();
    });
  });

  describe('ModulesHeader', () => {
    it('renders module count and triggers new module action', async () => {
      const handleNew = vi.fn();
      const container = await renderElement(
        <ModulesHeader totalModules={7} onNewModule={handleNew} />
      );

      expect(container.textContent).toContain('Notebook');
      expect(container.textContent).toContain('Modules');
      expect(container.textContent).toContain('7 modules');
      expect(container.textContent).toContain('Back to Editor');

      const newBtn = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('New Module')
      );
      await act(async () => {
        newBtn?.click();
      });

      expect(handleNew).toHaveBeenCalled();
    });
  });
});
