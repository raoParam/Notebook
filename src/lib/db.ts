import Dexie, { type Table } from 'dexie';

export interface Note {
  id: string;
  title: string;
  content: string;
  /** attachment id → base64 data URL */
  attachments: Record<string, AttachmentEntry>;
  createdAt: string;
  updatedAt: string;
  /** SHA-256 hex of content + serialized attachments */
  contentHash: string;
}

export interface AttachmentEntry {
  name: string;
  data: string; // base64 data URL
  createdAt: string;
}

export interface Pairing {
  id: string;       // persistent Trystero room code (12-char alphanumeric)
  label: string;    // user-given name e.g. "My Phone"
  pairedAt: string; // ISO timestamp
}

export interface Tombstone {
  noteId: string;
  deletedAt: string;
  deletionId: string;
  scope: 'local' | 'propagated';
  deliveryFailures: number;
}

export class NotebookDB extends Dexie {
  notes!: Table<Note, string>;
  pairings!: Table<Pairing, string>;
  tombstones!: Table<Tombstone, string>;

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

    const welcomeNote: Note = {
      id: 'welcome-note-default-id',
      title: 'Welcome to Notebook',
      content,
      attachments,
      createdAt: now,
      updatedAt: now,
      contentHash,
    };

    await db.transaction('rw', db.notes, db.tombstones, async () => {
      if (
        (await db.notes.count()) === 0 &&
        !(await db.tombstones.get(welcomeNote.id))
      ) {
        await db.notes.add(welcomeNote);
      }
    });
  }
}
