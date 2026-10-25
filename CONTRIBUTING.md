# Contributing

Thanks for helping! A few ground rules keep this repo safe to clone.

## Setup

No install step. You need Node 22 or newer.

```sh
git config core.hooksPath .githooks   # strips AI co-author trailers from your commits
npm start                             # http://127.0.0.1:5173
npm run check                         # security scan + tests
```

## Rules

- **No dependencies and no vendored code.** The game is deliberately third-party-free (Firebase is reached through its REST API, not an SDK).
- **No canvas or WebGL.** All visuals are CSS; JavaScript only builds plain elements with class names.
- **No HTML strings.** Build UI with `h()` from `js/dom.js`.
- **Network access lives in `js/cloud.js` only**, and only to the three Firebase REST hosts. The scanner and the CSP both enforce this.
- **No AI agent config files** in commits (`CLAUDE.md`, `AGENTS.md`, `.mcp.json`, `.claude/` …). Keep them local; they're gitignored.
- **Rule changes need a test** in `tests/engine.test.mjs`. New cards go in `data/cards.json`; run `npm test` (it checks that every card a deck or effect refers to exists) and play a few AI-vs-AI games for balance.
- `npm run check` must pass before you open a pull request.
