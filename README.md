# Stonescribe

A kanban board backed by markdown files on disk, inspired by [Tasks.md](https://github.com/BaldissaraMatheus/Tasks.md), but with metadata stored inside of frontmatter, rather than config files. Intended for easy compatibility with [Obsidian](https://obsidian.md/).

## Running

```bash
npm install
npm run build
npm start -- /path/to/vault        # or STONESCRIBE_VAULT=/path/to/vault npm start
```

Then open <http://127.0.0.1:3001>. Set `PORT` / `HOST` to change where it listens (use `HOST=0.0.0.0` inside a container).

## Docker

```yaml
services:
  stonescribe:
    image: ghcr.io/metriccaution/stonescribe:latest
    ports:
      - "3001:3001"
    volumes:
      - /path/to/vault:/vault
    user: "1000:1000" # uid:gid that owns the vault on the host
    restart: unless-stopped
```

## Vault layout

A board is a folder holding a **board note**: any note whose frontmatter has `kanban: board`.

For example:

```markdown
---
kanban: board
defaultColumn: Backlog
columns:
  - Backlog
  - Doing
  - Done
---

This text is shown at the top of the board.
```

Notes in that folder, or in any folder below it, are the board's cards.

```
Vault/
  Projects/
    Stonescribe/
      Stonescribe.md          # board note: columns and settings
      Board view.md           # card
      Docs/
        Write README.md       # card
```

### Board Note

Any folder in the vault that directly holds a note with `kanban: board` is a board. The board takes its name from that note. Boards don't nest, everything below a board's folder belongs to it, including any other `kanban: board` notes in sub-folders. Board notes are never cards. If one folder holds more than one board note, the first by file name is used and the board shows a ⚠. Dot-folders (`.obsidian/`, `.git/`, …) are ignored.

```yaml
---
kanban: board
columns: # column names, in display order
  - Backlog
  - Doing
  - Done
defaultColumn: Backlog # optional: makes notes without a `column` cards in this column
defaultDirectory: Tasks # optional: folder (inside the board) where new cards are created
---
Optional description, shown above the board.
```

Frontmatter properties:

- `columns` is a plain list of names.
- `defaultColumn` if set, _any_ note within the board is shown as a card, anything without the `column` frontmatter property is put here. If unset, only notes with the `column` frontmatter property are shown in the board.
- `defaultDirectory` - The directory (relative to the board file) where notes created in the web UI will be landed

### Card Notes

Markdown files, configured by frontmatter properties. Stonescribe will persist any frontmatter that it doesn't recognise as its own.

```yaml
---
tags: [bug, auth]
column: Doing # which column the card is in
created: 2026-11-03T14:22:05
updatedAt: 2026-11-04T09:15:40
due: 2026-11-10T00:00:00 # midnight means "due that day"
order: 3 # position in the column; rewritten on drag
---
Card body in markdown. `- [ ]` checklists show progress on the card.
```

Frontmatter properties:

- `column` - Which column this note should appear in
- `created` - date-time Stonescribe created the note at, e.g. `2025-01-22T00:00:00`
- `updatedAt`- date-time Stonescribe last updated the note, e.g. `2025-01-22T00:00:00`
- `due`- date-time for due date, e.g. `2025-01-22T00:00:00`
- `order` - Card sorting within a column

## Links

Notes are linked with `[[wikilinks]]`. The format is shared by Obsidian, Foam, Logseq and others, but none of them is required.

- **In the app:** a link to a card opens it, even on another board. A link to any other note shows its path on hover, and links to notes that don't exist are dimmed.
- **Renames update links:** renaming a card rewrites `[[Old]]`, `[[Old|alias]]`, `[[Old#heading]]` and path-qualified links across the vault. Moving a card between columns doesn't touch the file's name or location, so every link keeps working.

## Development

For development, run `npm run dev` (uses `./example-vault`; set `STONESCRIBE_VAULT` to point it elsewhere). This starts the API with reload-on-change and the Vite dev server on <http://localhost:5173>.

```bash
npm test            # vitest: frontmatter round-tripping and vault operations
npm run typecheck
```

`src/server/vault.ts` holds all the filesystem logic, `src/server/app.ts` is the HTTP API, and
`src/client/` is the React UI.
