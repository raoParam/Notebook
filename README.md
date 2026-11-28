# Notebook

A local-first, browser-based Markdown notebook with live preview, an Excalidraw-style drawing studio, image attachments, PDF/Markdown export, custom theming, and optional peer-to-peer (P2P) device synchronization over WebRTC.

---

## 1. Project Overview

**Notebook** (`notebook-app`) is a client-side note-taking web application built with Next.js and React. It stores all notes, embedded images, drawings, deletion tombstones, and device pairings directly in the user's browser using IndexedDB—requiring no backend database and no user account.

### Problem It Solves

Most modern note-taking apps require an account, store personal data on remote servers, or lock notes behind proprietary sync subscriptions. Notebook provides:

- **Zero-server privacy & offline-first persistence**: Notes live locally in browser IndexedDB (`NotebookDB`) and remain fully functional without an internet connection.
- **Rich technical & visual note-taking**: Supports GitHub Flavored Markdown, KaTeX math notation, resized image attachments, and an interactive vector/freehand drawing canvas.
- **Optional direct device sync**: Devices can pair once with a 12-character room code and synchronize notes directly peer-to-peer over WebRTC without an intermediary cloud storage database.

---

## 2. Core Features

### Implemented Features

- **Markdown Editor & Live Split Preview** (`src/components/Editor.tsx`, `src/components/MarkdownPreview.tsx`)
  - Editable note title with auto-sizing and debounced auto-save (`350ms`).
  - Split-pane editor and live preview on desktop (`> 820px`), switching to **Write** / **Preview** tabs on mobile (`<= 820px`).
  - **Full-Screen Write** and **Full-Screen Preview** modes (toggleable from toolbar or pane header; exit via the close button or `Escape`).
  - GitHub Flavored Markdown (`gfm: true`, `breaks: true`) via `marked`, inline (`$...$`) and block (`$$...$$`) math rendering via `katex`, and strict HTML sanitization via `dompurify` (with MathML allowlisted).
- **Formatting Toolbar** (`src/components/Toolbar.tsx`)
  - Commands for Bold (`Ctrl/Cmd+B`), Italic (`Ctrl/Cmd+I`), Strikethrough, Headings (`H1`–`H3`), Bullet List, Numbered List, Blockquote, Code Block, Link, and Horizontal Rule.
  - On viewports `<= 820px`, formatting tools collapse into a `⋯ Tools` bottom-sheet modal.
- **Drawing Studio** (`src/components/DrawingCanvas.tsx`, `src/components/drawing/`)
  - Interactive HTML5 Canvas modal supporting Select/Marquee (`V`/`1`), Freehand Pen (`P`/`2`), Eraser (`E`/`3`), Rectangle (`R`/`4`), Rounded Rectangle, Ellipse (`O`/`5`), Diamond (`D`/`6`), Triangle, Line (`L`/`7`), Arrow (`A`/`8`), and Text (`T`/`9`).
  - Styling controls for stroke color, fill color, fill style (`none`, `semi`, `solid`), stroke width, stroke style (`solid`, `dashed`, `dotted`), text font size, and opacity.
  - Viewport pan (`Space` + drag or wheel scroll), zoom (`Ctrl/Cmd` + wheel, `+`/`−` controls, `Fit` to elements, reset), multi-select marquee, resize handles, duplicate (`Ctrl/Cmd+D`), delete, and 50-step Undo/Redo (`Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z` / `Ctrl/Cmd+Y`).
  - Exports the drawing as a 2x-scaled PNG data URL and embeds it into the active note.
- **Image Attachments** (`src/components/Editor.tsx`, `src/lib/imageUpload.ts`)
  - Upload images from disk; images larger than `1400px` on their longest side or `900 KB` are automatically resized and compressed to JPEG (`0.88` quality) via an offscreen canvas.
  - Strict validation of MIME types, magic bytes, and SVG XML sanitization to prevent script injection.
  - Stored inside the note's `attachments` record as base64 data URLs and referenced in Markdown via `![label]`.
- **Import & Export** (`src/components/Toolbar.tsx`, `src/app/page.tsx`, `src/lib/markdown.ts`)
  - **Import**: Open `.md`, `.markdown`, or `.txt` files as new notes.
  - **Export `.md`**: Downloads the active note as a Markdown file with `![label]` references resolved to inline data URLs.
  - **Export PDF**: Renders the active note into a styled A4 document with sanitized HTML and downloads it using `html2pdf.js`.
