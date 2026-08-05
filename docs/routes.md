# Routes

## Page routes
The app is a single-page client app. There are no dynamic routes, route groups, or route handlers.

| Path | File | Renders |
|---|---|---|
| `/` | `src/app/page.tsx` | The entire notebook UI: header (sync button, theme toggle), sidebar (note list, add/delete/sort, pair button), editor (title, toolbar, split markdown/preview, drawing panel), empty state, and the device-pairing modal. Renders a loading spinner until notes finish loading from IndexedDB. |

Supporting App Router files:
- `src/app/layout.tsx` — root layout; server component; sets metadata/viewport, loads KaTeX CSS from CDN, injects a no-flash theme script, wraps children in `ThemeProvider`.
- `src/app/globals.css` — global styles (not a route).
- `src/app/favicon.ico` — app icon.

No `loading.tsx`, `error.tsx`, `not-found.tsx`, or `404` pages are defined (framework defaults are used).

## API routes
**Not implemented.** There are no `route.ts` files, no `src/app/api/`, and no `middleware.ts` in the codebase. The app has no server-side HTTP endpoints.

The only outbound HTTP call is client-side from `src/lib/turn.ts`:

| Method | URL | Purpose | Request / Response |
|---|---|---|---|
| GET | `https://{appName}.metered.live/api/v1/turn/credentials?apiKey={key}` | Fetch TURN/STUN ICE servers for WebRTC | No body. Response: array of `{ urls, username?, credential? }`; merged with Google STUN fallbacks; cached in memory for 10 min; falls back to STUN-only on failure |

## Auth protection
- **All routes are public.** No authentication or authorization exists anywhere in the app (no login page, no session checks, no middleware).
- The app is fully local-first; data is never sent to a server.
