# Known Gaps, TODOs & Tech Debt

No `TODO`/`FIXME` comments exist in the source (only in `.git` sample hooks, which are irrelevant). The items below were found by inspection.

## Security
- **Hardcoded Metered TURN API key committed** in `src/lib/turn.ts:32` (`apiKey` fallback value) with a default app name `'task-todoapp'`. A `.env.local` exists but the code hardcodes the key when env vars are missing. The key should be treated as exposed.
- **`dangerouslySetInnerHTML`** in `src/components/MarkdownPreview.tsx` renders `marked` output without sanitization. Markdown is local-only today, but there is no defense against malicious markup in imported/synced notes.

## Dead / unused code & dependencies
- `uuid` and `next-themes` are in `package.json` but **never imported** (app uses `crypto.randomUUID()` and a custom `ThemeProvider`).
- `SyncDiff` interface (`src/lib/sync.ts`) and its `toSend` field are **defined but never used**; `computeDiff` returns a plain `string[]`.
- `setSyncStatus` is returned from `useSync` but the caller (`page.tsx`) never uses it.
- `Toolbar`'s `onOpenMd` prop is wired to a no-op (`onOpenMd={() => {}}` in `Editor.tsx:257`); the import action actually works via the `__import__:<JSON>` string hack in `handleCommand`.

## Bugs / questionable behavior
- **Editor ignores external updates to the same note** (`Editor.tsx:83`): local title/content state is only reset when `note.id` *changes*. After a P2P sync updates the currently-open note (same id), the editor does not reflect the new content until you switch notes.
- **Sync "done" result is hardcoded** (`useSync.ts:279`): `received: 0` and `unchanged: 0` are reported regardless of what actually transferred; there is a fixed 3-second wait instead of real completion tracking, and the `transferring` stage never reports real `progress`.
- **Per-pairing connection status is inaccurate** (`PairDevice.tsx:127`): `isConnected` is `connectedPeerIds.length > 0`, so all pairings show "Online" whenever any peer is connected (not matched to the specific pairing).
- **Side effect inside a state updater** (`useNotes.ts:90`): `setActiveId` is called inside the `setNotes` updater function, which React may invoke twice in StrictMode.
- **Two `Sidebar` instances** are rendered by `page.tsx` (desktop + mobile) sharing the same props — duplicated component mount and event handlers.

## Inconsistencies
- **README is outdated**: says Next.js 15 (actual 16.2.12), claims Vercel static export (but `next.config.ts` is empty — no `output: 'export'`), and its project-structure section is incomplete (missing `turn.ts`, `PairDevice`, `SyncButton`, `DrawingCanvas`, `useSync` specifics).
- **Deployment config mismatch**: `out/` contains a stale build from an older Next version (with old prerender-trace artifacts), but the current config doesn't produce one. README claims Vercel static export; nothing in code enforces it.
- **Theme key drift**: legacy `index.html` uses `localStorage` key `notebook_theme`; the React app uses `nb-theme`.
- **Styling is ad-hoc**: Tailwind v4 is a dependency and `globals.css` imports it, but the UI is built from inline `style` objects + CSS variables + injected `<style>` blocks (in `page.tsx` and `Editor.tsx`). No consistent Tailwind usage or design-system abstraction.
- **Duplicate markdown-strip logic** exists in `Sidebar.tsx` (`stripMarkdown`) and matches regexes used by the legacy `index.html`.

## Legacy code
- **`index.html` at repo root is a complete vanilla-JS prototype** (no framework, CDN libs, `localStorage` storage). It is tracked by git but **never referenced by the Next app** and duplicates much of the app's feature logic. It also contains `migrateLegacyImageData`, a legacy-attachments migration the React app lacks.

## Missing / half-finished features
- **`.md` import does not extract base64 images** into `attachments` (the React app has no equivalent of the legacy `migrateLegacyImageData`).
- **No offline sync queue** — explicitly documented as a limitation in README, UI notice, and seed note.
- **No tests** of any kind (no test runner, no unit/integration tests).
- **No data migration strategy** — Dexie schema is `version(1)` only with no `upgrade()` handling.
- **No route-level pages** beyond `/` (no settings page — settings are a modal; no 404/error boundaries defined).
- **No progress indication** during sync beyond a hardcoded spinner.
