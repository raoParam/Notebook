# Components

All components in `src/components/` are **client components** (`'use client'`). The only server component in the app is the root layout (`src/app/layout.tsx`).

## Theme / layout
| Component | Client/Server | Props | Purpose |
|---|---|---|---|
| `ThemeProvider` | Client | `children` | Light/dark theme React context (`theme`, `toggle`); syncs `.dark` class on `<html>` and persists to `localStorage` `nb-theme`. Exposes `useTheme()` |

## Note list & navigation
| Component | Client/Server | Props | Purpose |
|---|---|---|---|
| `Sidebar` | Client | `notes: Note[]`, `activeId`, `sortOrder`, `onSelectNote`, `onAddNote`, `onDeleteNote`, `onSortChange`, `onClose?`, `connectedCount`, `onOpenSettings`, `onOpenPairDevice` | Note list with add button, sort dropdown, pair button (with green connected dot), settings button, and per-item delete. Rendered **twice** by `page.tsx` (desktop + mobile variants) |
| `NoteItem` | Client (local, in `Sidebar.tsx`) | `note`, `isActive`, `onSelect`, `onDelete` | Single note row: title, markdown-stripped preview, date, hover delete button |

## Editor
| Component | Client/Server | Props | Purpose |
|---|---|---|---|
| `Editor` | Client | `note: Note`, `onUpdate(patch)`, `onImportNote(title, content)`, `onExportPdf()`, `onExportMd()` | Title input, toolbar, drawing panel, mobile write/preview tabs, and the split markdown/preview panes. Debounces writes (350 ms). Handles markdown insertion, image upload, drawing insert, keyboard shortcuts |
| `Toolbar` | Client | `onCommand(cmd)`, `onImageUpload(file)`, `onToggleDrawing()`, `onOpenMd()`, `onExportPdf()`, `onExportMd()` | Formatting buttons (bold/italic/strike/H1–H3/lists/quote/code/link/hr), image & drawing buttons, and Import / .md / PDF actions. Hidden file inputs for image and `.md` upload |
| `ToolBtn` | Client (local, in `Toolbar.tsx`) | `children`, `title`, `style?`, `onClick` | Small icon/label toolbar button |
| `ActionBtn` | Client (local, in `Toolbar.tsx`) | `children`, `onClick`, `title?` | Larger action button (Import, .md) |
| `MarkdownPreview` | Client | `note: Note` | Renders markdown via `marked` + KaTeX, resolving attachment labels to data URLs. Uses `dangerouslySetInnerHTML` |
| `DrawingCanvas` | Client | `onInsert(dataUrl)`, `onClose()` | Canvas with pen/eraser/color/size, clear, and insert-as-image controls; pointer-event based with DPR-aware resize |

## Sync
| Component | Client/Server | Props | Purpose |
|---|---|---|---|
| `SyncButton` | Client | `syncStatus: SyncStatus`, `connectedCount`, `onSync` | Header sync button with status labels, spinner/check/error icons, connected peer dot, and tooltip summaries |
| `PairDevice` | Client | `pairings: Pairing[]`, `connectedPeerIds: string[]`, `onAddPairing(id, label)`, `onRemovePairing(id)`, `onClose()` | Modal for generating/entering a 12-char room code, naming pairings, listing paired devices with online status, and unpairing |
| `PairBtn` | Client (local, in `PairDevice.tsx`) | `children`, `onClick`, `icon` | Large tappable menu button (Generate / Enter code) |

## App-level / misc
| Component | Client/Server | Props | Purpose |
|---|---|---|---|
| `EmptyState` | Client (local, in `src/app/page.tsx`) | `onNewNote` | Shown when no note is selected; "New Note" CTA |
| `RootLayout` | **Server** (`src/app/layout.tsx`) | `children` | HTML shell, metadata, KaTeX CSS, no-flash theme script, `ThemeProvider` wrapper |

## Notes
- No memoization (`React.memo`) is used on any component; only `useCallback` for event handlers.
- All styling is inline `style` objects + CSS variables; no CSS modules, no component library, and Tailwind utilities are used only in `layout.tsx` (`h-full`, `overflow-hidden`).
