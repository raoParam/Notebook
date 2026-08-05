# State & Data Flow

## Data fetching
- **No server data fetching.** There are no API routes, no `fetch` for app data, and no React Query / SWR / Apollo.
- **Persistence layer is IndexedDB via Dexie**, accessed directly from hooks (`src/hooks/useNotes.ts`, `src/hooks/useSync.ts`).
- The **only HTTP request** is client-side in `src/lib/turn.ts`: fetching TURN/STUN credentials from Metered.ca for WebRTC.
- The app starts by running `seedIfEmpty()` (creates a welcome note on first run), then loads all notes.

## State management
- **No global state library** (no zustand/redux/jotai).
- **React Context** is used only for theme: `ThemeProvider` / `useTheme` (`src/components/ThemeProvider.tsx`).
- **Custom hooks hold all domain state** and share it via props from `page.tsx`:
  - `useNotes()` — notes array, active note id, sort order, loaded flag + CRUD actions.
  - `useSync()` — pairings, connected peers, sync status + pairing/sync actions.

## Persistence / localStorage keys
| Key | Written by | Purpose |
|---|---|---|
| IndexedDB `NotebookDB` | `db.ts` | Notes + pairings (source of truth) |
| `nb-active-id` | `useNotes.ts` | Last active note id (restored on load) |
| `nb-sort` | `useNotes.ts` | Sort order (restored on load) |
| `nb-theme` | `ThemeProvider.tsx` | Theme preference |

## Component data flow
```
page.tsx
 ├─ useNotes() ──► Dexie notes table ──► props ──► Sidebar, Editor, EmptyState
 └─ useSync()  ──► Dexie pairings table ──► props ──► PairDevice, SyncButton
        └── onNotesChanged (= reload from useNotes) wired into sync handler
```
- `Editor` keeps local `title`/`content` state and pushes updates up via `onUpdate` (debounced 350 ms).
- `useSync` calls the `reload` callback after receiving a note from a peer so the sidebar/editor refresh.
- Note edits are saved to IndexedDB immediately on each debounced update (no explicit save button).

## P2P sync protocol (device-to-device)
Message flow over Trystero actions (room `makeAction('sync')`), implemented in `src/hooks/useSync.ts`:
1. Manual "Sync" trigger → sends `{ type: 'manifest', entries }` to each connected peer.
2. Peer responds with `{ type: 'request', noteIds }` (IDs the peer needs) and proactively sends `{ type: 'note', payload }` for notes we need.
3. Each `note` payload is gzip-compressed (`CompressionStream`) and decompressed on receipt; conflicts resolved by **last-write-wins** on `updatedAt`.
4. Sender finishes with `{ type: 'done' }`.

Helpers in `src/lib/sync.ts`: `computeDiff` (hash + timestamp compare), `buildLocalManifest`, `compressNote`, `decompressNote`.

## Caching / revalidation
- **TURN creds cache**: module-level in `src/lib/turn.ts`, cached 10 minutes; falls back to Google STUN servers on failure.
- **No other caching.** No SWR/React Query cache, no HTTP caching strategy.
- There is no offline queue — synced changes are not delivered to an offline device (documented limitation shown in the UI).
- Sync status is UI-transient: `done`/`error` stages auto-reset to `idle` after 4–5 s.
