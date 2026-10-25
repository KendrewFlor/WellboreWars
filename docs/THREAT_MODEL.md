# Threat model

## Assets

1. **Visitors' browsers.** Anyone who opens the GitHub Pages site runs this code.
2. **Contributors' machines.** Anyone who clones the repo and runs a script, or opens it in an AI coding agent.
3. **The maintainer's GitHub account and CI.** Push access, the Pages deployment, Actions tokens.
4. **The optional Firestore leaderboard.** Its data, and the free-tier quota behind it.

## Attack surfaces and controls

### Supply chain

- **npm.** There is no dependency tree to poison. CI enforces this (`scripts/security-scan.mjs`).
- **Third-party code.** None. Visuals are CSS, sound is WebAudio, card data is a local JSON file, and Firebase is reached with plain `fetch` calls to its REST API rather than the Firebase SDK. The scanner rejects non-local imports, dynamic `import()`, canvas/WebGL, and network calls outside `js/cloud.js`.
- **GitHub Actions.** Pinned to commit SHAs, so a moved tag can't change what runs. Tokens are read-only except where a job genuinely needs more (CodeQL `security-events`, Pages `pages`/`id-token`), and those are scoped per job.
  - *Residual risk:* `actions/upload-pages-artifact` is a composite action that calls other actions by tag internally. Pinning the outer SHA fixes its code but not those inner references. The job that runs it has no write token.

### Prompt injection (against people using AI agents on this repo)

AI coding agents read files and treat some of them as instructions. An attacker can try to plant text that the agent obeys and the human never sees.

| Vector | Control |
|---|---|
| Auto-loaded instruction files (`CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `.github/copilot-instructions.md`, `.claude/`, `.wolf/` …) | Gitignored and banned by the scanner unless explicitly listed in `.agent-files-allowlist` after review. |
| Repo-level MCP config (`.mcp.json`) that launches a server on clone | Gitignored and banned by the scanner. |
| Hidden text: zero-width characters, bidi overrides (Trojan Source), Unicode tag characters | Scanner rejects them in every text file. |
| HTML comments in Markdown (invisible on GitHub, visible in raw files) | Scanner rejects them. |
| Imperative bait in card text, docs or comments: text telling an agent to discard its earlier instructions, to run or download something, or to pipe a download into a shell | Pattern-matched by the scanner in docs, code comments and `data/cards.json`. |
| Malicious pull requests adding any of the above | CI runs the scanner on every PR; branch protection should require it to pass. |

Pattern matching can't catch every phrasing, so **review PRs that touch docs, card text or configuration as carefully as code.**

### Browser runtime

- **CSP** (meta tag, plus HTTP headers from the dev server): only same-origin scripts and styles; `connect-src` limited to this site and the three Firebase hosts; no forms, plugins, workers or `<base>` rewriting.
- **No HTML injection path.** `js/dom.js` never parses HTML. `h()` blocks `on*` and `style` attributes and only allows `#`, `./` and `https://` links. Styles are set through the CSSOM (`style.setProperty`), which the CSP allows without `'unsafe-inline'`.
- **Local storage** is the only local input. It is validated before use (`validateProfile`, with tests for prototype pollution, wrong types, unknown cards, oversized values and impossible counts).
- **Firestore responses** are untrusted. Size-capped, parsed as JSON, then each row is re-checked (name pattern, non-negative integers) before it's shown.

### Optional leaderboard (Firestore)

| Threat | Control | Residual risk |
|---|---|---|
| Writing to someone else's row | Rules: `request.auth.uid == uid` | None known |
| Extra fields, scripts or huge strings | Rules: exact key whitelist, `name` 2–16 chars of `[A-Za-z0-9 _.-]`, integer counters | Names aren't profanity-filtered; the maintainer can delete rows |
| Inflating wins in one request | Rules: at most one new result per write; counters can't decrease | — |
| Spamming fake wins | Rules: one write per 30 s per player, server timestamp required | A script can still add one fake result every 30 s, and can make new anonymous IDs. Without a game server, results can't be proven. Don't attach prizes. |
| Draining the free quota | Capped list queries (≤ 25), Spark plan has no billing so the worst case is a paused leaderboard, key restricted by referrer and API | Referrers can be forged outside a browser |
| Reading private data | Only name/wins/losses exist; everything else is denied | Names and records are public by design, and the player opts in |
| Session token theft | ID tokens are short-lived and only allow writing the player's own row | Stored in local storage, like any client-side session |

### Things this project deliberately does not have

A game server, passwords, cookies, analytics, third-party scripts, payment processing, file uploads, chat, or any user-generated content beyond a 16-character name.
