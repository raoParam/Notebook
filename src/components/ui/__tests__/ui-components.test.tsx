// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Button,
  Dialog,
  Drawer,
  Dropdown,
  EmptyState,
  IconButton,
  Input,
  SearchInput,
  Tabs,
} from '../index';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('UI Foundation Components', () => {
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

  describe('Button', () => {
    it('renders text and handles clicks', async () => {
      const onClick = vi.fn();
      const container = await renderElement(
        <Button onClick={onClick} variant="primary">
          Save Note
        </Button>
      );

      const btn = container.querySelector('button');
      expect(btn).not.toBeNull();
      expect(btn?.textContent).toContain('Save Note');

      await act(async () => {
        btn?.click();
      });
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('renders loading state and prevents clicks', async () => {
      const onClick = vi.fn();
      const container = await renderElement(
        <Button onClick={onClick} isLoading>
          Loading Button
        </Button>
      );

      const btn = container.querySelector('button');
      expect(btn?.disabled).toBe(true);
      expect(btn?.getAttribute('aria-busy')).toBe('true');

      await act(async () => {
        btn?.click();
      });
      expect(onClick).not.toHaveBeenCalled();
    });

    it('renders left and right icons', async () => {
      const container = await renderElement(
        <Button
          leftIcon={<span data-testid="left-icon">L</span>}
          rightIcon={<span data-testid="right-icon">R</span>}
        >
          With Icons
        </Button>
      );

      expect(container.querySelector('[data-testid="left-icon"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="right-icon"]')).not.toBeNull();
    });
  });

  describe('IconButton', () => {
    it('renders with required aria-label and title fallback', async () => {
      const onClick = vi.fn();
      const container = await renderElement(
        <IconButton aria-label="Close" onClick={onClick}>
          <span>✕</span>
        </IconButton>
      );

      const btn = container.querySelector('button');
      expect(btn?.getAttribute('aria-label')).toBe('Close');
      expect(btn?.getAttribute('title')).toBe('Close');

      await act(async () => {
        btn?.click();
      });
      expect(onClick).toHaveBeenCalledTimes(1);
    });
  });

  describe('Input', () => {
    it('renders label, helper text and manages value', async () => {
      const onChange = vi.fn();
      const container = await renderElement(
        <Input
          label="Notebook Title"
          helperText="Enter a descriptive title"
          placeholder="My Note"
          onChange={onChange}
        />
      );

      const label = container.querySelector('label');
      expect(label?.textContent).toBe('Notebook Title');

      const input = container.querySelector('input');
      expect(input?.placeholder).toBe('My Note');

      const helper = container.querySelector('span');
      expect(helper?.textContent).toContain('Enter a descriptive title');
    });

    it('renders error state and sets aria-invalid', async () => {
      const container = await renderElement(
        <Input label="Email" error="Invalid email address" defaultValue="bad" />
      );

      const input = container.querySelector('input');
      expect(input?.getAttribute('aria-invalid')).toBe('true');

      const alert = container.querySelector('[role="alert"]');
      expect(alert?.textContent).toBe('Invalid email address');
    });
  });

  describe('SearchInput', () => {
    it('renders search input and clears value with onClear', async () => {
      const onClear = vi.fn();
      const container = await renderElement(
        <SearchInput defaultValue="initial search" onClear={onClear} />
      );

      const clearBtn = container.querySelector('button[aria-label="Clear search"]');
      expect(clearBtn).not.toBeNull();

      await act(async () => {
        (clearBtn as HTMLButtonElement).click();
      });

      expect(onClear).toHaveBeenCalledTimes(1);
      const input = container.querySelector('input');
      expect(input?.value).toBe('');
    });
  });

  describe('Dialog', () => {
    it('renders dialog in a portal with title and handles close on escape', async () => {
      const onClose = vi.fn();
      await renderElement(
        <Dialog isOpen={true} onClose={onClose} title="Delete Confirmation" description="Are you sure?">
          <p>Dialog body content</p>
        </Dialog>
      );

      const dialog = document.body.querySelector('[role="dialog"]');
      expect(dialog).not.toBeNull();
      expect(dialog?.textContent).toContain('Delete Confirmation');
      expect(dialog?.textContent).toContain('Are you sure?');
      expect(dialog?.textContent).toContain('Dialog body content');

      // Test Escape key
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });
      expect(onClose).toHaveBeenCalled();
    });

    it('does not render when isOpen is false', async () => {
      await renderElement(
        <Dialog isOpen={false} onClose={vi.fn()} title="Hidden">
          <p>Hidden</p>
        </Dialog>
      );

      const dialog = document.body.querySelector('[role="dialog"]');
      expect(dialog).toBeNull();
    });
  });

  describe('Dropdown', () => {
    it('toggles menu and handles item clicks', async () => {
      const onItemClick = vi.fn();
      const container = await renderElement(
        <Dropdown
          trigger={<button id="menu-trigger">Open Menu</button>}
          items={[
            { id: 'edit', label: 'Edit Note', onClick: onItemClick },
            { id: 'sep', label: '', divider: true },
            { id: 'del', label: 'Delete', danger: true },
          ]}
        />
      );

      const trigger = container.querySelector('#menu-trigger') as HTMLButtonElement;
      expect(trigger).not.toBeNull();

      // Click to open
      await act(async () => {
        trigger.click();
      });

      const menu = container.querySelector('[role="menu"]');
      expect(menu).not.toBeNull();

      const items = container.querySelectorAll('[role="menuitem"]');
      expect(items.length).toBe(2);

      await act(async () => {
        (items[0] as HTMLButtonElement).click();
      });

      expect(onItemClick).toHaveBeenCalledTimes(1);
    });
  });

  describe('Tabs', () => {
    it('renders tablist and switches tabs', async () => {
      const onChange = vi.fn();
      const container = await renderElement(
        <Tabs
          activeTab="tab1"
          onChange={onChange}
          items={[
            { id: 'tab1', label: 'General', badge: 3 },
            { id: 'tab2', label: 'Appearance' },
          ]}
        />
      );

      const tablist = container.querySelector('[role="tablist"]');
      expect(tablist).not.toBeNull();

      const tabs = container.querySelectorAll('[role="tab"]');
      expect(tabs.length).toBe(2);
      expect(tabs[0].getAttribute('aria-selected')).toBe('true');
      expect(tabs[1].getAttribute('aria-selected')).toBe('false');

      await act(async () => {
        (tabs[1] as HTMLButtonElement).click();
      });
      expect(onChange).toHaveBeenCalledWith('tab2');
    });
  });

  describe('Drawer', () => {
    it('renders side drawer with accessible dialog role', async () => {
      const onClose = vi.fn();
      await renderElement(
        <Drawer isOpen={true} onClose={onClose} side="right" title="Drawer Title">
          <div>Drawer Content</div>
        </Drawer>
      );

      const drawer = document.body.querySelector('[role="dialog"]');
      expect(drawer).not.toBeNull();
      expect(drawer?.textContent).toContain('Drawer Title');
      expect(drawer?.textContent).toContain('Drawer Content');
    });
  });

  describe('EmptyState', () => {
    it('renders title, description and action button', async () => {
      const onAction = vi.fn();
      const container = await renderElement(
        <EmptyState
          title="No notes yet"
          description="Create your first note to get started"
          action={{ label: 'New Note', onClick: onAction }}
        />
      );

      expect(container.textContent).toContain('No notes yet');
      expect(container.textContent).toContain('Create your first note to get started');

      const actionBtn = container.querySelector('button');
      expect(actionBtn?.textContent).toContain('New Note');

      await act(async () => {
        actionBtn?.click();
      });
      expect(onAction).toHaveBeenCalledTimes(1);
    });
  });
});