- **Note Organization** (`src/components/Sidebar.tsx`, `src/hooks/useNotes.ts`)
  - Slide-out drawer sidebar with note previews, last-updated dates, search filtering, **New Note** creation, **Delete** with confirmation, and sorting by **Last changed**, **A → Z**, or **Z → A**.
  - Automatically seeds a `Welcome to Notebook` note if IndexedDB is empty.
- **Themes & Typography Customization** (`src/components/ThemeProvider.tsx`, `src/components/SettingsModal.tsx`, `src/components/settings/`)
  - 6 built-in themes: `Light`, `Dark`, `Ocean`, `Dracula`, `Nord`, and `Gruvbox`, with flash-free dark class initialization in `src/app/layout.tsx`.
  - **Custom Theme Builder**: Edit all 12 CSS color tokens, save named custom themes, delete custom themes, and import/export themes as JSON.
  - **Typography & Fonts**: Configure Interface Font (UI), Reading & Title Font (Serif), and Editor & Code Font (Mono), or reset to defaults.
- **Peer-to-Peer Device Sync** (`src/hooks/useSync.ts`, `src/hooks/sync/`, `src/components/PairDevice.tsx`, `src/components/SyncDialog.tsx`, `src/components/DeletionActivity.tsx`)
  - Generate or enter a 12-character alphanumeric room code to pair devices.
  - Background room presence via `@trystero-p2p/torrent` with server-proxied Metered.ca TURN relay support (`/api/ice-servers`).
  - Full synchronization of note creations, updates, and deletions using tombstone tracking (`src/lib/tombstones.ts`).
  - Automatic background sync toggle, manual sync dialog (`SyncDialog.tsx`) with detailed pre-transfer diffing, and deletion activity history drawer (`DeletionActivity.tsx`).
  - Gzip payload compression (`CompressionStream`), SHA-256 content hashing, and last-write-wins conflict resolution.

---

## 3. Application Workflow

1. **Startup & Hydration**:
   - `src/app/layout.tsx` runs an inline `<script>` before paint to read `nb-theme-id` from `localStorage` (or `prefers-color-scheme: dark`) and toggle the `dark` class on `<html>` to eliminate theme flashing.
   - `ThemeProvider` loads saved theme colors, custom themes, and font preferences from `localStorage` and applies CSS custom properties (`--bg-app`, `--bg-paper`, `--font`, etc.) to `document.documentElement`.
   - `useNotes()` calls `seedIfEmpty()`, loads all active notes from IndexedDB, and restores `nb-active-id` and `nb-sort` from `localStorage`.
   - `useSync()` loads saved `pairings` and active `tombstones` from IndexedDB and joins each pairing's Trystero WebRTC room in the background.
2. **Writing & Editing**:
   - Selecting or creating a note opens it in `Editor`.
   - Typing in the title or Markdown textarea schedules a debounced (`350ms`) `updateNote()` call, which recomputes the note's SHA-256 `contentHash` and writes the updated `Note` to IndexedDB.
   - Attaching an image or inserting a drawing from `DrawingCanvas` updates `note.attachments` and appends `![label]` to the Markdown content immediately.
3. **Previewing & Exporting**:
   - `MarkdownPreview` resolves `![label]` placeholders to their base64 data URLs, extracts `$...$` / `$$...$$` math blocks, parses Markdown with `marked`, renders math with `katex`, and sanitizes the resulting HTML with `DOMPurify`.
   - Users can export the active note via the toolbar's `.md` or `PDF` buttons.
4. **Pairing, Syncing & Tombstones**:
   - Opening the sidebar and clicking **Pair** launches `PairDevice`, where one device generates a 12-character code and the other enters it. Both save the `Pairing` locally and join the same Trystero room.
   - When both devices are online, a green indicator dot appears on the **Sync** button. Clicking **Sync** opens `SyncDialog`, displaying differences between local and peer notes.
   - Deleting a note creates a tombstone record (`src/lib/tombstones.ts`). During sync, tombstones are exchanged so deleted notes are reliably removed across all paired peers without resurrecting stale data.

---

