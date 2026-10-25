import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createMatch, mulligan, playCard, attack, endTurn, usePower, canPlay, legalActions, applyAction, concede,
  attackTargets, costOf, advantage, CARDS, RULES, STARTER_DECKS, BOSSES, COMMANDERS, card,
} from '../js/engine.js';

/** A match with fixed hands/boards for precise rule tests. */
function fixture({ pHand = [], oHand = [], pBoard = [], oBoard = [], budget = 10, field = null } = {}) {
  const deck = Array(20).fill('roughneck');
  const s = createMatch({ seed: 'fx', player: { name: 'P', commander: 'drilling-engineer', deck }, opponent: { name: 'O', commander: 'the-formation', deck }, first: 'p' });
  mulligan(s, 'p', []); mulligan(s, 'o', []);
  const mk = (id) => ({ uid: s.nextUid++, id });
  const unit = (id, extra = {}) => {
    const c = card(id);
    return { uid: s.nextUid++, id, power: c.power, integrity: c.integrity, maxIntegrity: c.integrity, kw: [...(c.kw ?? [])], attacksLeft: 1, stuck: 0, sour: 0, ...extra };
  };
  s.sides.p.hand = pHand.map(mk);
  s.sides.o.hand = oHand.map(mk);
  s.sides.p.board = pBoard.map((x) => (typeof x === 'string' ? unit(x) : unit(x.id, x)));
  s.sides.o.board = oBoard.map((x) => (typeof x === 'string' ? unit(x) : unit(x.id, x)));
  s.sides.p.budget = budget; s.sides.p.maxBudget = budget;
  s.field = field;
  s.events = [];
  return s;
}

test('every card referenced by decks, bosses and effects exists', () => {
  for (const d of [...Object.values(STARTER_DECKS), ...Object.values(BOSSES)]) {
    assert.equal(d.cards.length, RULES.deckSize, d.name);
    d.cards.forEach((id) => assert.ok(CARDS[id], id));
    assert.ok(COMMANDERS[d.commander], d.commander);
  }
  for (const c of Object.values(CARDS)) {
    for (const e of [...(c.effects ?? []), ...(c.onPlay?.effects ?? []), ...(c.onDeath?.effects ?? []), ...(c.onTurnStart?.effects ?? [])]) {
      if (e.card) assert.ok(CARDS[e.card], `${c.id} summons ${e.card}`);
    }
    if (c.type === 'unit') assert.ok(Number.isInteger(c.power) && Number.isInteger(c.integrity), c.id);
  }
});

test('setup: hands, spare budget for the second player, mulligan, first turn', () => {
  const s = createMatch({ seed: 'setup', player: { name: 'P', commander: 'drilling-engineer', deck: STARTER_DECKS['drill-crew'].cards }, opponent: { name: 'O', commander: 'the-formation', deck: BOSSES['the-formation'].cards }, first: 'p' });
  assert.equal(s.sides.p.hand.length, 3);
  assert.equal(s.sides.o.hand.length, 5);
  assert.ok(s.sides.o.hand.some((c) => c.id === 'spare-budget'));
  const replace = s.sides.p.hand.slice(0, 2).map((c) => c.uid);
  mulligan(s, 'p', replace);
  assert.equal(s.sides.p.hand.length, 3);
  assert.equal(s.phase, 'mulligan');
  mulligan(s, 'o', []);
  assert.equal(s.phase, 'play');
  assert.equal(s.sides.p.maxBudget, 1);
  assert.equal(s.sides.p.hand.length, 4);
});

test('units cannot attack the turn they are played unless they have Spud', () => {
  const s = fixture({ pHand: ['roughneck', 'derrickhand'] });
  const [r, d] = s.sides.p.hand;
  playCard(s, 'p', r.uid); playCard(s, 'p', d.uid);
  assert.equal(attackTargets(s, 'p', r.uid).length, 0);
  assert.ok(attackTargets(s, 'p', d.uid).length > 0);
});

