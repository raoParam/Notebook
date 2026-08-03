# Notebook

A local-first markdown notebook with **peer-to-peer device sync** — no server, no database, no cloud account required.

## Features

- ✍️ **Markdown editor** with live split preview, toolbar (bold/italic/headings/links/code/tables/…), and KaTeX math rendering
- 🎨 **Drawing canvas** — pen/eraser tool, insert drawing as embedded image
- 📎 **Image attachments** — upload, resize, embed in notes; stored in IndexedDB as base64
- 📤 **Export** — download as `.md` or styled `.pdf` (html2pdf.js)
- 📥 **Import** — open any `.md` file as a new note
- 🌙 **Light / dark theme** — no flash on load
- 📱 **Responsive** — mobile drawer sidebar, tab switcher between edit/preview
- 🔄 **Peer-to-peer sync** via Trystero (WebRTC over BitTorrent trackers)

## Sync — How it works

1. **Pair devices once** — one device generates a 12-char room code, the other enters it. Both store the code locally; no re-entry needed on future sessions.
2. **Background presence** — on app load, both devices silently join their shared Trystero rooms. A green dot on the Sync button indicates a live peer connection.
3. **Manual sync** — tap **Sync** when both devices are online. Each side exchanges a compact manifest (note IDs + content hashes + timestamps), diffs it, and transfers only changed notes — compressed with gzip (native `CompressionStream`).
4. **Last-write-wins** — conflicts resolved by `updatedAt` timestamp. No manual merge UI needed.

> ⚠️ Sync requires **both devices to be online simultaneously**. There is no offline queue — changes are not delivered to an offline device.

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router), TypeScript |
| Styling | Tailwind CSS v4 |
| Storage | Dexie.js (IndexedDB) |
| Markdown | marked + KaTeX |
| PDF export | html2pdf.js |
| P2P signaling | @trystero-p2p/torrent (WebRTC) |
| Compression | Native `CompressionStream` (gzip) |
| Hashing | Native `SubtleCrypto` SHA-256 |
| Deployment | Vercel (static export) |

## Getting Started

```bash
npm install
npm run dev       # http://localhost:3000
npm run build     # production static export → ./out/
```

## Deploying to Vercel

Push to GitHub and import the repo on [vercel.com](https://vercel.com). No environment variables required — everything runs in the browser.

## Data Storage

All notes live in **IndexedDB** (`NotebookDB`) on each device. Nothing is sent to any server. The Trystero WebRTC connection uses public BitTorrent trackers only for signaling (exchanging ICE candidates) — note content travels directly peer-to-peer.

## Project Structure

```
src/
  app/
    layout.tsx          — Root layout, fonts, theme init
    page.tsx            — Main notebook page
    globals.css         — Design tokens + Tailwind base
  components/
    ThemeProvider.tsx   — Class-based dark mode
    Sidebar.tsx         — Note list, sort, add/delete
    Editor.tsx          — Title + markdown textarea + split preview
    Toolbar.tsx         — Formatting commands + actions
    MarkdownPreview.tsx — marked + KaTeX renderer
    DrawingCanvas.tsx   — Pointer-event canvas with pen/eraser
    PairDevice.tsx      — Generate/enter room code, manage pairings
    SyncButton.tsx      — Sync trigger with status states
  hooks/
    useNotes.ts         — Dexie CRUD + sort + active note state
    useSync.ts          — Trystero rooms, presence, sync engine
  lib/
    db.ts               — Dexie schema (Note, Pairing)
    hash.ts             — SHA-256 via SubtleCrypto, room code gen
    sync.ts             — Manifest diff, CompressionStream compress/decompress
```
