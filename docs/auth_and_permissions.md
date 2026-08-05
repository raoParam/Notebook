# Auth & Permissions

## Auth provider / method
**Not implemented.** There is no authentication of any kind:
- No auth library in `package.json` (no NextAuth, Clerk, Lucia, etc.).
- No login/register pages, no sessions, no tokens, no cookies.
- No `middleware.ts`, so there are no route guards.

This is intentional for a local-first app — the README states "no cloud account required" and everything runs in the browser.

## Session handling
- **No sessions.** App state is entirely local:
  - Notes & pairings persist in IndexedDB (`NotebookDB`).
  - UI preferences (`nb-active-id`, `nb-sort`, `nb-theme`) persist in `localStorage`.
- "Session" is implicitly the browser profile; clearing IndexedDB/localStorage wipes all data.

## Role / permission logic
**Not implemented.** There are no users, roles, or permissions. Every device that runs the app has full access to its own local data.

## Peer-to-peer sync security (what exists)
- Sync happens over WebRTC between devices that share a secret-ish 12-char room code (`generateRoomCode`, `src/lib/hash.ts`).
- The room code is stored locally as a `Pairing`; any device that obtains the code can join the room and exchange notes.
- **There is no encryption at rest or in transit beyond WebRTC's built-in DTLS** — note content is transferred over the P2P connection.
- **Committed secret**: `src/lib/turn.ts:32` contains a hardcoded Metered.ca TURN API key as a fallback (see `known_gaps.md`).