test('combat is simultaneous; discipline advantage adds 1', () => {
  // Drilling beats Geoscience: Roughneck (1/2) vs Mudlogger (2/1)
  const s = fixture({ pBoard: ['roughneck'], oBoard: ['mudlogger'] });
  assert.equal(advantage('roughneck', 'mudlogger'), 1);
  const [a] = s.sides.p.board, [d] = s.sides.o.board;
  attack(s, 'p', a.uid, { kind: 'unit', uid: d.uid, side: 'o' });
  assert.equal(s.sides.o.board.length, 0, 'mudlogger takes 1 + 1 advantage = 2 and dies');
  assert.equal(s.sides.p.board.length, 0, 'roughneck takes 2 back and dies (simultaneous)');
  // Without advantage: Roughneck vs Lease Pumper (2/3) — pumper survives at 2
  const s2 = fixture({ pBoard: ['roughneck'], oBoard: ['lease-pumper'] });
  attack(s2, 'p', s2.sides.p.board[0].uid, { kind: 'unit', uid: s2.sides.o.board[0].uid, side: 'o' });
  assert.equal(s2.sides.o.board[0].integrity, 2);
});

test('Casing forces targets; BOP absorbs; Fracture carries through', () => {
  const s = fixture({ pBoard: ['pdc-bit'], oBoard: ['packer', 'mudlogger'] });
  const atk = s.sides.p.board[0];
  const targets = attackTargets(s, 'p', atk.uid);
  assert.equal(targets.length, 1);
  assert.equal(targets[0].uid, s.sides.o.board[0].uid);
  // PDC 4 power vs Packer 1/4: no excess. vs a 2-integrity unit: 2 excess to Well.
  const s2 = fixture({ pBoard: ['pdc-bit'], oBoard: ['derrickhand'] });
  attack(s2, 'p', s2.sides.p.board[0].uid, { kind: 'unit', uid: s2.sides.o.board[0].uid, side: 'o' });
  assert.equal(s2.sides.o.hp, 25 - 3, 'excess 3 (4 dmg − 1 integrity) goes to the Well');
  const s3 = fixture({ pBoard: ['pdc-bit'], oBoard: ['christmas-tree'] });
  attack(s3, 'p', s3.sides.p.board[0].uid, { kind: 'unit', uid: s3.sides.o.board[0].uid, side: 'o' });
  assert.equal(s3.sides.o.board[0].integrity, 6, 'BOP absorbed the hit');
  assert.ok(!s3.sides.o.board[0].kw.includes('bop'));
});

test('Recovery heals, Sour poisons, Waterflood regenerates', () => {
  const s = fixture({ pBoard: ['pvt-analyst'], oBoard: [] });
  s.sides.p.hp = 20;
  attack(s, 'p', s.sides.p.board[0].uid, { kind: 'well', side: 'o' });
  assert.equal(s.sides.p.hp, 21);
  const s2 = fixture({ pBoard: [{ id: 'roughneck', integrity: 2 }], oBoard: ['gas-pocket'] });
  attack(s2, 'p', s2.sides.p.board[0].uid, { kind: 'unit', uid: s2.sides.o.board[0].uid, side: 'o' });
  assert.equal(s2.sides.p.board[0].sour, 2);
  endTurn(s2, 'p'); endTurn(s2, 'o');
  assert.equal(s2.sides.p.board.length, 0, 'sour finished the roughneck (2 − 1 hit − 1 sour)');
  const s3 = fixture({ pBoard: [{ id: 'waterflood-injector', integrity: 1 }] });
  endTurn(s3, 'p'); endTurn(s3, 'o');
  assert.equal(s3.sides.p.board[0].integrity, 3);
});

test('operations: damage, destroy limit, bounce, swap, skip, junk', () => {
  const s = fixture({ pHand: ['acid-job', 'fault-block', 'sidetrack', 'reverse-circulation', 'wait-on-weather', 'pit-gain'], oBoard: ['salt-dome', 'mudlogger', 'top-drive'] });
  const h = (id) => s.sides.p.hand.find((c) => c.id === id).uid;
  const u = (id) => s.sides.o.board.find((x) => x.id === id);
  // Fault block cannot target the 7-integrity salt dome
  assert.equal(playCard(s, 'p', h('fault-block'), { kind: 'unit', uid: u('salt-dome').uid, side: 'o' }), false);
  assert.ok(playCard(s, 'p', h('fault-block'), { kind: 'unit', uid: u('top-drive').uid, side: 'o' }));
  assert.ok(!u('top-drive'));
  assert.ok(playCard(s, 'p', h('sidetrack'), { kind: 'unit', uid: u('mudlogger').uid, side: 'o' }));
  assert.ok(s.sides.o.hand.some((c) => c.id === 'mudlogger'));
  assert.ok(playCard(s, 'p', h('acid-job'), { kind: 'unit', uid: u('salt-dome').uid, side: 'o' }));
  assert.equal(u('salt-dome').integrity, 4);
});

