---
tags:
  - feature
column: Backlog
created: 2026-11-09T16:28:52
updatedAt: 2026-11-09T18:46:58
order: 4
---

Tags in the card modal (`src/client/components/CardModal.tsx`) are a free-text field, split on spaces and commas. Nothing suggests existing tags, so typos and near-duplicates (`bug` / `bugs`, `doc` / `docs`) are easy to introduce, and you have to remember which tags exist.

## Proposal

- Replace the text field with a chip input: existing tags show as removable chips, and typing shows a dropdown of matching known tags. Enter or comma accepts a suggestion or creates a new tag, and Backspace on an empty input removes the last chip.
- **Suggestion source:** tags used anywhere in the vault, most-used first. That needs a server change, e.g. include `tags` in `GET /api/notes` (the `NoteRef` index), or add a `GET /api/tags` returning `{ tag, count }[]`.
- Keep the schema rules (no spaces/commas, no leading `#`). The input should strip `#` and reject invalid characters as you type, rather than on save.
- Only frontmatter `tags` count. Inline body `#tags` are ignored, since Obsidian reads frontmatter tags fine.

## Done when

- [ ] Chip-style tag input with keyboard support
- [ ] Suggestions drawn from existing tags
- [ ] Keyboard and screen-reader accessible (combobox pattern)
