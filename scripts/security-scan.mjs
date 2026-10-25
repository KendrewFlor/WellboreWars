#!/usr/bin/env node
// Repository security scanner — zero dependencies, runs in CI and locally.
//
// Checks:
//   1. Trojan Source / hidden text: bidi overrides, zero-width & tag characters, in every text file
//   2. Prompt-injection bait aimed at AI coding agents (in docs, comments, data files)
//   3. Agent auto-config files that tools load silently (CLAUDE.md, .mcp.json, AGENTS.md, …)
//   4. Hard-coded secrets (API keys, tokens, private keys)
//   5. Supply chain: no dependencies, no npm lifecycle scripts, pinned GitHub Actions
//   6. Source hygiene: no eval/new Function/innerHTML/document.write in js/; network access only in
//      js/cloud.js and only to the three Firebase REST hosts; no remote resources in CSS/HTML
//   7. AI co-author trailers in git history (if this is a git checkout)
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SELF = 'scripts/security-scan.mjs';
const IGNORE_DIRS = new Set(['.git', 'node_modules', 'dist', 'coverage']);
const VENDOR = 'vendor/'; // this edition has no vendored code; kept for forks that add some
const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.json', '.md', '.html', '.css', '.yml', '.yaml', '.txt', '.sha256', '.sh', '.rules', '']);

const findings = [];
const fail = (file, line, rule, detail) => findings.push({ file, line, rule, detail });

