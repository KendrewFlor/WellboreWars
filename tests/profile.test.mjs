import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultProfile, validateProfile, deckProblems, openPack, recordResult, rollRarity, COLLECTIBLE, cleanName } from '../js/profile.js';
import { RARITIES, STARTER_DECKS, card } from '../js/engine.js';

test('published pack odds sum to 100%', () => {
  const total = RARITIES.reduce((s, r) => s + r.packOdds, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);
  assert.equal(rollRarity(0), 'brilliant');
  assert.equal(rollRarity(0.9999), 'common');
});

test('default profile owns every starter deck, and they are legal', () => {
  const p = defaultProfile();
  for (const d of Object.values(STARTER_DECKS)) assert.deepEqual(deckProblems(d.cards, p.collection), [], d.name);
});

test('deck rules: size, copy limits, ownership, no tokens', () => {
  const p = defaultProfile();
  assert.ok(deckProblems(['roughneck'], p.collection).some((x) => x.includes('exactly')));
  const tooMany = [...STARTER_DECKS['drill-crew'].cards.slice(0, 17), 'make-hole', 'make-hole', 'make-hole'];
  assert.ok(deckProblems(tooMany, p.collection).some((x) => x.includes('max 2')));
  const unowned = [...STARTER_DECKS['drill-crew'].cards.slice(0, 19), 'black-gold-gusher'];
  assert.ok(deckProblems(unowned, p.collection).some((x) => x.includes('you own 0')));
  const token = [...STARTER_DECKS['drill-crew'].cards.slice(0, 19), 'cuttings'];
  assert.ok(deckProblems(token, p.collection).some((x) => x.includes("can't be used")));
});

test('packs: 5 cards, last slot Rare+, deterministic, consumes a pack', () => {
  const a = defaultProfile(); a.packs = 3;
  const b = defaultProfile(); b.packs = 3;
  const ra = openPack(a, 'seed'), rb = openPack(b, 'seed');
  assert.deepEqual(ra.cards, rb.cards);
  assert.equal(ra.cards.length, 5);
  assert.ok(['rare', 'epic', 'legendary', 'brilliant'].includes(card(ra.cards[4]).rarity));
  assert.equal(a.packs, 2);
  ra.cards.forEach((id) => assert.ok(COLLECTIBLE.includes(id)));
  const none = defaultProfile(); none.packs = 0;
  assert.equal(openPack(none, 'x'), null);
});

test('pack rarity distribution roughly follows the published odds', () => {
  const p = defaultProfile(); p.packs = 4000;
  const counts = {};
  for (let i = 0; i < 4000; i++) openPack(p, 'dist').cards.slice(0, 4).forEach((id) => { const r = card(id).rarity; counts[r] = (counts[r] ?? 0) + 1; });
  const n = 16000;
  assert.ok(Math.abs(counts.common / n - 0.6) < 0.02, `common ${counts.common / n}`);
  assert.ok(Math.abs(counts.rare / n - 0.1) < 0.015, `rare ${counts.rare / n}`);
});

test('results grant packs, streaks and achievements', () => {
  const p = defaultProfile();
  const r = recordResult(p, { won: true, boss: 'typhoon-season', difficulty: 'senior', deckKey: 'custom', flawless: true });
  assert.equal(r.packs, 2);
  for (const a of ['first-win', 'beat-typhoon', 'senior-win', 'flawless', 'custom-win']) assert.ok(p.achievements[a], a);
  recordResult(p, { won: false, boss: 'typhoon-season', difficulty: 'rookie', deckKey: 'drill-crew' });
  assert.equal(p.stats.streak, 0);
  assert.equal(p.stats.byBoss['typhoon-season'].losses, 1);
});

test('tampered profiles are sanitised', () => {
  assert.deepEqual(validateProfile('{nope'), defaultProfile());
  const evil = {
    v: 1, name: '<img src=x onerror=alert(1)>', packs: 1e12, collection: { 'the-blowout': 5, cuttings: 9, roughneck: -4, fpso: 3.5, __proto__: { admin: true } },
    customDeck: ['black-gold-gusher'], difficulty: 'god', settings: { master: 99, speed: 'warp' }, achievements: { 'first-win': true, hacked: true },
  };
  const p = validateProfile(evil);
  assert.equal(p.name, 'img srcx onerror');
  assert.ok(!/[<>=()]/.test(p.name));
  assert.equal(p.packs, 999);
  assert.equal(p.collection['the-blowout'], undefined, 'environment-only card stripped');
  assert.equal(p.collection.cuttings, undefined);
  assert.equal(p.difficulty, 'engineer');
  assert.equal(p.settings.master, 1);
  assert.equal(p.settings.speed, 'normal');
  assert.deepEqual(Object.keys(p.achievements), ['first-win']);
  assert.equal(({}).admin, undefined);
  assert.deepEqual(p.customDeck, defaultProfile().customDeck, 'illegal custom deck rejected');
  assert.equal(cleanName('  Kendrew Flor!!  '), 'Kendrew Flor');
});
