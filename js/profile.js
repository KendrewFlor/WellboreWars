// Player profile: collection, packs, custom deck, stats, achievements, settings.
// Pure functions. Storage (localStorage) is user-controlled input, so everything
// loaded goes through validateProfile() before use.

import { CARDS, RARITIES, STARTER_DECKS, BOSSES, RULES, card } from './engine.js';
import { createRng } from './rng.js';

export const PROFILE_VERSION = 1;
export const MAX_COPIES = { common: 2, uncommon: 2, rare: 2, epic: 2, legendary: 1, brilliant: 1 };
export const PACK_SIZE = 5;

export const ACHIEVEMENTS = [
  { id: 'first-win', label: 'First Oil', desc: 'Win your first match.' },
  { id: 'beat-formation', label: 'Pressure Tested', desc: 'Defeat The Overpressured Formation.' },
  { id: 'beat-typhoon', label: 'Weathered the Storm', desc: 'Defeat Typhoon Season.' },
  { id: 'beat-market', label: 'Bull Run', desc: 'Defeat Market Crash.' },
  { id: 'senior-win', label: 'Senior Engineer', desc: 'Win on Senior difficulty.' },
  { id: 'flawless', label: 'Zero Harm', desc: 'Win with your Well at full Integrity.' },
  { id: 'streak-3', label: 'Hat Trick', desc: 'Win 3 matches in a row.' },
  { id: 'custom-win', label: 'Field-Tested Deck', desc: 'Win with a custom deck.' },
  { id: 'first-pack', label: 'Core Recovered', desc: 'Open your first pack.' },
  { id: 'legendary', label: 'Legendary Find', desc: 'Pull a Legendary card.' },
  { id: 'brilliant', label: 'Blowout Brilliant', desc: 'Pull a Blowout Brilliant card.' },
  { id: 'collector', label: 'Full Core Box', desc: 'Own 40 different cards.' },
];

/** Cards a player can own (excludes tokens and Environment-only cards). */
export const COLLECTIBLE = Object.values(CARDS).filter((c) => !c.token && !c.env).map((c) => c.id);

export function defaultProfile() {
  const collection = {};
  for (const d of Object.values(STARTER_DECKS)) {
    const counts = {};
    d.cards.forEach((id) => { counts[id] = (counts[id] ?? 0) + 1; });
    for (const [id, n] of Object.entries(counts)) collection[id] = Math.max(collection[id] ?? 0, n);
  }
  return {
    v: PROFILE_VERSION,
    name: 'Engineer',
    collection,
    packs: 1,
    packsOpened: 0,
    customDeck: [...STARTER_DECKS['drill-crew'].cards],
    customCommander: 'drilling-engineer',
    lastDeck: 'drill-crew',
    lastBoss: 'the-formation',
    difficulty: 'engineer',
    stats: { wins: 0, losses: 0, streak: 0, bestStreak: 0, byBoss: {} },
    achievements: {},
    settings: { master: 0.8, music: 0.4, sfx: 0.9, musicOn: true, sfxOn: true, speed: 'normal', reducedMotion: false, showLog: true },
    seen: { tutorial: false },
    cloud: { optIn: false },
    rollCount: 0,
  };
}

const clampNum = (v, lo, hi, dflt) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt);
const isBool = (v, dflt) => (typeof v === 'boolean' ? v : dflt);
export const cleanName = (s) => (typeof s === 'string' ? s.replace(/[^A-Za-z0-9 _.-]/g, '').trim().slice(0, 16) : '');

/** Validate untrusted data into a well-formed profile. Never throws. */
export function validateProfile(raw) {
  const d = defaultProfile();
  let p;
  try { p = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return d; }
  if (!p || typeof p !== 'object' || p.v !== PROFILE_VERSION) return d;

  const name = cleanName(p.name);
  d.name = name.length >= 2 ? name : d.name;
  for (const [id, n] of Object.entries(p.collection ?? {})) {
    if (COLLECTIBLE.includes(id) && Number.isInteger(n) && n >= 0 && n <= 99) d.collection[id] = Math.max(d.collection[id] ?? 0, n);
  }
  d.packs = clampNum(p.packs, 0, 999, d.packs) | 0;
  d.packsOpened = clampNum(p.packsOpened, 0, 1e6, 0) | 0;
  d.rollCount = clampNum(p.rollCount, 0, 1e9, 0) | 0;
  if (Array.isArray(p.customDeck)) {
    const deck = p.customDeck.filter((id) => typeof id === 'string' && COLLECTIBLE.includes(id)).slice(0, RULES.deckSize);
    if (deckProblems(deck, d.collection).length === 0) d.customDeck = deck;
  }
  if (typeof p.customCommander === 'string' && ['drilling-engineer', 'reservoir-engineer', 'production-engineer'].includes(p.customCommander)) d.customCommander = p.customCommander;
  if (typeof p.lastDeck === 'string' && (STARTER_DECKS[p.lastDeck] || p.lastDeck === 'custom')) d.lastDeck = p.lastDeck;
  if (typeof p.lastBoss === 'string' && BOSSES[p.lastBoss]) d.lastBoss = p.lastBoss;
  if (['rookie', 'engineer', 'senior'].includes(p.difficulty)) d.difficulty = p.difficulty;
  const st = p.stats ?? {};
  d.stats.wins = clampNum(st.wins, 0, 1e6, 0) | 0;
  d.stats.losses = clampNum(st.losses, 0, 1e6, 0) | 0;
  d.stats.streak = clampNum(st.streak, 0, 1e6, 0) | 0;
  d.stats.bestStreak = clampNum(st.bestStreak, 0, 1e6, 0) | 0;
  for (const b of Object.keys(BOSSES)) {
    const r = st.byBoss?.[b];
    if (r) d.stats.byBoss[b] = { wins: clampNum(r.wins, 0, 1e6, 0) | 0, losses: clampNum(r.losses, 0, 1e6, 0) | 0 };
  }
  for (const a of ACHIEVEMENTS) if (p.achievements?.[a.id] === true) d.achievements[a.id] = true;
  const s = p.settings ?? {};
  d.settings.master = clampNum(s.master, 0, 1, d.settings.master);
  d.settings.music = clampNum(s.music, 0, 1, d.settings.music);
  d.settings.sfx = clampNum(s.sfx, 0, 1, d.settings.sfx);
  d.settings.musicOn = isBool(s.musicOn, d.settings.musicOn);
  d.settings.sfxOn = isBool(s.sfxOn, d.settings.sfxOn);
  d.settings.reducedMotion = isBool(s.reducedMotion, false);
  d.settings.showLog = isBool(s.showLog, true);
  d.settings.speed = ['slow', 'normal', 'fast'].includes(s.speed) ? s.speed : 'normal';
  d.seen.tutorial = isBool(p.seen?.tutorial, false);
  d.cloud.optIn = isBool(p.cloud?.optIn, false);
  return d;
}

