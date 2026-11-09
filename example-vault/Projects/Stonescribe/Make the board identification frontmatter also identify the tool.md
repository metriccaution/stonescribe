---
tags:
  - feature
column: Backlog
created: 2026-11-09T16:53:21
updatedAt: 2026-11-09T18:48:04
order: 9
---
We currently use `kanban: board`, but specifying Stonescribe (or maybe a repo URL) might make this more self-documenting if found in a repo by someone unfamiliar with it.

## Context

A board is recognised by `kanban: board` (`isBoardNote` in `src/server/vault.ts`, and the `kanban` literal in `boardSchema` in `src/shared/schema.ts`). To someone browsing a repo or vault, that says "kanban" but not which tool reads it or where its docs are. It's also a fairly generic key that another plugin or tool could plausibly use too.

The tool is new enough that a **breaking change is fine**: no legacy alias, no migration path.

## Options

1. **Tool-named key:** `stonescribe: board`. Short, unambiguous and searchable, but the value doesn't link anywhere.
2. **Key plus URL:** `stonescribe: https://github.com/metriccaution/stonescribe`. Self-documenting, and any non-empty value marks a board. Long, and ties notes to a repo URL that might move.
3. **Keep `kanban: board` and add an informational property:** e.g. `kanban: board` + `tool: stonescribe`. Two keys to remember for little gain now that compatibility isn't a concern.

Leaning towards (1). If a pointer to the docs is wanted, `createBoard` could also write a YAML comment (`# https://github.com/metriccaution/stonescribe`); the YAML writer keeps comments on untouched keys.

## Changes

- Replace the `kanban` literal in `boardSchema` and the check in `isBoardNote`, and update the messages that mention `kanban: board` (the duplicate-board-note warning and the empty-vault hint in `App.tsx`).
- `createBoard` writes the new form.
- Update the README, tests and the example vault (`Stonescribe.md`, `Secondary Board.md`) in the same change. Old-style notes simply stop being boards.

## Done when

- [ ] New identifying property chosen and documented in the README
- [ ] Code, tests and example vault switched over, with no references to `kanban: board` left
- [ ] [[Agent guidance]] mentions the new form
