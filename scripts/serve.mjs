#!/usr/bin/env node
// Minimal local dev server. Zero dependencies. Binds to 127.0.0.1 only.
// Sends the same strict security headers you'd want in production.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT) || 5173;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
};
const SERVE_ROOTS = ['index.html', 'js', 'css', 'data'];
const HEADERS = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'none'; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firestore.googleapis.com; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'X-Frame-Options': 'DENY',
};

createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, HEADERS).end(); return; }
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400, HEADERS).end(); return; }
  if (pathname === '/') pathname = '/index.html';
  const file = normalize(join(root, pathname));
  const relTop = file.slice(root.length + 1).split(sep)[0];
  if (!file.startsWith(root + sep) || !SERVE_ROOTS.includes(relTop) || pathname.includes('\0')) { res.writeHead(404, HEADERS).end(); return; }
  try {
    if (!(await stat(file)).isFile()) throw new Error();
    const type = MIME[extname(file)];
    if (!type) throw new Error();
    const body = await readFile(file);
    res.writeHead(200, { ...HEADERS, 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404, HEADERS).end();
  }
}).listen(port, '127.0.0.1', () => console.log(`Wellbore Wars → http://127.0.0.1:${port}`));