## 4. Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Framework | Next.js `16.4.6` (App Router) | Client-rendered UI (`'use client'`) + Server route (`/api/ice-servers`) |
| UI Library | React `19.2.4`, TypeScript `5` | Strict TypeScript configuration (`tsconfig.json`) |
| Styling | Tailwind CSS `4` (`@tailwindcss/postcss`), CSS Variables | Custom design tokens in `src/app/globals.css` |
| Local Database | Dexie `4.4.4` (IndexedDB) | Stores `notes`, `pairings`, and `tombstones` |
| Markdown & Math | `marked` `18.0.7`, `katex` `0.18.1` | KaTeX CSS loaded from jsDelivr CDN in `layout.tsx` |
| Sanitization | `dompurify` `3.4.13` | Sanitizes rendered HTML in preview and export |
| PDF Export | `html2pdf.js` `0.14.0` | Dynamically imported on export |
| P2P Signaling & Transport | `@trystero-p2p/torrent` `0.25.3` | WebRTC over public BitTorrent trackers |
| Compression | Native `CompressionStream` / `DecompressionStream` | Gzip compression for synced note payloads |
| Hashing & Cryptography | Web Crypto API (`SubtleCrypto`, `crypto.getRandomValues`, `crypto.randomUUID`) | SHA-256 content hashes, room codes, note IDs |
| Testing | Vitest `5.1.2`, `jsdom`, `fake-indexeddb` | Unit and integration tests (`npm test`) |

---

## 5. Architecture

### Project Structure

```text
├── next.config.ts                # Next.js configuration
├── package.json                  # Dependencies and npm scripts
├── tsconfig.json                 # TypeScript configuration (@/* -> ./src/*)
├── vitest.config.ts              # Vitest test suite configuration
├── public/                       # Static SVG icons and assets
└── src/
    ├── app/
    │   ├── api/
    │   │   └── ice-servers/
    │   │       └── route.ts      # Server-side TURN credential proxy & STUN fallback
    │   ├── globals.css           # Base styles, CSS variables, prose styles
    │   ├── layout.tsx            # Root layout, Google Fonts, KaTeX CSS, theme pre-init
    │   └── page.tsx              # Main NotebookPage (orchestrates hooks, layout, export)
    ├── components/
    │   ├── drawing/              # Modular drawing studio components
    │   │   ├── DrawingHeader.tsx
    │   │   ├── StyleInspector.tsx
    │   │   ├── ToolPalette.tsx
    │   │   ├── constants.ts
    │   │   ├── geometry.ts
    │   │   ├── renderer.ts
    │   │   └── types.ts
    │   ├── settings/             # Modular settings tabs and modals
    │   │   ├── AppearanceSettings.tsx
    │   │   ├── FontSettings.tsx
    │   │   ├── SyncSettings.tsx
    │   │   ├── ThemeImportExportModal.tsx
    │   │   ├── styles.tsx
    │   │   └── types.ts
    │   ├── DeletionActivity.tsx  # Deletion history and tombstone status drawer
    │   ├── DrawingCanvas.tsx     # Full-featured canvas drawing studio modal
    │   ├── Editor.tsx            # Title input, Markdown editor, split/mobile/fullscreen panes
    │   ├── MarkdownPreview.tsx   # Markdown + KaTeX + attachment resolver + DOMPurify
    │   ├── PairDevice.tsx        # Device pairing modal (generate/enter 12-char code)
    │   ├── SettingsModal.tsx     # Appearance, themes, fonts, and sync settings modal
    │   ├── Sidebar.tsx           # Drawer sidebar with note list, search, sort selector
    │   ├── SyncButton.tsx        # Header sync button with peer status dot
    │   ├── SyncDialog.tsx        # Manual sync comparison and transfer dialog
    │   ├── ThemeProvider.tsx     # Theme & font React context backed by localStorage
    │   └── Toolbar.tsx           # Formatting toolbar, file import/export, tools modal
    ├── hooks/
    │   ├── sync/                 # Modular peer sync subsystem
    │   │   ├── constants.ts
    │   │   ├── messageHandlers.ts
    │   │   ├── roomManager.ts
    │   │   ├── sessionManager.ts
    │   │   ├── types.ts
    │   │   └── utils.ts
    │   ├── useNotes.ts           # IndexedDB CRUD, search, sorting, active note state
    │   └── useSync.ts            # Trystero room lifecycle, auto-sync, tombstone propagation
    └── lib/
        ├── db.ts                 # Dexie schema (notes, pairings, tombstones) and seedIfEmpty()
        ├── hash.ts               # SHA-256 computeContentHash() and generateRoomCode()
        ├── imageUpload.ts        # Image validation, dimensions cap, canvas compression
        ├── markdown.ts           # KaTeX extraction, DOMPurify sanitizer configuration
        ├── sync.ts               # Manifest diffing and gzip compressNote()/decompressNote()
        ├── tombstones.ts         # Tombstone creation, TTL pruning, sync reconciliation
        └── turn.ts               # Ephemeral ICE server resolver (calls /api/ice-servers)
```