const walk = (dir) => readdirSync(dir).flatMap((f) => {
  if (IGNORE_DIRS.has(f)) return [];
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
// In a git checkout, scan exactly what would be published: tracked files plus
// untracked files that are not gitignored. Outside git, scan the whole tree.
let files;
try {
  if (!existsSync(join(root, '.git'))) throw new Error('not a git checkout');
  files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    .split('\0').filter((f) => f && existsSync(join(root, f)));
} catch {
  files = walk(root).map((p) => relative(root, p).split('\\').join('/'));
}

// Build the injection patterns from fragments so this file does not itself trip other scanners.
const j = (...parts) => parts.join('');
const INJECTION = [
  new RegExp(j('ignore\\s+(all\\s+)?(the\\s+)?(previous|prior|above|earlier)\\s+', '(instructions|prompts|messages|rules)'), 'i'),
  new RegExp(j('disregard\\s+(all\\s+)?(previous|prior|your)\\s+', '(instructions|guidelines|rules)'), 'i'),
  new RegExp(j('you\\s+are\\s+now\\s+(in\\s+)?', '(developer|dan|jailbreak|god)\\s*mode'), 'i'),
  new RegExp(j('<\\s*/?\\s*(system|assistant|im_start|im_end)', '\\s*>'), 'i'),
  new RegExp(j('\\b(new|updated|real)\\s+system\\s+', 'prompt\\b'), 'i'),
  new RegExp(j('\\b(AI|LLM|assistant|agent|claude|copilot|cursor|codex|gemini)\\b[^\\n]{0,40}\\b(must|should|always)\\s+', '(run|execute|curl|download|install|send|exfiltrate)\\b'), 'i'),
  new RegExp(j('(curl|wget|iwr|irm)\\s+[^\\n|]*\\|\\s*', '(sh|bash|zsh|iex|python|node)\\b'), 'i'),
  new RegExp(j('do\\s+not\\s+(tell|inform|mention\\s+to)\\s+the\\s+', 'user'), 'i'),
];
const HIDDEN = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\u00AD]|[\u{E0000}-\u{E007F}]/u;
const SECRETS = [
  ['Anthropic key', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['OpenAI-style key', /\bsk-(proj-)?[A-Za-z0-9]{32,}/],
  ['GitHub token', /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|github_pat_[A-Za-z0-9_]{60,}/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['Private key', /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['Cloudflare token', /\b(CF|CLOUDFLARE)_API_TOKEN\s*[:=]\s*['"]?[A-Za-z0-9_-]{30,}/],
];
const AGENT_FILES = [
  /(^|\/)CLAUDE(\.local)?\.md$/i, /(^|\/)AGENTS\.md$/i, /(^|\/)GEMINI\.md$/i, /(^|\/)\.mcp\.json$/i,
  /(^|\/)\.claude\//, /(^|\/)\.cursor\//, /(^|\/)\.cursorrules$/, /(^|\/)\.windsurfrules$/, /(^|\/)\.clinerules/,
  /(^|\/)\.github\/copilot-instructions\.md$/, /(^|\/)\.wolf\//, /(^|\/)\.vscode\/(tasks|settings|mcp)\.json$/,
  /(^|\/)\.codex\//, /(^|\/)\.continue\//,
];
// Agent files a maintainer has reviewed and wants to keep can be listed here, one path per line.
const allowAgentFiles = existsSync(join(root, '.agent-files-allowlist'))
  ? new Set(readFileSync(join(root, '.agent-files-allowlist'), 'utf8').split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#')))
  : new Set();

for (const file of files) {
  if (AGENT_FILES.some((re) => re.test(file)) && !allowAgentFiles.has(file)) {
    fail(file, 0, 'agent-config', 'AI agent instruction/config file — these are auto-loaded by coding agents and are a prompt-injection vector. Review it and add it to .agent-files-allowlist, or delete it.');
  }
  const ext = extname(file).toLowerCase();
  if (!TEXT_EXT.has(ext) && !['LICENSE', 'CODEOWNERS', 'commit-msg'].includes(basename(file))) continue;
  const text = readFileSync(join(root, file), 'utf8');
  const lines = text.split('\n');
  const isVendor = file.startsWith(VENDOR);

  lines.forEach((line, i) => {
    const n = i + 1;
    if (HIDDEN.test(line)) fail(file, n, 'hidden-unicode', 'Invisible or bidirectional control character (Trojan Source / hidden prompt).');
    if (isVendor || file === SELF) return;
    for (const re of INJECTION) if (re.test(line)) fail(file, n, 'prompt-injection', `Matches ${re.source.slice(0, 50)}…`);
    for (const [name, re] of SECRETS) {
      // A Firebase *web* API key is public by design (it identifies the project; the
      // Firestore rules are the security boundary). It may live in js/config.js only.
      if (name === 'Google API key' && file === 'js/config.js') continue;
      if (re.test(line)) fail(file, n, 'secret', name);
    }
  });

  // HTML comments in Markdown are invisible on GitHub but fully visible to an AI agent reading the raw file.
  if (ext === '.md' && /<!--[\s\S]*?-->/.test(text)) fail(file, 0, 'hidden-markdown-comment', 'HTML comment in Markdown — hidden from human readers on GitHub, visible to agents.');

  if (file.startsWith('js/')) {
    const isCloud = file === 'js/cloud.js';
    const banned = [
      [/\beval\s*\(/, 'eval()'], [/\bnew\s+Function\s*\(/, 'new Function()'], [/\.innerHTML\s*=/, 'innerHTML assignment'],
      [/\.outerHTML\s*=/, 'outerHTML assignment'], [/insertAdjacentHTML/, 'insertAdjacentHTML'], [/document\.write/, 'document.write'],
      [/XMLHttpRequest|WebSocket|sendBeacon|EventSource/, 'raw network API'],
      [/import\s*\(/, 'dynamic import'], [/getContext\s*\(|createElement\(\s*['"`]canvas/, 'canvas/WebGL (visuals are CSS-only)'], [/setTimeout\s*\(\s*['"`]/, 'string setTimeout'],
      [/\bpostMessage\s*\(|window\.open\s*\(/, 'cross-window messaging'],
    ];
    if (!isCloud) banned.push([/\bfetch\s*\(/, 'network call outside js/cloud.js'], [/['"`]https?:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+/i, 'remote URL outside js/cloud.js']);
    lines.forEach((line, i) => {
      for (const [re, what] of banned) if (re.test(line)) fail(file, i + 1, 'unsafe-source', what);
      if (isCloud) {
        for (const m of line.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
          if (!['identitytoolkit.googleapis.com', 'securetoken.googleapis.com', 'firestore.googleapis.com'].includes(m[1].toLowerCase())) fail(file, i + 1, 'unsafe-source', `Unexpected host ${m[1]}`);
        }
      }
    });
    for (const m of text.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
      if (!/^\.\/[a-z0-9-]+\.js$/.test(m[1]) && m[1] !== '../data/cards.json') fail(file, 0, 'import', `Import "${m[1]}" is not a local module.`);
    }
  }

  if (file.startsWith('css/')) {
    lines.forEach((line, i) => {
      if (/@import|url\(\s*['"]?(https?:)?\/\//i.test(line)) fail(file, i + 1, 'unsafe-source', 'Remote resource in CSS.');
      if (/expression\s*\(|behavior\s*:|-moz-binding/i.test(line)) fail(file, i + 1, 'unsafe-source', 'Legacy script-in-CSS construct.');
    });
  }

  if (file === 'index.html') {
    if (/<script(?![^>]*\bsrc=["']\.\/js\/main\.js["'])[^>]*>/i.test(text)) fail(file, 0, 'unsafe-source', 'Only ./js/main.js may be loaded as a script.');
    if (/<style|\sstyle=|\son[a-z]+=/i.test(text)) fail(file, 0, 'unsafe-source', 'Inline style or event handler attribute.');
    if (/(src|href)=["']https?:/i.test(text)) fail(file, 0, 'unsafe-source', 'Remote resource in index.html.');
    if (!/Content-Security-Policy/.test(text)) fail(file, 0, 'unsafe-source', 'Missing Content-Security-Policy meta tag.');
  }
}

// ---- package.json: no deps, no lifecycle scripts ----
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'bundledDependencies']) {
  if (pkg[field] && Object.keys(pkg[field]).length) fail('package.json', 0, 'supply-chain', `"${field}" must stay empty — vendor and checksum instead.`);
}
for (const s of ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish', 'prepack', 'postpack']) {
  if (pkg.scripts?.[s]) fail('package.json', 0, 'supply-chain', `Lifecycle script "${s}" runs on install — not allowed.`);
}
if (pkg.private !== true) fail('package.json', 0, 'supply-chain', '"private": true prevents accidental npm publishing.');
for (const lock of ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb']) {
  if (existsSync(join(root, lock))) fail(lock, 0, 'supply-chain', 'Lockfile present but the project declares no dependencies.');
}

// ---- GitHub workflows ----
for (const file of files.filter((f) => /^\.github\/workflows\/.+\.ya?ml$/.test(f))) {
  const text = readFileSync(join(root, file), 'utf8');
  text.split('\n').forEach((line, i) => {
    const m = /^\s*-?\s*uses:\s*([^\s#]+)/.exec(line);
    if (m && !m[1].startsWith('./') && !/@[0-9a-f]{40}$/.test(m[1])) fail(file, i + 1, 'unpinned-action', `${m[1]} must be pinned to a full commit SHA.`);
  });
  if (/pull_request_target/.test(text)) fail(file, 0, 'workflow', 'pull_request_target runs untrusted PR code with secrets.');
  if (!/^permissions:/m.test(text)) fail(file, 0, 'workflow', 'Top-level "permissions:" block required (least privilege).');
  if (/\$\{\{\s*github\.event\.(issue|pull_request|comment|review|head_commit)\.(title|body|message|head\.ref)/.test(text)) {
    fail(file, 0, 'workflow', 'Untrusted event text interpolated into a workflow (script injection).');
  }
}

// ---- Git history: AI co-author trailers ----
if (existsSync(join(root, '.git'))) {
  try {
    const log = execFileSync('git', ['log', '--format=%H%n%B%n--END--'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const trailer = /^co-authored-by:.*(claude|anthropic|copilot|openai|chatgpt|cursor|gemini)/im;
    for (const block of log.split('--END--')) {
      const sha = block.trim().split('\n')[0];
      if (sha && trailer.test(block)) fail(`commit ${sha.slice(0, 10)}`, 0, 'ai-coauthor', 'Commit carries an AI co-author trailer.');
    }
  } catch { /* no commits yet */ }
}

// ---- Report ----
if (findings.length) {
  console.error(`Security scan found ${findings.length} issue(s):\n`);
  for (const f of findings) console.error(`  ✗ [${f.rule}] ${f.file}${f.line ? `:${f.line}` : ''} — ${f.detail}`);
  process.exit(1);
}
console.log(`✓ Security scan passed (${files.length} files checked).`);
