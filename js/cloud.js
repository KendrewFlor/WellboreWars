// Optional global leaderboard on Cloud Firestore, using Firebase's REST APIs
// directly (no SDK, no third-party script). Three things happen here:
//   1. Anonymous sign-in (Identity Toolkit) → a short-lived ID token
//   2. After a match: one write that increments wins or losses (rules-checked)
//   3. Leaderboard screen: one query for the top 10 players
// Every response is treated as untrusted and validated before display.

import { FIREBASE } from './config.js';

const IDENTITY = 'https://identitytoolkit.googleapis.com/v1/accounts:signUp';
const REFRESH = 'https://securetoken.googleapis.com/v1/token';
const FIRESTORE = 'https://firestore.googleapis.com/v1';
const SESSION_KEY = 'wellbore-wars.cloud-session.v1';
const TIMEOUT_MS = 8000;

export function cloudConfigured() {
  return /^AIza[0-9A-Za-z_-]{35}$/.test(FIREBASE.apiKey) && /^[a-z0-9-]{4,40}$/.test(FIREBASE.projectId);
}

const docsRoot = () => `projects/${FIREBASE.projectId}/databases/(default)/documents`;

async function request(url, { method = 'POST', headers = {}, body } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { method, headers, body, signal: ctrl.signal, credentials: 'omit', referrerPolicy: 'strict-origin', cache: 'no-store' });
    const text = await res.text();
    if (text.length > 200_000) throw new Error('Response too large');
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const msg = typeof data?.error?.message === 'string' ? data.error.message.slice(0, 120) : `HTTP ${res.status}`;
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------------ session

function loadSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null');
    if (s && typeof s.uid === 'string' && /^[A-Za-z0-9]{10,40}$/.test(s.uid) && typeof s.refreshToken === 'string') return s;
  } catch { /* ignore */ }
  return null;
}

function saveSession(s) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

let session = null;

async function getToken() {
  session ??= loadSession();
  const now = Date.now();
  if (session?.idToken && session.expiresAt > now + 60_000) return session;
  const key = encodeURIComponent(FIREBASE.apiKey);
  if (session?.refreshToken) {
    try {
      const r = await request(`${REFRESH}?key=${key}`, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(session.refreshToken)}`,
      });
      session = { uid: String(r.user_id), idToken: String(r.id_token), refreshToken: String(r.refresh_token), expiresAt: now + Number(r.expires_in) * 1000 };
      saveSession(session);
      return session;
    } catch { session = null; }
  }
  const r = await request(`${IDENTITY}?key=${key}`, { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) });
  session = { uid: String(r.localId), idToken: String(r.idToken), refreshToken: String(r.refreshToken), expiresAt: now + Number(r.expiresIn) * 1000 };
  saveSession(session);
  return session;
}

// ------------------------------------------------------------------ Firestore value helpers (exported for tests)

export function decodeFields(fields = {}) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v && typeof v === 'object') {
      if ('stringValue' in v) out[k] = String(v.stringValue);
      else if ('integerValue' in v) out[k] = Number.parseInt(v.integerValue, 10);
      else if ('timestampValue' in v) out[k] = String(v.timestampValue);
    }
  }
  return out;
}

/** Turn a runQuery response into safe leaderboard rows. */
export function parseLeaderboard(data) {
  if (!Array.isArray(data)) return [];
  return data
    .filter((r) => r && r.document && typeof r.document.name === 'string')
    .map((r) => {
      const f = decodeFields(r.document.fields);
      const id = r.document.name.split('/').pop();
      const name = typeof f.name === 'string' ? f.name.replace(/[^A-Za-z0-9 _.-]/g, '').slice(0, 16) : '';
      const wins = Number.isSafeInteger(f.wins) && f.wins >= 0 ? f.wins : 0;
      const losses = Number.isSafeInteger(f.losses) && f.losses >= 0 ? f.losses : 0;
      return { id, name: name || 'Engineer', wins, losses };
    })
    .slice(0, 25);
}

/** The commit body for one match result. Exported so tests can check it matches the rules. */
export function resultWrite(uid, name, won) {
  return {
    writes: [{
      update: { name: `${docsRoot()}/players/${uid}`, fields: { name: { stringValue: name } } },
      updateMask: { fieldPaths: ['name'] },
      updateTransforms: [
        { fieldPath: won ? 'wins' : 'losses', increment: { integerValue: '1' } },
        { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
      ],
    }],
  };
}

// ------------------------------------------------------------------ public API

/** Submit one match result. Resolves to { ok, message }. Never throws. */
export async function submitResult(name, won) {
  if (!cloudConfigured()) return { ok: false, message: 'Leaderboard not configured.' };
  try {
    const s = await getToken();
    await request(`${FIRESTORE}/${docsRoot()}:commit`, {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.idToken}` },
      body: JSON.stringify(resultWrite(s.uid, name, won)),
    });
    return { ok: true, message: 'Result sent to the global leaderboard.' };
  } catch (e) {
    if (e.status === 403) return { ok: false, message: 'Leaderboard skipped this result (one result per 30 seconds).' };
    return { ok: false, message: 'Leaderboard unavailable right now.' };
  }
}

/** Top players by wins. Resolves to { ok, rows, me }. Never throws. */
export async function fetchLeaderboard(limit = 10) {
  if (!cloudConfigured()) return { ok: false, rows: [], me: null };
  try {
    const data = await request(`${FIRESTORE}/${docsRoot()}:runQuery`, {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'players' }], orderBy: [{ field: { fieldPath: 'wins' }, direction: 'DESCENDING' }], limit } }),
    });
    session ??= loadSession();
    return { ok: true, rows: parseLeaderboard(data), me: session?.uid ?? null };
  } catch {
    return { ok: false, rows: [], me: null };
  }
}
