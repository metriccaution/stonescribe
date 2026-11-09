---
tags:
  - feature
column: Backlog
created: 2026-11-09T16:15:33
updatedAt: 2026-11-09T16:27:33
order: 10
---
Some sort of search for the front-end.

- Text search - This might be possible, but gets impractical for large bodies of notes, and given that the notes are the source of truth, a text index isn't something I really want to do.
- Tag search - Filtering by tags etc.

## Scope: filter the current board

Vault-wide search is out of scope for now. The two kinds of search have different costs, so they're split:

- **Metadata filters (tags, name, due, column)** run in the client. That data is small and already in the board response.
- **Body text search** runs on the server. Don't assume card bodies are available in the client.

Today `GET /api/board` sends every card's full body, but that won't scale to big boards or long notes. The board view only uses bodies for checklist progress (`☑ 2/5`), which the server could compute, and the card modal could fetch its own body when opened. Trimming that payload is a separate change ([[Slim board payload]]). Search shouldn't come to depend on bodies being there.

## Proposal

A filter box in the top bar. Cards that don't match are hidden, and column counts show matches (e.g. `2/7`). Query syntax:

- Plain words: case-insensitive match on card name (client) and body (server, see below)
- `#tag`: card has this tag (several `#tag`s = AND)
- Maybe later: `due:overdue`, `due:week`, `-#tag` for exclusion
- Clicking a tag chip on a card adds it to the filter

Keep the query in the URL (`?q=`) like `board` and `card`, so filtered views can be bookmarked.

### Body text search without an index

Add `GET /api/board/search?board=…&q=…`, which reads the board's card files on demand and returns only the matches: card names, plus a short snippet around the first hit to show on the tile.

- The notes stay the only source of truth. Nothing is cached or indexed, so there's nothing to go stale.
- Scanning one board's files is cheap. The server already reads them all for every `getBoard`. If that ever gets slow, a cache keyed on file mtime is an easy upgrade.
- Debounce in the client (~250ms) and cancel stale requests with `AbortController`.
- Metadata-only queries (just `#tag`s) skip the request entirely.

## Open questions

- Should body search be scoped to the current board only, or could the same endpoint search the whole vault later? A vault-wide scan per keystroke is the point where an index starts to make sense.
- Should dragging be disabled while a filter is active? Hidden cards make drop positions ambiguous: does index 0 mean the top of the visible cards or of all cards?
- Should the filter persist across board switches?

## Done when

- [ ] `#tag` and name filtering on the current board, client-side
- [ ] Body text search via a server endpoint, without needing bodies in the board payload
- [ ] Filter state in the URL
- [ ] Drag behaviour with an active filter decided and implemented