// ------------------------------------------------------------------ decks

/** Returns a list of human-readable problems; empty means the deck is legal. */
export function deckProblems(deck, collection) {
  const problems = [];
  if (deck.length !== RULES.deckSize) problems.push(`Deck needs exactly ${RULES.deckSize} cards (has ${deck.length}).`);
  const counts = {};
  for (const id of deck) counts[id] = (counts[id] ?? 0) + 1;
  for (const [id, n] of Object.entries(counts)) {
    const c = CARDS[id];
    if (!c || !COLLECTIBLE.includes(id)) { problems.push(`${id} can't be used in decks.`); continue; }
    const limit = MAX_COPIES[c.rarity];
    if (n > limit) problems.push(`${c.name}: max ${limit} ${limit === 1 ? 'copy' : 'copies'}.`);
    if (n > (collection[id] ?? 0)) problems.push(`${c.name}: you own ${collection[id] ?? 0}.`);
  }
  return problems;
}

// ------------------------------------------------------------------ packs

/** Pick a rarity from the published odds. */
export function rollRarity(u) {
  let acc = 0;
  for (const r of [...RARITIES].reverse()) {
    acc += r.packOdds;
    if (u < acc) return r.id;
  }
  return 'common';
}

/**
 * Open one pack: 5 cards; the last slot is guaranteed Rare or better.
 * Deterministic from seed + roll counter (so the result can't be edited in via storage).
 */
export function openPack(profile, seed) {
  if (profile.packs <= 0) return null;
  const rng = createRng(`${seed}:pack:${profile.rollCount}`);
  const pool = (rarity) => COLLECTIBLE.filter((id) => card(id).rarity === rarity);
  const cards = [];
  for (let i = 0; i < PACK_SIZE; i++) {
    let r = rollRarity(rng.next());
    if (i === PACK_SIZE - 1 && ['common', 'uncommon'].includes(r)) r = 'rare';
    const ids = pool(r).length ? pool(r) : pool('common');
    cards.push(ids[Math.floor(rng.next() * ids.length)]);
  }
  profile.packs -= 1;
  profile.packsOpened += 1;
  profile.rollCount += 1;
  const newIds = [];
  for (const id of cards) {
    if (!profile.collection[id]) newIds.push(id);
    profile.collection[id] = (profile.collection[id] ?? 0) + 1;
  }
  const unlocked = [];
  const grant = (id) => { if (!profile.achievements[id]) { profile.achievements[id] = true; unlocked.push(id); } };
  grant('first-pack');
  if (cards.some((id) => card(id).rarity === 'legendary')) grant('legendary');
  if (cards.some((id) => card(id).rarity === 'brilliant')) grant('brilliant');
  if (Object.keys(profile.collection).filter((id) => profile.collection[id] > 0).length >= 40) grant('collector');
  return { cards, newIds, unlocked };
}

// ------------------------------------------------------------------ match results

/** Record a finished match. Returns { packs, unlocked } rewards. */
export function recordResult(profile, { won, boss, difficulty, deckKey, flawless }) {
  const st = profile.stats;
  const b = (st.byBoss[boss] ??= { wins: 0, losses: 0 });
  const unlocked = [];
  const grant = (id) => { if (!profile.achievements[id]) { profile.achievements[id] = true; unlocked.push(id); } };
  let packs = 0;
  if (won) {
    st.wins += 1; b.wins += 1; st.streak += 1;
    st.bestStreak = Math.max(st.bestStreak, st.streak);
    packs = difficulty === 'senior' ? 2 : 1;
    profile.packs += packs;
    grant('first-win');
    grant({ 'the-formation': 'beat-formation', 'typhoon-season': 'beat-typhoon', 'market-crash': 'beat-market' }[boss]);
    if (difficulty === 'senior') grant('senior-win');
    if (flawless) grant('flawless');
    if (st.streak >= 3) grant('streak-3');
    if (deckKey === 'custom') grant('custom-win');
  } else {
    st.losses += 1; b.losses += 1; st.streak = 0;
  }
  return { packs, unlocked: unlocked.filter(Boolean) };
}
