# Data Models

There is **no relational database and no ORM**. All data lives in the browser's IndexedDB via **Dexie** (`src/lib/db.ts`). There is **no Zod**; validation is done with TypeScript interfaces only.

## Database: `NotebookDB` (IndexedDB, Dexie) — version 1

Schema declared in `src/lib/db.ts:27`:

| Table | KeyPath | Indexes |
|---|---|---|
| `notes` | `id` | `id`, `updatedAt`, `title` |
| `pairings` | `id` | `id`, `label`, `pairedAt` |

Only schema version 1 exists — no migration strategy is defined for future versions.

### Table `notes` → interface `Note`
| Field | Type | Description |
|---|---|---|
| `id` | `string` | Primary key. `crypto.randomUUID()` (welcome note uses fixed id `'welcome-note-default-id'`) |
| `title` | `string` | Note title |
| `content` | `string` | Markdown body |
| `attachments` | `Record<string, AttachmentEntry>` | Map of label → attachment (embedded, **not** a separate table) |
| `createdAt` | `string` | ISO timestamp |
| `updatedAt` | `string` | ISO timestamp; used for sort and sync last-write-wins |
| `contentHash` | `string` | SHA-256 hex of `content` + serialized attachment data (`src/lib/hash.ts`) |

### Embedded type `AttachmentEntry`
| Field | Type | Description |
|---|---|---|
| `name` | `string` | Original file name |
| `data` | `string` | base64 data URL (e.g. `data:image/jpeg;base64,...`) |
| `createdAt` | `string` | ISO timestamp |

Images and drawings are stored as base64 data URLs **inside** the note record, not as separate rows.

### Table `pairings` → interface `Pairing`
| Field | Type | Description |
|---|---|---|
| `id` | `string` | Primary key; persistent 12-char alphanumeric Trystero room code |
| `label` | `string` | User-given name (e.g. "My Phone") |
| `pairedAt` | `string` | ISO timestamp |

### Relations
- None. IndexedDB has no foreign keys. `Note.attachments` is an embedded map, and `Pairing` is standalone.

### Seeding
`seedIfEmpty()` (`src/lib/db.ts:43`) inserts a "Welcome to Notebook" note when the `notes` table is empty.

## TypeScript shared types (no runtime validation)

| Type | File | Purpose |
|---|---|---|
| `Note`, `AttachmentEntry`, `Pairing` | `src/lib/db.ts` | Persistence models (above) |
| `ManifestEntry` | `src/lib/sync.ts` | Sync handshake entry: `{ noteId, contentHash, updatedAt }` |
| `SyncDiff` | `src/lib/sync.ts` | `{ toRequest: string[]; toSend: string[] }` — **defined but unused** (dead code) |
| `SyncResult` | `src/lib/sync.ts` | `{ received, sent, unchanged }` returned by a completed sync |
| `SortOrder` | `src/hooks/useNotes.ts` | `'lastChange' \| 'ascending' \| 'descending'` |
| `PeerState` | `src/hooks/useSync.ts` | `{ pairingId, peerId }` for a connected peer |
| `SyncStatus` | `src/hooks/useSync.ts` | Discriminated union: `idle / connecting / exchanging / transferring / done / error` |
| `IceServer` | `src/lib/turn.ts` | `{ urls, username?, credential? }` from Metered.ca |

Private types in `src/hooks/useSync.ts`: `TrysteroAction`, `TrysteroRoom`, `TrysteroModule`, `RoomEntry` (describe the Trystero API surface used).

## Validation approach
- **No Zod / schema validation anywhere.** Fields are trusted as written by the app itself.
- Data read back from IndexedDB (e.g. synced notes) is cast directly via `JSON.parse(...) as Note` (`src/lib/sync.ts:106`) without runtime checks.
