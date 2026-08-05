# Project Overview

## What this app does
A **local-first markdown notebook** that runs entirely in the browser. Notes are stored on-device in IndexedDB — there is no server, no cloud account, and no backend database. An optional **peer-to-peer device sync** feature lets two devices exchange notes directly over WebRTC when both are online.

## Core features implemented (from actual code)
- **Markdown editor** — title input + monospace textarea with live split preview, toolbar commands (bold, italic, strikethrough, H1–H3, bullet/numbered lists, blockquote, code block, link, horizontal rule), keyboard shortcuts (Ctrl/Cmd+B, Ctrl/Cmd+I)
- **KaTeX math rendering** — inline `$...$` and display `$$...$$` math in the preview (`src/components/MarkdownPreview.tsx`)
- **Drawing canvas** — pointer-event canvas with pen/eraser/color/size, insert drawing as a PNG data-URL attachment (`src/components/DrawingCanvas.tsx`)
- **Image attachments** — upload with client-side resize (max 1400px side, JPEG 0.88), stored as base64 data URLs inside the note record
- **Import / Export** — import any `.md` file as a new note; export as `.md` or as a styled `.pdf` via html2pdf.js
- **Note management** — create, delete (confirm dialog), sort (last changed / A–Z / Z–A)
- **Light/dark theme** — class-based, persisted in `localStorage` (`nb-theme`), no-FOUC blocking script in the root layout
- **P2P sync** — pair devices with a 12-char room code, background presence, manual "Sync" button, manifest diff with gzip compression and last-write-wins conflict resolution (`src/hooks/useSync.ts`)
- **Responsive layout** — mobile drawer sidebar and write/preview tab switcher under 820px

## Tech stack
| Layer | Technology | Notes |
|---|---|---|
| Framework | Next.js **16.2.12**, **App Router** (`src/app`) | README says "Next.js 15" — outdated |
| UI runtime | React 19.2.4, TypeScript 5 | `"jsx": "react-jsx"` |
| Database | **Dexie.js 4.4.4** (IndexedDB) | No server DB |
| ORM | none | Dexie tables are used directly |
| Auth | none | No login, no auth library |
| State management | React Context (theme only) + custom hooks | No zustand/redux/jotai |
| Styling | Tailwind CSS v4 + CSS variables | Tailwind imported but barely used; UI is mostly inline styles |
| UI library | none | Hand-rolled components |
| Markdown | `marked` 18 + `katex` 0.18 | |
| PDF export | `html2pdf.js` 0.14 | dynamic import |
| P2P | `@trystero-p2p/torrent` 0.25.3 (WebRTC over BitTorrent trackers) | |
| TURN/STUN | Metered.ca TURN API + Google STUN fallbacks | `src/lib/turn.ts` |
| Compression | Native `CompressionStream` (gzip) | `src/lib/sync.ts` |
| Hashing | Native `SubtleCrypto` SHA-256 | `src/lib/hash.ts` |
| Deployment target | Vercel (static export) per README | Not enforced in `next.config.ts` (empty config) |

Unused dependencies in `package.json`: `uuid` (code uses `crypto.randomUUID()`), `next-themes` (custom `ThemeProvider` used instead).

## High-level architecture
```
┌────────────────────────────  Browser  ────────────────────────────┐
│  layout.tsx  (server component)                                    │
│    └─ ThemeProvider (context)                                      │
│       └─ page.tsx  (client, entire SPA)                            │
│           ├─ useNotes()  ──►  Dexie "NotebookDB" (IndexedDB)       │
│           │                  notes table / pairings table          │
│           ├─ useSync()   ──►  Trystero rooms (WebRTC P2P)          │
│           │                  └─ TURN creds (Metered) + BT trackers │
│           └─ components: Sidebar, Editor, PairDevice, SyncButton   │
└────────────────────────────────────────────────────────────────────┘
```

- **Frontend** = the entire app; there is no separate backend or API server.
- **Data** is read/written directly from the browser to IndexedDB via Dexie (`src/lib/db.ts`), wrapped by hooks.
- **Sync** is device-to-device: BitTorrent trackers and Metered TURN/STUN are used only for signaling / NAT traversal; note content travels peer-to-peer.
- The only HTTP call in the codebase is to the Metered TURN credentials endpoint (`src/lib/turn.ts`).
- There is no route-level data fetching, no React Query/SWR, and no server-side rendering of user data.
