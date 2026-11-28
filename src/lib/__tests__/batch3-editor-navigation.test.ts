// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import {
  createModule,
  createNotebookInModule,
  deleteNotebook,
  getModuleAndNotebookBySlugs,
  getNotebookBySlugOrId,
  getNotebookSlug,
  renameNotebook,
} from '@/lib/workspace';

describe('Batch 3: Editor & Navigation Routing Architecture', () => {
  beforeEach(async () => {
    localStorage.clear();
  });

  afterEach(async () => {
    localStorage.clear();
    await Dexie.delete('NotebookDB');
  });

  it('getNotebookSlug derives human-readable slugs and falls back safely', () => {
    // 1. Explicit slug
    expect(
      getNotebookSlug({
        id: 'nb-1',
        title: 'My Notes',
        slug: 'custom-slug',
        content: '',
        attachments: {},
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
        contentHash: 'hash-test',
      })
    ).toBe('custom-slug');

    // 2. Slugified title
    expect(
      getNotebookSlug({
        id: 'nb-2',
        title: 'Project Roadmap & Goals (2026)',
        content: '',
        attachments: {},
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
        contentHash: 'hash-test',
      })
    ).toBe('project-roadmap-goals-2026');

    // 3. Untitled / empty title falls back to notebook ID
    expect(
      getNotebookSlug({
        id: 'nb-3',
        title: '',
        content: '',
        attachments: {},
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
        contentHash: 'hash-test',
      })
    ).toBe('nb-3');

    // 4. Whitespace title falls back to notebook ID
    expect(
      getNotebookSlug({
        id: 'nb-4',
        title: '    ',
        content: '',
        attachments: {},
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
        contentHash: 'hash-test',
      })
    ).toBe('nb-4');
  });

  it('resolves notebooks by internal ID first (ID is source of truth)', async () => {
    const mod = await createModule({ name: 'Engineering' });
    const nb = await createNotebookInModule(mod.id, {
      title: 'Architecture Spec',
      content: 'System diagram and APIs',
    });

    // 1. Lookup by exact ID
    const foundById = await getNotebookBySlugOrId(mod.id, nb.id);
    expect(foundById).toBeDefined();
    expect(foundById?.id).toBe(nb.id);
    expect(foundById?.title).toBe('Architecture Spec');

    // 2. Lookup by derived slug
    const slug = getNotebookSlug(nb);
    expect(slug).toBe('architecture-spec');
    const foundBySlug = await getNotebookBySlugOrId(mod.id, slug);
    expect(foundBySlug).toBeDefined();
    expect(foundBySlug?.id).toBe(nb.id);
  });

  it('renaming a notebook preserves internal ID while updating derived slug', async () => {
    const mod = await createModule({ name: 'Product' });
    const nb = await createNotebookInModule(mod.id, {
      title: 'Initial Draft',
    });

    const initialId = nb.id;
    const initialSlug = getNotebookSlug(nb);
    expect(initialSlug).toBe('initial-draft');

    // Rename
    const updated = await renameNotebook(initialId, 'Final Review Spec');
    expect(updated.id).toBe(initialId);
    expect(updated.title).toBe('Final Review Spec');

    // Old ID still resolves
    const resolvedById = await getNotebookBySlugOrId(mod.id, initialId);
    expect(resolvedById?.id).toBe(initialId);
    expect(resolvedById?.title).toBe('Final Review Spec');

    // New slug resolves
    const newSlug = getNotebookSlug(updated);
    expect(newSlug).toBe('final-review-spec');
    const resolvedByNewSlug = await getNotebookBySlugOrId(mod.id, newSlug);
    expect(resolvedByNewSlug?.id).toBe(initialId);
  });

  it('getModuleAndNotebookBySlugs resolves nested routes correctly', async () => {
    const mod = await createModule({ name: 'Research Lab' });
    const nb = await createNotebookInModule(mod.id, {
      title: 'Quantum Computing Notes',
    });

    const modSlug = mod.slug || mod.id; // 'research-lab'
    const nbSlug = getNotebookSlug(nb); // 'quantum-computing-notes'

    // 1. Resolve using both human-readable slugs
    const res1 = await getModuleAndNotebookBySlugs(modSlug, nbSlug);
    expect(res1.module?.id).toBe(mod.id);
    expect(res1.notebook?.id).toBe(nb.id);

    // 2. Resolve using module ID and notebook ID
    const res2 = await getModuleAndNotebookBySlugs(mod.id, nb.id);
    expect(res2.module?.id).toBe(mod.id);
    expect(res2.notebook?.id).toBe(nb.id);

    // 3. Fallback when notebook exists but module slug is different or general
    const res3 = await getModuleAndNotebookBySlugs('general', nb.id);
    expect(res3.module?.id).toBe(mod.id);
    expect(res3.notebook?.id).toBe(nb.id);

    // 4. Non-existent notebook returns undefined
    const res4 = await getModuleAndNotebookBySlugs(modSlug, 'non-existent-nb');
    expect(res4.module?.id).toBe(mod.id);
    expect(res4.notebook).toBeUndefined();

    // 5. Non-existent module and non-existent notebook
    const res5 = await getModuleAndNotebookBySlugs('ghost-module', 'ghost-nb');
    expect(res5.module).toBeUndefined();
    expect(res5.notebook).toBeUndefined();
  });

  it('deleting a notebook creates a tombstone and removes it from active list', async () => {
    const mod = await createModule({ name: 'Testing' });
    const nb = await createNotebookInModule(mod.id, {
      title: 'To Be Deleted',
    });

    const existingBefore = await db.notes.get(nb.id);
    expect(existingBefore).toBeDefined();

    await deleteNotebook(nb.id);

    // Removed from active notes
    const existingAfter = await db.notes.get(nb.id);
    expect(existingAfter).toBeUndefined();

    // Tombstone exists
    const tombstone = await db.tombstones.get(nb.id);
    expect(tombstone).toBeDefined();
    expect(tombstone?.noteId).toBe(nb.id);
  });
});
