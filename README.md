# Stonescribe

A kanban board whose data is plain markdown in a folder (a "vault"). Boards and columns are
folders, cards are notes, and every setting lives in YAML frontmatter, so there are no config files.
It works with Obsidian and similar tools, but doesn't need them.

Inspired by [Tasks.md](https://github.com/BaldissaraMatheus/Tasks.md).

## Running

```bash
npm install
npm run build
npm start -- /path/to/vault        # or STONESCRIBE_VAULT=/path/to/vault npm start
```

Then open <http://127.0.0.1:3001>. Set `PORT` / `HOST` to change where it listens
(use `HOST=0.0.0.0` inside a container).

For development, run `STONESCRIBE_VAULT=./example-vault npm run dev`. This starts the API with
reload-on-change and the Vite dev server on <http://localhost:5173>.

## Vault layout

Every folder that belongs to a board has a **self-named note** (the "folder note" convention), so
the app needs no hidden files:

```
Vault/
  Projects/
    Stonescribe/
      Stonescribe.md          # board note
      Backlog/
        Backlog.md            # column note (optional)
        Docker image.md       # card
      Doing/
        Doing.md
        Board view.md
```

### Board note: `<Board>/<Board>.md`

Any folder in the vault whose self-named note has `kanban: board` is a board. Dot-folders
(`.obsidian/`, `.git/`, …) are ignored.

```yaml
---
kanban: board
tagColors:          # named colour or any CSS colour
  bug: red
  feature: blue
---
Optional description, shown above the board.
```

### Columns: sub-folders of the board

Each sub-folder is a column. Its self-named note is optional:

```yaml
---
order: 2            # display order; folders without one go last, alphabetically
color: blue         # accent colour
limit: 3            # WIP limit; the count turns red when it's exceeded
---
Optional description, shown when you hover over the column header.
```

### Cards: every other `.md` file in a column folder

```yaml
---
tags: [bug, auth]
created: 2026-11-03T14:22:05
updatedAt: 2026-11-04T09:15:40
due: 2026-11-10T00:00:00   # midnight means "due that day"
order: 3            # position in the column; rewritten on drag
---
Card body in markdown. `- [ ]` checklists show progress on the card.
```

Named colours: `red orange yellow green teal blue purple pink gray`.

## Properties

The properties above form a schema (`src/shared/schema.ts`). The server and the UI both use it.

| Note   | Property    | Required (default) | Type                                         |
| ------ | ----------- | ------------------ | -------------------------------------------- |
| Board  | `kanban`    | yes (`board`)      | the literal `board`                          |
| Board  | `tagColors` | yes (`{}`)         | map of tag → colour text                     |
| Column | `order`     | no                 | number                                       |
| Column | `color`     | no                 | non-empty text                               |
| Column | `limit`     | no                 | whole number above 0                         |
| Card   | `tags`      | yes (`[]`)         | list of tags: no spaces or commas, no `#`    |
| Card   | `created`   | no                 | date-time, e.g. `2025-01-22T00:00:00`        |
| Card   | `updatedAt` | no                 | date-time, set by the app (see below)        |
| Card   | `due`       | no                 | date-time, e.g. `2025-01-22T00:00:00`        |
| Card   | `order`     | no                 | number                                       |

Date-times are local and have no time zone. A card created in the app gets the current time as
`created` and `updatedAt`. `updatedAt` is bumped whenever the app edits the card's properties or
body, renames it, or moves it to another column. It isn't bumped by saves that change nothing,
by reordering within a column, or by the `order` renumbering of the cards around a dragged one.
Edits made with other tools don't update it. The due-date picker sets the date and keeps the existing time, or midnight if there
wasn't one. A midnight `due` counts as the whole day: it's shown without a time and becomes
overdue the next day.

- **Writes are strict.** The API rejects invalid values with a 400 (for example `tags: 5` or
  `due: tomorrow`), and every write from the app puts the required properties on disk. A note
  created by hand without `tags` gets `tags: []` the first time the app writes to it.
- **Reads are lenient.** Files edited elsewhere may not match the schema. Missing required
  properties take their defaults, and invalid values are reported as issues (⚠ on the card, with
  details in the editor). Where a value can be coerced unambiguously, such as `tags: "a, b"`,
  `tags: 5` or `due: 2025-01-22` (→ `2025-01-22T00:00:00`), the coerced value is used and written back on the next save. Anything else (for
  example `due: next week`) is kept on disk as-is until you replace or clear it.
- **Other properties are never touched.** Keys outside the schema, YAML comments, and the
  formatting of unchanged keys survive every write.

## Links

Notes are linked with `[[wikilinks]]`. The format is shared by Obsidian, Foam, Logseq and others,
but none of them is required.

- **Unique names:** wikilinks resolve by file name. New and renamed cards (and boards) must have a
  name that's unique across the whole vault, compared case-insensitively. Column notes are exempt,
  so two boards can each have a `Todo` column. Names with characters that are invalid in file
  names or break wikilinks (`\ / : * ? " < > | # ^ [ ]`) are refused.
- **In the app:** a link to a card opens it, even on another board. A link to any other note shows
  its path on hover, and links to notes that don't exist are dimmed.
- **Renames update links:** renaming a card rewrites `[[Old]]`, `[[Old|alias]]`, `[[Old#heading]]`
  and path-qualified links across the vault. Moving a card between columns keeps its name, so bare
  links keep working.
- **Live sync:** the server watches the vault, so edits made with any other tool show up on the
  board immediately.

## Development

```bash
npm test            # vitest: frontmatter round-tripping and vault operations
npm run typecheck
```

`src/server/vault.ts` holds all the filesystem logic, `src/server/app.ts` is the HTTP API, and
`src/client/` is the React UI.
