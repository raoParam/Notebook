import Dexie, { type Table } from 'dexie';
import type { AttachmentEntry, Module, Notebook } from '@/types/workspace';
import {
  DEFAULT_MODULE_ID,
  DEFAULT_MODULE_NAME,
  DEFAULT_MODULE_SLUG,
} from '@/types/workspace';

export type { AttachmentEntry, Module, Notebook };
export type Note = Notebook;
export { DEFAULT_MODULE_ID, DEFAULT_MODULE_NAME, DEFAULT_MODULE_SLUG };

export interface Pairing {
  id: string; // persistent Trystero room code (12-char alphanumeric)
  label: string; // user-given name e.g. "My Phone"
  pairedAt: string; // ISO timestamp
}

export interface Tombstone {
  noteId: string;
  noteTitle?: string;
  deletedAt: string;
  deletionId: string;
  scope: 'local' | 'propagated';
  deliveryFailures: number;
}

export type DeletionDeliveryStatus = 'pending' | 'accepted' | 'failed' | 'superseded';

export interface DeletionRecipient {
  pairingId: string;
  peerId: string;
}

export interface DeletionDelivery {
  id: string;
  noteId: string;
  deletionId: string;
  pairingId: string;
  peerId: string;
  status: DeletionDeliveryStatus;
  updatedAt: string;
}

export class NotebookDB extends Dexie {
  notes!: Table<Notebook, string>;
  modules!: Table<Module, string>;
  pairings!: Table<Pairing, string>;
  tombstones!: Table<Tombstone, string>;
  deletionDeliveries!: Table<DeletionDelivery, string>;

  constructor() {
    super('NotebookDB');
    this.version(1).stores({
      notes: 'id, updatedAt, title',
      pairings: 'id, label, pairedAt',
    });
    this.version(2).stores({
      notes: 'id, updatedAt, title',
      pairings: 'id, label, pairedAt',
      tombstones: 'noteId, &deletionId, deletedAt, scope',
    });
    this.version(3)
      .stores({
        notes: 'id, updatedAt, title',
        pairings: 'id, label, pairedAt',
        tombstones: 'noteId, &deletionId, deletedAt, scope',
        deletionDeliveries: 'id, deletionId, noteId, [pairingId+peerId], status',
      })
      .upgrade(async (tx) => {
        // Preserve existing v2 tombstones and deliveryFailures safely while normalizing invalid values.
        await tx
          .table('tombstones')
          .toCollection()
          .modify((tombstone: Partial<Tombstone>) => {
            if (
              typeof tombstone.deliveryFailures !== 'number' ||
              !Number.isFinite(tombstone.deliveryFailures) ||
              tombstone.deliveryFailures < 0
            ) {
              tombstone.deliveryFailures = 0;
            }
            if (tombstone.scope !== 'local' && tombstone.scope !== 'propagated') {
              tombstone.scope = 'local';
            }
          });
      });
    this.version(4)
      .stores({
        notes: 'id, updatedAt, title, moduleId',
        modules: 'id, name, slug, order, updatedAt, isArchived',
        pairings: 'id, label, pairedAt',
        tombstones: 'noteId, &deletionId, deletedAt, scope',
        deletionDeliveries: 'id, deletionId, noteId, [pairingId+peerId], status',
      })
      .upgrade(async (tx) => {
        const now = new Date().toISOString();
        const modulesTable = tx.table('modules');
        const notesTable = tx.table('notes');

        // Ensure default module exists
        const existingDefault = await modulesTable.get(DEFAULT_MODULE_ID);
        if (!existingDefault) {
          await modulesTable.put({
            id: DEFAULT_MODULE_ID,
            name: DEFAULT_MODULE_NAME,
            slug: DEFAULT_MODULE_SLUG,
            description: 'Default workspace module',
            order: 0,
            isArchived: false,
            createdAt: now,
            updatedAt: now,
          });
        }

        // Safe migration: preserve all existing notes and assign notes without moduleId to DEFAULT_MODULE_ID
        await notesTable
          .toCollection()
          .modify((note: Partial<Notebook>) => {
            if (typeof note.moduleId !== 'string' || note.moduleId.trim() === '') {
              note.moduleId = DEFAULT_MODULE_ID;
            }
            if (typeof note.isArchived !== 'boolean') {
              note.isArchived = false;
            }
            if (typeof note.isPinned !== 'boolean') {
              note.isPinned = false;
            }
            if (
              note.order !== undefined &&
              (typeof note.order !== 'number' || !Number.isFinite(note.order))
            ) {
              delete note.order;
            }
          });
      });
  }
}

export const db = new NotebookDB();

/** Seed welcome note if DB is empty */
export async function seedIfEmpty() {
  const count = await db.notes.count();
  if (count === 0) {
    const { computeContentHash } = await import('./hash');
    const now = new Date().toISOString();
    const content = `# Welcome to Notebook ✨

Start writing your notes here. Everything is **saved locally** in your browser using IndexedDB.

## Features

- **Bold**, *Italic*, ~~Strikethrough~~
- Headings (H1–H3), lists, blockquotes, code blocks
- Image upload & drawing canvas
- Import \`.md\` files, export as \`.md\` or \`.pdf\`
- **Peer sync** — pair devices over WebRTC (no server required)
- Light / dark theme

> Sync requires both devices to be online at the same time — there is no offline message queue.

Happy note-taking!`;

    const attachments: Record<string, AttachmentEntry> = {};
    const contentHash = await computeContentHash(content, attachments);

    const welcomeNote: Notebook = {
      id: 'welcome-note-default-id',
      title: 'Welcome to Notebook',
      content,
      attachments,
      createdAt: now,
      updatedAt: now,
      contentHash,
      moduleId: DEFAULT_MODULE_ID,
      isArchived: false,
      isPinned: false,
    };

    await db.transaction('rw', db.notes, db.modules, db.tombstones, async () => {
      // Ensure default module exists
      const existingDefault = await db.modules.get(DEFAULT_MODULE_ID);
      if (!existingDefault) {
        await db.modules.put({
          id: DEFAULT_MODULE_ID,
          name: DEFAULT_MODULE_NAME,
          slug: DEFAULT_MODULE_SLUG,
          description: 'Default workspace module',
          order: 0,
          isArchived: false,
          createdAt: now,
          updatedAt: now,
        });
      }

      if (
        (await db.notes.count()) === 0 &&
        !(await db.tombstones.get(welcomeNote.id))
      ) {
        await db.notes.add(welcomeNote);
      }
    });
  }
}
