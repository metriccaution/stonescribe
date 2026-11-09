---
tags:
  - chore
column: Backlog
created: 2026-11-09T16:30:34
updatedAt: 2026-11-09T16:30:34
order: 5
---

The repo has no linter or formatter config. The code looks prettier-formatted, but nothing enforces it, and CI (the Dockerfile's build stage, `npm run typecheck && npm test && npm run build`) only typechecks and tests.

## Proposal

- **Prettier:** add as a dev dependency, with a `.prettierrc` matching the current style (double quotes, trailing commas, 80 columns) so the first run is close to a no-op. Add a `.prettierignore` for `dist/`, `node_modules/` and `package-lock.json`. Decide whether `example-vault/` is formatted too.
- **ESLint:** flat config (`eslint.config.js`) with `typescript-eslint` (type-aware where cheap), `eslint-plugin-react-hooks` (there are several hand-written `useEffect` / `useMemo` dependency lists), and `eslint-config-prettier` so the two don't fight.
- Scripts: `lint`, `format`, `format:check`.
- CI: add `npm run lint && npm run format:check` to the Dockerfile build step next to typecheck and test.
- Optional: an `.editorconfig` for editors without prettier integration.

## Done when

- [ ] `npm run lint` and `npm run format:check` pass on a clean checkout
- [ ] Both run in the Docker build, so PRs fail on violations
- [ ] Development section of the README mentions them
