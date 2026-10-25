# Using AI coding tools on this repo — safely

These five community tools make Claude Code noticeably better on long sessions and larger codebases. None of them is installed, configured or required by this repository, on purpose: each one either runs code on your machine through hooks or sends data to a service. This page explains what each tool touches and how to set it up so your public repo stays clean.

**Rule of thumb:** AI tooling lives on *your* machine (user scope), never in the repo. Anything an agent reads automatically (`CLAUDE.md`, `AGENTS.md`, `.mcp.json`, `.claude/`, `.wolf/`) is already in `.gitignore`, and `npm run scan` fails if one is committed by accident.

## The tools

### claude-context: semantic code search

- **Official source:** `github.com/zilliztech/claude-context`, npm package `@zilliz/claude-context-mcp` (MIT).
- **What it does:** indexes the codebase into a vector database and exposes `index_codebase` / `search_code` tools, so Claude retrieves relevant files instead of guessing.
- **What it touches:** your source code is chunked and sent to an embedding provider (OpenAI, VoyageAI, Gemini, or a local Ollama) and stored in Milvus / Zilliz Cloud.
- **Safety notes:**
  - Several forks and listings publish under different package names. One third-party skills listing suggests a package name the official repo does not publish. Install only the name shown in the upstream README.
  - Pin a version instead of `@latest`, so an upstream compromise doesn't reach you automatically.
  - For private code, use Ollama embeddings and a local Milvus so nothing leaves your machine. (This repo is public anyway.)
  - Pass API keys through environment variables at `claude mcp add` time. Never write them into a project file.

### OpenWolf: file index, token ledger, working memory

- **Official source:** npm package `openwolf` by Cytostack (AGPL-3.0). Forks exist under other scopes; use the original.
- **What it does:** `openwolf init` creates a `.wolf/` folder (project map, learned corrections, token ledger) and installs six Claude Code lifecycle hooks that run on every file read and write.
- **What it touches:** runs Node scripts on every tool call; writes `.wolf/` plus `CLAUDE.md` / `AGENTS.md` pointer files into the project.
- **Safety notes:**
  - Read the hook scripts in `.wolf/hooks/` before the first session; they execute automatically.
  - `.wolf/`, `CLAUDE.md` and `AGENTS.md` are gitignored here. Committing them would hand your agent's instructions and memory to everyone who clones the repo, and a malicious pull request could edit those instructions.
  - It's AGPL-licensed tooling. That doesn't affect this MIT project as long as you don't vendor OpenWolf's code into it.

### claude-session-continuity-mcp (now **passbaton**): session continuity

- **Official source:** `github.com/leesgit/claude-session-continuity-mcp` (MIT). Renamed to `passbaton` in v2; the old package name still installs v1.
- **What it does:** five hooks auto-capture session state, tasks and error→fix pairs into a local SQLite database, and inject relevant context when you start a new session.
- **What it touches:** its `postinstall` script edits your global `~/.claude.json` and `~/.claude/settings.json`. It ships a native module (`better-sqlite3`). Storage is 100% local.
- **Safety notes:**
  - A global install runs that postinstall with your user permissions. Inspect the package first (`npm pack <name>` then read the tarball), or install with `--ignore-scripts` and register the hooks by hand.
  - Captured transcripts can include anything you pasted, secrets included. The database is outside the repo, so it won't leak through git, but treat it as sensitive.

### second-brain-cloudflare: self-hosted cross-tool memory

- **Official source:** `github.com/rahilp/second-brain-cloudflare` (MIT).
- **What it does:** deploys a Cloudflare Worker (D1 + Vectorize + Workers AI) in *your* Cloudflare account and exposes `remember` / `recall` over MCP to Claude, ChatGPT, Cursor and others.
- **What it touches:** a Worker URL on the internet protected by an `AUTH_TOKEN` (or OAuth). Anything you store is retrievable by every client you connect.
- **Safety notes:**
  - The README offers one-line connect scripts that pipe a downloaded script straight into your shell. Prefer the manual route: `claude mcp add --transport http second-brain https://YOUR-WORKER-URL/mcp`.
  - Use a long random `AUTH_TOKEN` and rotate it if it ever appears in a log or screenshot.
  - Memory is an injection surface: text you saved from a web page or issue can come back later as "context". Don't store instructions from untrusted sources.

### pro-workflow: self-correction, parallel worktrees, agent teams

- **Official source:** `github.com/rohitg00/pro-workflow`. Many forks exist; install from the original marketplace entry (`rohitg00/pro-workflow`).
- **What it does:** a Claude Code plugin with skills, agents and hooks: a learned-rules loop, `/wrap-up`, `/parallel` git worktrees, a `/commit` quality gate and agent-team orchestration, backed by SQLite in `~/.pro-workflow/`.
- **What it touches:** copies hooks into `~/.claude/`. The optional "split CLAUDE.md" template copies files into the project's `.claude/` folder.
- **Safety notes:**
  - Keep the template files local; `.claude/` is gitignored here.
  - Its smart-commit command, like Claude Code itself, may add AI attribution lines to commits. The commit hook below strips them.
  - It provides a `/safe-mode` toggle for destructive operations. Turn it on before letting agent teams loose on a public repo.

## Setup checklist

1. Install tools at **user scope**, never with a committed project `.mcp.json`.
2. Pin versions and install from the original publisher (the names above).
3. Read every hook script before it first runs.
4. Keep API keys in environment variables or your OS keychain.
5. Before pushing, run `npm run check`. It fails on committed agent files, hidden Unicode, injection bait and secrets.

## Keeping AI tools off your contributor list

GitHub lists a contributor for every author **and** every `Co-Authored-By:` trailer in commit history. Some AI tools add one automatically.

- Enable the bundled hook once per clone. It deletes AI co-author and session trailers from every commit message:
  ```sh
  git config core.hooksPath .githooks
  ```
- Claude Code also has a setting to turn its attribution off. Check its current settings docs for the key name.
- `npm run scan` (and CI) fails if any commit in history carries an AI co-author trailer, so one can't slip through unnoticed.
