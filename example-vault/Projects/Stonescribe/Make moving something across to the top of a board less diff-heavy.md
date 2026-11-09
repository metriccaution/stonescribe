---
tags:
  - feature
column: Backlog
created: 2026-11-09T16:41:28
updatedAt: 2026-11-09T16:52:38
order: 1
---
# Minimising DND Diffs

When I drag something across from one column into another, I'll _usually_ move it to the top (e.g. backlog -> doing, doing -> done), which then edits _every_ other file.

## Cause

`Vault.moveCard` (`src/server/vault.ts`) renumbers the target column as dense `1..n` and writes every card whose `order` changed. Inserting at index 0 shifts every other card down by one, so the whole column is rewritten. In a git-tracked vault (like this one) that's one noisy commit per drag, and it risks merge conflicts with other edits.

## Proposal: sparse ordering

`order` is already validated as any finite number (not just an integer), so no schema change is needed:

- **Top of column:** `order = first.order - 1`. Negative values are fine.
- **Bottom of column:** `order = last.order + 1`.
- **Between two cards:** an integer between the neighbours if there's a gap (e.g. 2 and 5 → 3). If they're adjacent (2 and 3), the midpoint (2.5) is acceptable: integers are preferred but not required.
- Only the moved card is written. Top and bottom (the common cases) always stay integers.
- **Fallback:** if neighbours are missing `order`, have equal values, or the midpoint gets ugly (more than ~3 decimal places), renumber the column as today. This should be rare.
- **Creation** follows the same rule. `createCard` already appends with `max + 1` and writes only the new file; if cards are ever created at the top, use `min - 1`.

## Done when

- [ ] Moving a card to the top, bottom or middle of another column writes exactly one file in the common case
- [ ] Reordering within a column writes exactly one file in the common case
- [ ] Tests in `src/server/vault.test.ts` cover the fallback renumbering
