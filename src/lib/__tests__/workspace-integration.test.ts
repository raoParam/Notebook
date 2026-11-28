// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db, DEFAULT_MODULE_ID, DEFAULT_MODULE_NAME } from '@/lib/db';
import {
  createModule,
  deleteModule,
  ensureDefaultModule,
  getModuleBySlugOrId,
  getNotebooksByModule,
  getRecentModules,
  recordModuleOpen,
  slugify,
} from '@/lib/workspace';

describe('Workspace Integration & Regression Review', () => {
  beforeEach(async () => {
    localStorage.clear();
  });

  afterEach(async () => {
    localStorage.clear();
    await Dexie.delete('NotebookDB');
  });

  it('guarantees ensureDefaultModule creates General module on a blank database', async () => {
    const mod = await ensureDefaultModule();
    expect(mod.id).toBe(DEFAULT_MODULE_ID);
    expect(mod.name).toBe(DEFAULT_MODULE_NAME);
    expect(mod.slug).toBe('general');

    const inDb = await db.modules.get(DEFAULT_MODULE_ID);
    expect(inDb).toBeDefined();
    expect(inDb?.id).toBe(DEFAULT_MODULE_ID);
  });

  it('prunes deleted and invalid module IDs from localStorage (self-healing)', async () => {
    const mod1 = await createModule({ name: 'Work' });
    const mod2 = await createModule({ name: 'Personal' });

    recordModuleOpen(mod1.id);
    recordModuleOpen(mod2.id);
    recordModuleOpen('non-existent-module-id');

    // Retrieve recent modules: should filter out non-existent-module-id and self-heal localStorage
    const recents = await getRecentModules(4);
    expect(recents.map((m) => m.id)).toEqual([mod2.id, mod1.id]);

    const storedRaw = localStorage.getItem('nb-recent-modules');
    const stored = JSON.parse(storedRaw || '[]');
    expect(stored).not.toContain('non-existent-module-id');
    expect(stored).toContain(mod1.id);
    expect(stored).toContain(mod2.id);

    // Deleting mod1 should prune it from localStorage
    await deleteModule(mod1.id);
    const storedAfterDelete = JSON.parse(localStorage.getItem('nb-recent-modules') || '[]');
    expect(storedAfterDelete).not.toContain(mod1.id);
  });

  it('reassigns all notebooks to DEFAULT_MODULE_ID when deleting a module without losing content', async () => {
    const mod = await createModule({ name: 'Temporary Module' });

    await db.notes.add({
      id: 'note-in-temp',
      title: 'Important Data',
      content: 'Do not lose this markdown content',
      attachments: {
        att1: { name: 'file.png', data: 'data:image/png;base64,123', createdAt: '2026-01-01T00:00:00.000Z' },
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      contentHash: 'hash-abc',
      moduleId: mod.id,
      isArchived: false,
      isPinned: true,
    });

    await deleteModule(mod.id);

    const reassignedNote = await db.notes.get('note-in-temp');
    expect(reassignedNote).toBeDefined();
    expect(reassignedNote?.moduleId).toBe(DEFAULT_MODULE_ID);
    expect(reassignedNote?.title).toBe('Important Data');
    expect(reassignedNote?.content).toBe('Do not lose this markdown content');
    expect(reassignedNote?.attachments.att1.name).toBe('file.png');
    expect(reassignedNote?.isPinned).toBe(true);

    // Module itself must be deleted
    expect(await db.modules.get(mod.id)).toBeUndefined();
  });

  it('prevents deleting the default General module', async () => {
    await ensureDefaultModule();
    await expect(deleteModule(DEFAULT_MODULE_ID)).rejects.toThrow(
      'Cannot delete the default module'
    );
  });

  it('slugify handles special characters, unicode, and disambiguates duplicate titles', async () => {
    expect(slugify('Work & Projects!')).toBe('work-projects');
    expect(slugify('🚀 Launch 2026')).toBe('launch-2026');
    expect(slugify('   ')).toBe('module');

    const modA = await createModule({ name: 'Finance' });
    const modB = await createModule({ name: 'Finance' });
    const modC = await createModule({ name: 'Finance' });

    expect(modA.slug).toBe('finance');
    expect(modB.slug).toBe('finance-1');
    expect(modC.slug).toBe('finance-2');

    // Resolving by slug or id works
    expect((await getModuleBySlugOrId('finance'))?.id).toBe(modA.id);
    expect((await getModuleBySlugOrId('finance-1'))?.id).toBe(modB.id);
    expect((await getModuleBySlugOrId(modC.id))?.id).toBe(modC.id);
  });

  it('getNotebooksByModule for General module includes both explicit and unassigned notes', async () => {
    await ensureDefaultModule();

    await db.notes.bulkAdd([
      {
        id: 'explicit-general',
        title: 'Explicit Note',
        content: 'Content 1',
        attachments: {},
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        contentHash: 'hash-1',
        moduleId: DEFAULT_MODULE_ID,
      },
      {
        id: 'legacy-unassigned',
        title: 'Legacy Note Without ModuleId',
        content: 'Content 2',
        attachments: {},
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-03T00:00:00.000Z',
        contentHash: 'hash-2',
      },
    ]);

    const notebooks = await getNotebooksByModule(DEFAULT_MODULE_ID);
    const ids = notebooks.map((n) => n.id);
    expect(ids).toContain('explicit-general');
    expect(ids).toContain('legacy-unassigned');
  });
});
