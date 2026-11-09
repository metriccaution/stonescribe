---
tags:
  - docs
column: Done
created: 2026-11-09T15:51:55
updatedAt: 2026-11-09T19:12:00
order: -2
---
Would putting agent-specific guidance into how boards work be useful?

Some easily copy-pasteable notes about how to use it would be handy for where this is being used in-place.

## Context

Boards are plain markdown, so a coding agent (Claude Code, Codex, etc.) can read and update them directly, which is what this repo does with its own issues. But an agent has to work out the conventions from the README. That's easy to get subtly wrong, e.g. hand-editing `order` on every card, forgetting `column`, or renaming a file without fixing `[[links]]`.

## Proposal

Write a short, self-contained block that can be pasted into a project's `CLAUDE.md` / `AGENTS.md`, covering:

- How to find the board: the folder holding the note with `kanban: board`. Its `columns` list is the set of valid column names.
- Creating a card: a new `.md` file anywhere under the board folder (or in `defaultDirectory`), with `column` set. Card names are unique across the vault, so check before creating one.
- Moving a card: change `column` only. The file stays where it is.
- Properties to leave alone or treat with care: `order` (UI-managed; omit it on new cards and they sort after ordered ones), `created`, `updatedAt`.
- `tags` is a list without `#`, and `due` uses `YYYY-MM-DDTHH:MM:SS` (midnight means "that day").
- Unknown frontmatter is preserved, so other properties are safe to add.
- Renaming a card means updating `[[wikilinks]]` to it across the vault (the app does this, but a hand edit doesn't).
- Body conventions: `- [ ]` checklists show progress on the card.
- This should be in the README - but should be as concise as possible, it shouldn't dominate the document.

## Done when

- [x] Copy-pasteable guidance block written and linked from the README
- [x] This repo's own `CLAUDE.md` uses it to point at `example-vault/Projects/Stonescribe/`
