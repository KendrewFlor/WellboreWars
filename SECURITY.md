# Security policy

## Reporting a vulnerability

Please use GitHub's **private vulnerability reporting** (Security tab → "Report a vulnerability"). Don't open a public issue. You'll get an acknowledgement within 7 days.

## What Wellbore Wars is and isn't

Wellbore Wars is a static, client-side card game hosted on GitHub Pages. It has **no game server, no passwords, no payments and no third-party code**. Your collection, decks and records live in your browser's local storage.

The one online feature is an **optional** global leaderboard on Cloud Firestore. It is off unless the repository owner adds a Firebase project ([docs/FIREBASE_SETUP.md](docs/FIREBASE_SETUP.md)), and each player must also opt in under Settings. It sends an engineer name, a win count and a loss count, and nothing else.

## Protections in this repository

| Threat | Control |
|---|---|
| Malicious npm dependency / install script | Zero dependencies. `package.json` is checked for empty dependency fields and no lifecycle scripts; `.npmrc` sets `ignore-scripts=true` as a backstop. |
| Tampered third-party library or SDK | There is none. Visuals are CSS, sound is synthesised with WebAudio, and Firebase is called through its REST API with `fetch`, not the Firebase SDK. The scanner rejects any import that isn't a local `./file.js` (or the bundled `../data/cards.json`). |
| Compromised CDN or injected script | CSP: `script-src 'self'`, `style-src 'self'`, no inline scripts or styles. `connect-src` allows only this site and the three Firebase REST hosts. |
| Network calls hidden in game code | The scanner allows `fetch` and remote URLs **only** in `js/cloud.js`, and only to `identitytoolkit.googleapis.com`, `securetoken.googleapis.com` and `firestore.googleapis.com`. |
| Compromised GitHub Action | Every action is pinned to a full commit SHA; Dependabot proposes reviewed bumps. Workflows use a read-only token, `persist-credentials: false`, and never use `pull_request_target`. |
| XSS | The UI is built with a DOM helper that only creates text nodes and rejects event and style attributes. `innerHTML`, `eval`, `new Function` and `document.write` are banned by the scanner. Leaderboard rows from Firestore are re-validated (name pattern, integer ranges) before display. |
| Tampered save data | Local storage is untrusted: schema-validated, numbers range-checked, unknown cards and achievements dropped, prototype-pollution keys ignored. Pack contents are re-derived from a seed. |
| Leaderboard abuse | `firestore.rules`: owner-only writes, exact field whitelist, name pattern, at most one result per write, counters can't decrease, one write per 30 s, server timestamps, capped list queries, everything else denied. See [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) for what this can't stop. |
| Prompt injection against AI coding agents | No agent instruction files are committed. The scanner fails on agent config files (`CLAUDE.md`, `AGENTS.md`, `.mcp.json`, `.claude/` …), hidden/bidi Unicode, HTML comments in Markdown, and common injection phrases. |
| Leaked secrets | The scanner checks for common key formats (Anthropic, OpenAI, GitHub, AWS, Google, Slack, Cloudflare, private keys). The public Firebase web key is allowed only in `js/config.js`. |

Run every check locally with `npm run check` (Node 22+, nothing to install).

## Recommended GitHub settings for the maintainer

These live in repository settings, not in code, so they have to be switched on by hand:

1. Turn on **two-factor authentication** for your account.
2. Settings → Code security: turn on **secret scanning**, **push protection**, **Dependabot alerts** and **private vulnerability reporting**.
3. Settings → Branches: protect `main`: require pull requests, require the `CI / check` status, block force pushes.
4. Settings → Actions → General: set workflow permissions to **read repository contents**, and require approval for workflows from outside contributors.
5. Settings → Pages: source **GitHub Actions**.
6. If you switch on the leaderboard: restrict the Firebase API key to your Pages domain (setup guide, step 7).
