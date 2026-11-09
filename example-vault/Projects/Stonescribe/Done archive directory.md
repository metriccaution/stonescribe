---
tags:
  - feature
column: Backlog
created: 2026-11-09T17:05:36
updatedAt: 2026-11-09T19:01:51
order: 8
---
Optionally - allow a board to designate directories per-column.

Main use case here is I'd ideally prefer to keep working directories clear of done items.

## Context

At the moment a card's file never moves. `column` in frontmatter decides the column, and new cards go to `defaultDirectory` or the board folder. A busy board's working directory fills up with finished cards.

Board config has to stay as flat properties and plain text lists, because Obsidian's properties UI can't edit lists of objects. So per-column `{ name, directory }` entries are out.

## Proposal

Make it about *done* columns rather than arbitrary per-column directories, using two new board properties:

```yaml
columns:
  - Backlog
  - Doing
  - Done
  - Won't do
doneColumns:      # optional: plain list, each must be in `columns`
  - Done
  - Won't do
doneDirectory: Done   # optional: folder (inside the board) for cards in a done column
```

(Name to settle: `doneColumns` matches `columns`/`defaultColumn`, versus `doneStates`.)

Behaviour:

- `column` in frontmatter is still the source of truth for which column a card is in. The directory is only where the file is kept, so a hand-moved file isn't treated as a column change.
- Moving a card **into** a done column via the app moves its file to `doneDirectory`. Moving **out** of one moves it back to `defaultDirectory` (or the board folder).
- Moving between two done columns doesn't move the file.
- Only move files that are in a "managed" location (the board folder, `defaultDirectory` or `doneDirectory`). A card deliberately filed in a sub-folder (e.g. `Docs/`) stays put. Open question: is that the right rule?
- Creating a card directly in a done column puts it in `doneDirectory`.
- Same path-safety check as `defaultDirectory` (must stay inside the board folder). A `doneColumns` entry that isn't in `columns` is flagged as a board issue (⚠).
- `doneDirectory` without `doneColumns` does nothing (or is flagged). `doneColumns` without `doneDirectory` is still useful on its own (see below).

## Other uses for `doneColumns`

Once the board knows which columns are "done", it could:

- Stop showing due dates as overdue on done cards.
- Optionally exclude done cards from [[Search]] by default.
- Help [[Agent guidance]]: agents know which column means finished.

## Knock-on effects

- `[[Name]]` links keep working since they resolve by name. Path-qualified links (`[[Projects/Stonescribe/Foo]]`) need rewriting, using the same machinery as renames (`rewriteLinks`).
- The README currently promises "moving a card between columns doesn't touch the file's name or location". That becomes "...unless `doneDirectory` is set".
- Git sees a move as a rename. That's still one file, so it fits with [[Make moving something across to the top of a board less diff-heavy]].
- Renaming or deleting a column has to update `doneColumns` as well as `columns`.

## Done when

- [ ] `doneColumns` and `doneDirectory` board properties, validated in `boardSchema`
- [ ] Moving into or out of a done column moves the file, and path-qualified links are rewritten
- [ ] Creating a card in a done column puts it in `doneDirectory`
- [ ] Column rename and delete keep `doneColumns` in sync
- [ ] Tests in `src/server/vault.test.ts`, README updated
