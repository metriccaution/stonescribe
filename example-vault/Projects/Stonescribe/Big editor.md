---
tags:
  - feature
column: Done
created: 2026-11-09T17:05:05
updatedAt: 2026-11-09T18:51:33
order: -3
---
Editing large bodies of text is awkward in a small modal, it would be good to have a view for a bigger editor - though as a toggle, or a link to another screen, rather than replacing the current view with a bigger one.

## Context

The card modal (`src/client/components/CardModal.tsx`) is capped at `max-width: 640px`. The body editor is a `textarea` with a 220px minimum height (vertically resizable), and **Edit** and **Preview** are separate tabs. That's fine for a few lines, but cramped for long notes or tables.

## Proposal

Add an **expand** button (⤢) to the modal header that switches to a full-window editing view, without changing the default modal:

- Takes over the viewport, with editor and preview **side by side** (stacked on narrow screens), so you don't keep flipping tabs.
- Keeps the modal's properties (tags, due) in a slim bar at the top, or leaves them out of the big view entirely.
- Stored in the URL (e.g. `?board=…&card=…&view=full`) so it survives a refresh and can be opened directly or in a new tab. That's the "link to another screen" option, and it costs little since board and card are already in the query string.
- Escape or the collapse button returns to the normal modal with unsaved edits intact (same component state, different layout), not a separate editor with its own copy of the text.

## Notes

- With [[Slim board payload]], the body would be fetched per card. Both views should share that fetch.
- The textarea is plain for now; a proper editor (CodeMirror etc.) would be a separate card.
- Wide content in the preview needs [[Items render off the side of the ticket view]] fixed too.

## Done when

- [x] Expand/collapse toggle on the card modal, with no loss of unsaved edits
- [x] Full view shows editor and preview side by side, stacking on narrow screens
- [x] Full view is addressable by URL
