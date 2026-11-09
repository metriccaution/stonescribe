---
tags:
  - bug
column: Backlog
created: 2026-11-09T17:05:15
updatedAt: 2026-11-09T18:52:23
order: 7
---
Especially with tables - content overflows the rendered preview view when it gets too wide. It should be scrollable.

## Cause

`.markdown` content in `src/client/styles.css` has no overflow handling. A GFM table, or a long line in a code block, keeps its natural width and pushes past `.body-preview`'s border and out of the 640px modal. The board description at the top of the page uses the same `Markdown` component, so it has the same problem.

## Proposal

Contain wide content in the markdown styles, not per container:

- Tables: wrap in a scroll container, or `.markdown table { display: block; overflow-x: auto; max-width: 100%; }`.
- Code blocks: `.markdown pre { overflow-x: auto; }` (no wrapping, so code stays readable).
- Images and embeds: `max-width: 100%`.
- Long unbroken text (URLs, paths): `overflow-wrap: anywhere` on `.markdown`.

Only the overflowing element should scroll, not the whole preview, so normal text still wraps to the width.

## Done when

- [ ] A wide table and a long code line in a card scroll horizontally inside the preview
- [ ] Same in the board description
- [ ] Nothing in the modal causes horizontal page scroll, including at phone width
