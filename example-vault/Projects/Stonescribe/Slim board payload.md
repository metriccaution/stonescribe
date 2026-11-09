---
tags:
  - feature
column: Backlog
created: 2026-11-09T17:05:00
updatedAt: 2026-11-09T18:48:53
order: 6
---

`GET /api/board` returns every card's full markdown body. The SSE watcher triggers a refetch of the whole board, and the note index, on **any** change in the vault. So a big board with long notes means lots of data over the network on every edit, most of which isn't shown.

## Where bodies are used in the client

- `CardTile` (`src/client/components/BoardView.tsx`): only to count `- [ ]` / `- [x]` for the checklist badge.
- `CardModal`: to show and edit the body of the one open card.

## Proposal

- Count checklist items on the server and send `tasks: { done, total }` per card, not `body`.
- Add `GET /api/board/cards/:card` (or `?body=1`) so the modal fetches the body when it opens.
- Watch for edits arriving from disk while the modal is open. It currently gets a fresh `card` from each board reload, so it'll need to refetch the body on change events instead.
- Possibly later: send the changed paths in SSE events so the client can skip reloads for other boards.

## Done when

- [ ] Board response contains no card bodies
- [ ] Checklist progress still shows on tiles
- [ ] Card modal loads and saves the body on its own