---

## 6. Local-First Storage Architecture

### IndexedDB (`NotebookDB` via Dexie)

Defined in `src/lib/db.ts` (schema version `2`):

- **`notes` table** (`id, updatedAt, title`):
  ```ts
  export interface Note {
    id: string;
    title: string;
    content: string;
    attachments: Record<string, AttachmentEntry>;
    createdAt: string;   // ISO timestamp
    updatedAt: string;   // ISO timestamp
    contentHash: string; // SHA-256 hex of content + sorted attachments
  }

  export interface AttachmentEntry {
    name: string;
    data: string;        // base64 data URL
    createdAt: string;   // ISO timestamp
  }
  ```
- **`pairings` table** (`id, label, pairedAt`):
  ```ts
  export interface Pairing {
    id: string;          // 12-char alphanumeric room code
    label: string;       // user-provided device/pair label
    pairedAt: string;    // ISO timestamp
  }
  ```
- **`tombstones` table** (`id, noteId, deletedAt, noteTitle, noteUpdatedAt`):
  ```ts
  export interface NoteTombstone {
    id: string;          // Tombstone identifier
    noteId: string;      // ID of deleted note
    deletedAt: string;   // ISO timestamp
    noteTitle: string;   // Title of deleted note for activity log
    noteUpdatedAt: string; // UpdatedAt of note when deleted
  }
  ```

### Content Hashing (`src/lib/hash.ts`)

`computeContentHash(content, attachments)` sorts attachment keys lexicographically, serializes their data to JSON, concatenates `content + '\x00' + attString`, and generates a SHA-256 hex digest using `crypto.subtle.digest`.

### `localStorage` Keys

- `nb-active-id`: ID of the last active note.
- `nb-sort`: Selected sort order (`lastChange`, `ascending`, `descending`).
- `nb-theme-id`: Active theme preset ID, custom theme ID, or `custom-draft`.
- `nb-custom-colors`: JSON object of customized `ThemeColors`.
- `nb-saved-custom-themes`: JSON array of saved `CustomTheme` objects.
- `nb-fonts`: JSON object of `FontSettings` (`uiFont`, `serifFont`, `monoFont`).
- `nb-auto-sync`: Boolean flag indicating whether background auto-sync is enabled.

---

## 7. Peer-to-Peer Synchronization

Peer synchronization is implemented across `src/hooks/useSync.ts`, `src/hooks/sync/`, `src/lib/sync.ts`, `src/lib/tombstones.ts`, and `src/lib/turn.ts`:

1. **Room Joining & ICE Configuration**:
   - On load, `getIceServers()` (`src/lib/turn.ts`) queries `/api/ice-servers`.
   - The server endpoint securely requests short-lived TURN credentials from Metered.ca without exposing API credentials to the browser, merging them with Google STUN fallbacks (`stun:stun.l.google.com:19302`–`stun4`).
   - Devices join each pairing's room using `@trystero-p2p/torrent` with `appId: 'notebook-p2p-sync-v1'`.
2. **Synchronization Lifecycle**:
   - **Manifest Exchange**: Connected peers exchange manifests containing note IDs, content hashes, and `updatedAt` timestamps.
   - **Tombstone Exchange**: Peers exchange deletion tombstones to ensure deleted notes are pruned across devices.
   - **Diffing & Transfer**: Each side computes the diff between local and peer manifests. Only new or modified notes are transferred.
   - **Gzip Compression**: Note payloads are compressed using native `CompressionStream` (gzip) before transmission over WebRTC data channels.
   - **Conflict Resolution**: Last-write-wins (LWW) based on `updatedAt`. Tombstones take precedence over older note updates, preventing deleted notes from resurfacing.
3. **Activity & Dialogue**:
   - **SyncDialog**: Shows incoming/outgoing note diffs before syncing, transfer progress, and completion summary.
   - **DeletionActivity**: Lists recent sync deletions and allows restoring deleted notes from tombstones if desired.

---

## 8. Authentication & Security