test('swap to 0 integrity destroys the unit', () => {
  const s = fixture({ pHand: ['reverse-circulation'], oBoard: ['salt-dome'] });
  playCard(s, 'p', s.sides.p.hand[0].uid, { kind: 'unit', uid: s.sides.o.board[0].uid, side: 'o' });
  assert.equal(s.sides.o.board.length, 0);
});

test('Wait on Weather stops enemy attacks; Pit Gain cuttings hurt at end of turn', () => {
  const s = fixture({ pHand: ['wait-on-weather', 'pit-gain'], oBoard: ['derrickhand'] });
  playCard(s, 'p', s.sides.p.hand.find((c) => c.id === 'wait-on-weather').uid);
  playCard(s, 'p', s.sides.p.hand.find((c) => c.id === 'pit-gain').uid);
  const oHp = s.sides.o.hp;
  endTurn(s, 'p');
  assert.equal(attackTargets(s, 'o', s.sides.o.board[0].uid).length, 0, 'skipped');
  assert.equal(s.sides.o.hand.filter((c) => c.id === 'cuttings').length, 2);
  endTurn(s, 'o');
  assert.equal(s.sides.o.hp, oHp - 2, 'two cuttings left in hand → 2 damage');
});

test('costs: discount, tax, HPHT field', () => {
  const s = fixture({ pHand: ['landman', 'top-drive', 'acid-job'] });
  playCard(s, 'p', s.sides.p.hand.find((c) => c.id === 'landman').uid);
  assert.equal(costOf(s, 'p', 'top-drive'), 2);
  s.field = { id: 'hpht-well', owner: 'o', kind: 'hpht' };
  assert.equal(costOf(s, 'p', 'acid-job'), 1, 'discount 2, +1 HPHT');
  s.sides.p.discount = 0; s.sides.p.tax = 1;
  assert.equal(costOf(s, 'p', 'acid-job'), 4);
});

test('on-death and on-turn-start effects fire', () => {
  const s = fixture({ pBoard: [{ id: 'perf-gun', integrity: 1 }], oBoard: ['roughneck', { id: 'esp-pump', attacksLeft: 0 }] });
  // perf gun attacks roughneck: both die, P&A deals 2 to the ESP
  attack(s, 'p', s.sides.p.board[0].uid, { kind: 'unit', uid: s.sides.o.board[0].uid, side: 'o' });
  assert.equal(s.sides.o.board.find((u) => u.id === 'esp-pump').integrity, 1);
  const pHp = s.sides.p.hp;
  endTurn(s, 'p');
  assert.equal(s.sides.p.hp, pHp - 1, 'ESP dealt 1 at start of its turn');
});

test('boss passive fires every 3rd turn', () => {
  const s = fixture();
  const hp = s.sides.p.hp;
  for (let i = 0; i < 6; i++) endTurn(s, s.active);
  // opponent has had turns 1,2,3 → passive once (2 dmg); fatigue isn't involved (decks have cards)
  assert.equal(s.sides.p.hp, hp - 2);
});

test('hero power once per turn, costs 2', () => {
  const s = fixture({ oBoard: [] });
  assert.ok(usePower(s, 'p', { kind: 'well', side: 'o' }));
  assert.equal(s.sides.p.budget, 8);
  assert.equal(usePower(s, 'p', { kind: 'well', side: 'o' }), false);
  assert.equal(s.sides.o.hp, 24);
});

test('fatigue ends games; concede ends games', () => {
  const s = fixture();
  s.sides.p.deck = []; s.sides.o.deck = [];
  for (let i = 0; i < 40 && s.phase !== 'over'; i++) endTurn(s, s.active);
  assert.equal(s.phase, 'over');
  const s2 = fixture();
  concede(s2, 'p');
  assert.equal(s2.winner, 'o');
});

test('illegal actions are rejected without changing state', () => {
  const s = fixture({ pHand: ['supergiant-field'], budget: 3, oBoard: ['packer'] });
  const before = JSON.stringify(s);
  assert.equal(playCard(s, 'p', s.sides.p.hand[0].uid), false);
  assert.equal(attack(s, 'o', 1, { kind: 'well', side: 'p' }), false);
  assert.equal(endTurn(s, 'o'), false);
  assert.equal(JSON.stringify(s), before);
});