- **Zero-Server Storage**: All user notes and attachments remain stored exclusively inside browser IndexedDB on the user's device.
- **Encrypted P2P Channels**: WebRTC data channels are encrypted end-to-end via DTLS in transit.
- **Server-Only TURN Credentials**: Metered.ca TURN credentials (`METERED_APP_NAME`, `METERED_API_KEY`) are kept strictly server-side and accessed via `/api/ice-servers`. Secrets are never exposed in client bundles or public network responses.
- **XSS & Script Injection Prevention**:
  - Live preview and PDF export parse Markdown through `marked` and sanitize the output using `DOMPurify` with MathML elements allowlisted.
  - Image attachments undergo validation (`src/lib/imageUpload.ts`) verifying MIME types, file sizes, image dimensions, and SVG contents before being stored or embedded.

---

## 9. Installation & Local Development

### Prerequisites

- Node.js (v18+ recommended)
- npm

### Setup

```bash
# 1. Install dependencies
npm install

# 2. (Optional) Configure TURN server credentials for cross-network WebRTC sync
# Create .env.local and configure your Metered.ca credentials:
# METERED_APP_NAME=your-app-subdomain
# METERED_API_KEY=your-api-key

# 3. Start the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Available Scripts

- `npm run dev` — Starts Next.js development server.
- `npm run build` — Builds the production Next.js application.
- `npm run start` — Starts the production Next.js server.
- `npm run lint` — Runs ESLint checks.
- `npm test` — Runs the full automated test suite with Vitest.

---

## 10. Environment Variables

Notebook requires no mandatory environment variables for local operation. When environment variables are omitted, WebRTC synchronization automatically uses public Google STUN servers.

To enable TURN relay across restrictive symmetric NATs and firewalls, configure the following server-side environment variables in `.env.local` (for local development) or your hosting platform's environment settings:

| Variable | Required | Description |
|---|---|---|
| `METERED_APP_NAME` | No | Metered.ca application subdomain used by `/api/ice-servers` to request TURN credentials. |
| `METERED_API_KEY` | No | Metered.ca API key used by `/api/ice-servers`. Kept server-side only. |

> **Security Rule**: Never commit `.env*` files or real credential values to version control. The `.gitignore` file is configured to prevent all environment files and secrets from being committed.

---

## 11. Deployment

- **Vercel / Node Hosting**:
  - Import the repository on [Vercel](https://vercel.com) or deploy to any Node.js hosting platform.
  - Configure `METERED_APP_NAME` and `METERED_API_KEY` in the project's environment variable settings if TURN relay support is required.
  - The `/api/ice-servers` route runs as a serverless API route to proxy TURN credentials securely.
- **Static Export**:
  - If deploying to a static CDN (e.g. GitHub Pages), configure `output: 'export'` in `next.config.ts`.
  - In a purely static export without a Node.js or serverless backend, `/api/ice-servers` is not available, and peer synchronization falls back to STUN-only mode.

---

## 12. Automated Testing

The codebase includes an automated test suite powered by Vitest, testing-library, `jsdom`, and `fake-indexeddb`.

Run tests with:

```bash
npm test
```

### Test Coverage

- **Database & Storage** (`src/lib/__tests__/db.test.ts`): IndexedDB CRUD, schema upgrades, seeding, note sorting.
- **Cryptographic Hashing** (`src/lib/__tests__/hash.test.ts`): SHA-256 consistency, attachment sorting, room code generation.
- **P2P Synchronization & Protocol** (`src/lib/__tests__/sync.test.ts`, `src/lib/__tests__/sync-security.test.ts`, `src/hooks/__tests__/syncModules.test.ts`, `src/hooks/__tests__/useSync.test.tsx`): Manifest diffing, gzip compression/decompression, message serialization, authorization, and network error handling.
- **Tombstone Deletion Reconciliation** (`src/lib/__tests__/tombstones.test.ts`, `src/components/__tests__/DeletionActivity.test.tsx`): Deletion tracking, conflict resolution against resurrection, TTL pruning.
- **TURN Relay Security** (`src/lib/__tests__/turn.test.ts`): Credential fetching, input validation, cache expiration, secret redaction, and fallback behavior.
- **Image Security & Validation** (`src/lib/__tests__/image-upload.test.ts`): Dimension caps, MIME verification, SVG sanitization.
- **Markdown & Math Rendering** (`src/lib/__tests__/markdown-security.test.ts`): XSS sanitization, KaTeX math parsing, DOMPurify configuration.
- **UI Components** (`src/components/__tests__/`): Drawing canvas modules, SyncDialog, DeletionActivity, and Editor synchronization workflows.
