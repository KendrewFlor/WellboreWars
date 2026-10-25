// Wellbore Wars — rules engine.
// Pure and deterministic: no DOM, no Date, no Math.random. Every action takes a
// state, mutates it in place and records `events` that the UI animates.
// Randomness comes from the seed + a counter stored in the state, so any match
// can be replayed exactly (and tested in Node).

import DB from '../data/cards.json' with { type: 'json' };
import { createRng } from './rng.js';

export const RULES = Object.freeze({
  wellHp: 25,
  maxBudget: 10,
  powerCost: 2,
  boardSize: 6,
  handSize: 8,
  deckSize: 20,
  startHandFirst: 3,
  startHandSecond: 4,
  turnLimit: 90, // safety valve: after this many turns the healthier Well wins
});

export const CARDS = Object.freeze(Object.fromEntries(DB.cards.map((c) => [c.id, c])));
export const COMMANDERS = DB.commanders;
export const DISCIPLINES = DB.disciplines;
export const KEYWORDS = DB.keywords;
export const RARITIES = DB.rarities;
export const STARTER_DECKS = DB.starterDecks;
export const BOSSES = DB.bosses;

export const card = (id) => {
  const c = CARDS[id];
  if (!c) throw new Error(`Unknown card: ${id}`);
  return c;
};

export const other = (side) => (side === 'p' ? 'o' : 'p');

// ------------------------------------------------------------------ randomness

function rand(state) {
  return createRng(`${state.seed}:${state.rc++}`).next();
}

function shuffle(state, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand(state) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ------------------------------------------------------------------ setup

function makeSide(state, key, { name, commander, deck, hp }) {
  return {
    key,
    name,
    commander,
    hp,
    maxHp: hp,
    budget: 0,
    maxBudget: 0,
    deck: shuffle(state, deck.map((id) => ({ uid: state.nextUid++, id }))),
    hand: [],
    board: [],
    grave: [],
    fatigue: 0,
    turns: 0, // turns this side has taken (for boss passives)
    powerUsed: false,
    skipAttacks: false,
    discount: 0,
    tax: 0,
    taxNext: 0,
    mulliganDone: false,
    stats: { damage: 0, played: 0, destroyed: 0, healed: 0 },
  };
}

/**
 * Create a match. `first` is 'p', 'o' or 'random'.
 * player/opponent: { name, commander, deck: [cardIds], hp }
 */
export function createMatch({ seed, player, opponent, first = 'random' }) {
  const state = {
    v: 1,
    seed: String(seed),
    rc: 0,
    nextUid: 1,
    turn: 0,
    active: 'p',
    first: 'p',
    phase: 'mulligan',
    winner: null,
    draw: false,
    field: null,
    sides: {},
    events: [],
    log: [],
  };
  state.sides.p = makeSide(state, 'p', { hp: RULES.wellHp, ...player });
  state.sides.o = makeSide(state, 'o', { hp: RULES.wellHp, ...opponent });
  state.first = first === 'random' ? (rand(state) < 0.5 ? 'p' : 'o') : first;
  state.active = state.first;
  const second = other(state.first);
  for (let i = 0; i < RULES.startHandFirst; i++) drawCard(state, state.first, { silent: true });
  for (let i = 0; i < RULES.startHandSecond; i++) drawCard(state, second, { silent: true });
  addToHand(state, second, 'spare-budget');
  return state;
}

/** Replace the chosen cards from hand with new ones (once per side), then start when both are done. */
export function mulligan(state, side, uids = []) {
  const s = state.sides[side];
  if (state.phase !== 'mulligan' || s.mulliganDone) return false;
  const replace = s.hand.filter((c) => uids.includes(c.uid) && c.id !== 'spare-budget');
  for (const c of replace) {
    s.hand.splice(s.hand.indexOf(c), 1);
    s.deck.push(c);
  }
  shuffle(state, s.deck);
  for (let i = 0; i < replace.length; i++) drawCard(state, side, { silent: true });
  s.mulliganDone = true;
  if (state.sides.p.mulliganDone && state.sides.o.mulliganDone) {
    state.phase = 'play';
    startTurn(state, state.first);
  }
  return true;
}

// ------------------------------------------------------------------ helpers

function emit(state, ev) {
  state.events.push(ev);
}

function log(state, text) {
  state.log.push({ turn: state.turn, text });
  if (state.log.length > 80) state.log.shift();
}

export function findUnit(state, uid) {
  for (const key of ['p', 'o']) {
    const u = state.sides[key].board.find((x) => x.uid === uid);
    if (u) return { unit: u, side: key };
  }
  return null;
}

function addToHand(state, side, id) {
  const s = state.sides[side];
  const inst = { uid: state.nextUid++, id };
  if (s.hand.length >= RULES.handSize) {
    s.grave.push(id);
    emit(state, { type: 'burn', side, id });
    log(state, `${s.name}'s hand is full — ${card(id).name} is burned.`);
    return null;
  }
  s.hand.push(inst);
  return inst;
}

function drawCard(state, side, { silent = false } = {}) {
  const s = state.sides[side];
  const c = s.deck.pop();
  if (!c) {
    s.fatigue += 1;
    damageWell(state, side, s.fatigue, null, 'fatigue');
    emit(state, { type: 'fatigue', side, amount: s.fatigue });
    log(state, `${s.name} has no cards left — ${s.fatigue} fatigue damage.`);
    return null;
  }
  if (s.hand.length >= RULES.handSize) {
    s.grave.push(c.id);
    emit(state, { type: 'burn', side, id: c.id });
    log(state, `${s.name}'s hand is full — ${card(c.id).name} is burned.`);
    return null;
  }
  s.hand.push(c);
  if (!silent) emit(state, { type: 'draw', side, uid: c.uid });
  return c;
}

function hasKw(unit, kw) {
  return unit.kw.includes(kw);
}

function makeUnit(state, id) {
  const c = card(id);
  return {
    uid: state.nextUid++,
    id,
    power: c.power,
    integrity: c.integrity,
    maxIntegrity: c.integrity,
    kw: [...(c.kw ?? [])],
    attacksLeft: 0,
    stuck: 0,
    sour: 0,
  };
}

/** Discipline wheel: +1 damage against the discipline you beat. */
export function advantage(attackerId, defenderId) {
  const a = card(attackerId).disc;
  const d = card(defenderId).disc;
  return DISCIPLINES[a]?.beats === d ? 1 : 0;
}

/** Effective cost of a card in hand for this side right now. */
export function costOf(state, side, id) {
  const c = card(id);
  const s = state.sides[side];
  let cost = c.cost + s.tax - s.discount;
  if (state.field?.kind === 'hpht' && c.type === 'operation') cost += 1;
  return Math.max(0, cost);
}

// ------------------------------------------------------------------ damage & healing

function damageWell(state, side, amount, sourceUnit, cause = 'damage') {
  if (amount <= 0) return 0;
  const s = state.sides[side];
  s.hp -= amount;
  state.sides[other(side)].stats.damage += amount;
  emit(state, { type: 'damage', target: { kind: 'well', side }, amount, cause });
  if (sourceUnit && hasKw(sourceUnit.unit, 'recovery')) healWell(state, sourceUnit.side, amount);
  return amount;
}

function healWell(state, side, amount) {
  const s = state.sides[side];
  const healed = Math.max(0, Math.min(amount, s.maxHp - s.hp));
  if (healed > 0) {
    s.hp += healed;
    s.stats.healed += healed;
    emit(state, { type: 'heal', target: { kind: 'well', side }, amount: healed });
  }
  return healed;
}

/** Damage a unit. Returns the damage actually dealt (0 if BOP absorbed it). */
function damageUnit(state, ref, amount, sourceUnit, cause = 'damage') {
  if (amount <= 0) return 0;
  const { unit, side } = ref;
  if (hasKw(unit, 'bop')) {
    unit.kw = unit.kw.filter((k) => k !== 'bop');
    emit(state, { type: 'shield', uid: unit.uid, side });
    return 0;
  }
  unit.integrity -= amount;
  state.sides[other(side)].stats.damage += amount;
  emit(state, { type: 'damage', target: { kind: 'unit', uid: unit.uid, side }, amount, cause });
  if (sourceUnit) {
    if (hasKw(sourceUnit.unit, 'recovery')) healWell(state, sourceUnit.side, amount);
    if (hasKw(sourceUnit.unit, 'sour') && unit.integrity > 0) {
      unit.sour = 2;
      emit(state, { type: 'status', uid: unit.uid, status: 'sour' });
    }
  }
  return amount;
}

function healUnit(state, unit, amount) {
  const healed = Math.max(0, Math.min(amount, unit.maxIntegrity - unit.integrity));
  if (healed > 0) {
    unit.integrity += healed;
    emit(state, { type: 'heal', target: { kind: 'unit', uid: unit.uid }, amount: healed });
  }
  return healed;
}

/** Remove dead units and fire their P&A effects. Loops until stable. */
function resolveDeaths(state) {
  for (let guard = 0; guard < 20; guard++) {
    const dead = [];
    for (const key of ['p', 'o']) {
      const s = state.sides[key];
      for (const u of s.board) if (u.integrity <= 0) dead.push({ unit: u, side: key });
    }
    if (!dead.length) return;
    for (const d of dead) {
      const s = state.sides[d.side];
      s.board = s.board.filter((u) => u.uid !== d.unit.uid);
      s.grave.push(d.unit.id);
      state.sides[other(d.side)].stats.destroyed += 1;
      emit(state, { type: 'death', uid: d.unit.uid, side: d.side, id: d.unit.id });
      log(state, `${card(d.unit.id).name} is plugged and abandoned.`);
    }
    for (const d of dead) {
      const c = card(d.unit.id);
      if (c.onDeath) runEffects(state, d.side, c.onDeath.effects, { source: null, cardId: d.unit.id });
    }
  }
}

function checkWinner(state) {
  if (state.phase === 'over') return true;
  const p = state.sides.p.hp <= 0;
  const o = state.sides.o.hp <= 0;
  if (p || o) {
    state.phase = 'over';
    if (p && o) { state.draw = true; state.winner = null; } else state.winner = p ? 'o' : 'p';
    emit(state, { type: 'gameover', winner: state.winner, draw: state.draw });
    return true;
  }
  return false;
}

// ------------------------------------------------------------------ targeting

/** Every valid target for a target spec, as refs { kind, uid?, side }. */
export function validTargets(state, side, spec, { maxIntegrity = null } = {}) {
  const me = state.sides[side];
  const foe = state.sides[other(side)];
  const units = (s) => s.board.map((u) => ({ kind: 'unit', uid: u.uid, side: s.key }));
  let refs = [];
  switch (spec) {
    case 'enemyUnit': refs = units(foe); break;
    case 'friendlyUnit': refs = units(me); break;
    case 'anyUnit': refs = [...units(me), ...units(foe)]; break;
    case 'enemyAny': refs = [...units(foe), { kind: 'well', side: foe.key }]; break;
    case 'friendlyAny': refs = [...units(me), { kind: 'well', side: me.key }]; break;
    default: return [];
  }
  if (maxIntegrity != null) {
    refs = refs.filter((r) => r.kind !== 'unit' || findUnit(state, r.uid).unit.integrity <= maxIntegrity);
  }
  return refs;
}

const sameRef = (a, b) => a && b && a.kind === b.kind && (a.kind === 'well' ? a.side === b.side : a.uid === b.uid);

function resolveRef(state, ref) {
  if (!ref) return null;
  if (ref.kind === 'well') return { kind: 'well', side: ref.side };
  const f = findUnit(state, ref.uid);
  return f ? { kind: 'unit', ...f } : null;
}

// ------------------------------------------------------------------ effects

function unitsOf(state, side) {
  return state.sides[side].board.map((u) => ({ unit: u, side }));
}

function runEffects(state, side, effects, { target = null, source = null, cardId = null } = {}) {
  const foe = other(side);
  for (const e of effects ?? []) {
    if (state.phase === 'over') return;
    const tgt = resolveRef(state, target);
    switch (e.op) {
      case 'damage': {
        const hitUnit = (r) => damageUnit(state, r, e.amount, source);
        if (e.to === 'target' && tgt) tgt.kind === 'well' ? damageWell(state, tgt.side, e.amount, source) : hitUnit(tgt);
        else if (e.to === 'allEnemyUnits') unitsOf(state, foe).forEach(hitUnit);
        else if (e.to === 'allEnemies') { unitsOf(state, foe).forEach(hitUnit); damageWell(state, foe, e.amount, source); }
        else if (e.to === 'enemyWell') damageWell(state, foe, e.amount, source);
        else if (e.to === 'randomEnemyUnit') {
          const list = unitsOf(state, foe).filter((r) => r.unit.integrity > 0);
          if (list.length) hitUnit(list[Math.floor(rand(state) * list.length)]);
        }
        break;
      }
      case 'heal': {
        if (e.to === 'target' && tgt) tgt.kind === 'well' ? healWell(state, tgt.side, e.amount) : healUnit(state, tgt.unit, e.amount);
        else if (e.to === 'ownWell') healWell(state, side, e.amount);
        else if (e.to === 'allFriendlyUnits') unitsOf(state, side).forEach((r) => healUnit(state, r.unit, e.amount));
        break;
      }
      case 'buff': {
        const apply = (u) => {
          u.power = Math.max(0, u.power + e.power);
          u.integrity += e.integrity;
          u.maxIntegrity += e.integrity;
          emit(state, { type: 'buff', uid: u.uid, power: e.power, integrity: e.integrity });
        };
        if (e.to === 'target' && tgt?.kind === 'unit') apply(tgt.unit);
        else if (e.to === 'allFriendlyUnits') state.sides[side].board.forEach(apply);
        else if (e.to === 'otherFriendlyUnits') state.sides[side].board.filter((u) => u.uid !== source?.unit.uid).forEach(apply);
        break;
      }
      case 'grant': {
        const apply = (u) => { if (!u.kw.includes(e.keyword)) u.kw.push(e.keyword); emit(state, { type: 'grant', uid: u.uid, keyword: e.keyword }); };
        if (e.to === 'target' && tgt?.kind === 'unit') apply(tgt.unit);
        else if (e.to === 'allFriendlyUnits') state.sides[side].board.forEach(apply);
        break;
      }
      case 'stun': {
        const apply = (u) => { u.stuck = 1; u.attacksLeft = 0; emit(state, { type: 'status', uid: u.uid, status: 'stuck' }); };
        if (e.to === 'target' && tgt?.kind === 'unit') apply(tgt.unit);
        else if (e.to === 'allEnemyUnits') state.sides[foe].board.forEach(apply);
        break;
      }
      case 'cleanse':
        state.sides[side].board.forEach((u) => { u.stuck = 0; u.sour = 0; });
        emit(state, { type: 'cleanse', side });
        break;
      case 'draw': {
        if (e.if === 'moreUnits' && !(state.sides[side].board.length > state.sides[foe].board.length)) break;
        for (let i = 0; i < e.n; i++) drawCard(state, side);
        break;
      }
      case 'drawPerEnemyUnit': {
        const n = Math.min(e.max, state.sides[foe].board.length);
        for (let i = 0; i < n; i++) drawCard(state, side);
        break;
      }
      case 'summon': {
        for (let i = 0; i < e.n; i++) {
          if (state.sides[side].board.length >= RULES.boardSize) break;
          const u = makeUnit(state, e.card);
          state.sides[side].board.push(u);
          emit(state, { type: 'summon', uid: u.uid, side, id: e.card });
        }
        break;
      }
      case 'bounce': {
        if (tgt?.kind !== 'unit') break;
        const s = state.sides[tgt.side];
        s.board = s.board.filter((u) => u.uid !== tgt.unit.uid);
        emit(state, { type: 'bounce', uid: tgt.unit.uid, side: tgt.side });
        if (!card(tgt.unit.id).token) addToHand(state, tgt.side, tgt.unit.id);
        break;
      }
      case 'destroy': {
        if (tgt?.kind !== 'unit') break;
        tgt.unit.integrity = 0;
        emit(state, { type: 'destroy', uid: tgt.unit.uid });
        break;
      }
      case 'swap': {
        if (tgt?.kind !== 'unit') break;
        const u = tgt.unit;
        [u.power, u.integrity] = [u.integrity, u.power];
        u.maxIntegrity = Math.max(u.integrity, 0);
        emit(state, { type: 'swap', uid: u.uid });
        break;
      }
      case 'skip':
        state.sides[foe].skipAttacks = true;
        emit(state, { type: 'skip', side: foe });
        break;
      case 'junk':
        for (let i = 0; i < e.n; i++) addToHand(state, foe, 'cuttings');
        emit(state, { type: 'junk', side: foe, n: e.n });
        break;
      case 'discard': {
        for (let i = 0; i < e.n; i++) {
          const h = state.sides[foe].hand;
          if (!h.length) break;
          const [c] = h.splice(Math.floor(rand(state) * h.length), 1);
          state.sides[foe].grave.push(c.id);
          emit(state, { type: 'discard', side: foe, id: c.id });
        }
        break;
      }
      case 'discount':
        state.sides[side].discount += e.n;
        break;
      case 'budget':
        state.sides[side].budget = Math.min(RULES.maxBudget, state.sides[side].budget + e.n);
        break;
      case 'maxBudget': {
        const s = state.sides[side];
        s.maxBudget = Math.min(RULES.maxBudget, s.maxBudget + e.n);
        break;
      }
      case 'taxNext':
        state.sides[foe].taxNext += e.n;
        emit(state, { type: 'tax', side: foe, n: e.n });
        break;
      default:
        throw new Error(`Unknown effect op: ${e.op}`);
    }
    checkWinner(state);
  }
}

// ------------------------------------------------------------------ turn flow

function startTurn(state, side) {
  const s = state.sides[side];
  state.active = side;
  state.turn += 1;
  s.turns += 1;
  s.maxBudget = Math.min(RULES.maxBudget, s.maxBudget + 1);
  s.budget = s.maxBudget;
  s.tax = s.taxNext;
  s.taxNext = 0;
  s.discount = 0;
  s.powerUsed = false;
  emit(state, { type: 'turn', side, turn: state.turn });
  log(state, `Turn ${state.turn}: ${s.name}.`);

  drawCard(state, side);
  if (state.field?.kind === 'shale') drawCard(state, side);

  // Units wake up
  const skip = s.skipAttacks;
  s.skipAttacks = false;
  for (const u of s.board) {
    u.attacksLeft = skip || u.stuck > 0 ? 0 : hasKw(u, 'dual') ? 2 : 1;
    if (u.stuck > 0) u.stuck -= 1;
  }

  // Start-of-turn effects
  for (const u of [...s.board]) {
    if (u.sour > 0) { u.sour -= 1; damageUnit(state, { unit: u, side }, 1, null, 'sour'); }
    if (hasKw(u, 'waterflood')) healUnit(state, u, 2);
    if (state.field?.kind === 'deepwater') healUnit(state, u, 1);
    if (state.field?.kind === 'hurricane') damageUnit(state, { unit: u, side }, 1, null, 'field');
  }
  resolveDeaths(state);
  for (const u of [...s.board]) {
    const c = card(u.id);
    if (c.onTurnStart && s.board.includes(u)) runEffects(state, side, c.onTurnStart.effects, { source: { unit: u, side } });
  }
  const passive = COMMANDERS[s.commander]?.passive;
  if (passive && s.turns % passive.every === 0) {
    emit(state, { type: 'passive', side, name: passive.name });
    log(state, `${s.name}: ${passive.name}!`);
    runEffects(state, side, passive.effects, {});
  }
  resolveDeaths(state);
  checkWinner(state);
}

/** End the active side's turn. */
export function endTurn(state, side) {
  if (state.phase !== 'play' || state.active !== side) return false;
  const s = state.sides[side];
  const junk = s.hand.filter((c) => card(c.id).junk).length;
  if (junk) {
    damageWell(state, side, junk, null, 'cuttings');
    log(state, `${junk} Cuttings in hand deal ${junk} damage to ${s.name}'s Well.`);
  }
  for (const u of s.board) u.attacksLeft = 0;
  if (checkWinner(state)) return true;
  if (state.turn >= RULES.turnLimit) {
    state.phase = 'over';
    const p = state.sides.p.hp, o = state.sides.o.hp;
    state.draw = p === o;
    state.winner = p === o ? null : p > o ? 'p' : 'o';
    emit(state, { type: 'gameover', winner: state.winner, draw: state.draw, reason: 'turnLimit' });
    return true;
  }
  startTurn(state, other(side));
  return true;
}

// ------------------------------------------------------------------ actions

export function canPlay(state, side, uid) {
  if (state.phase !== 'play' || state.active !== side) return false;
  const s = state.sides[side];
  const inst = s.hand.find((c) => c.uid === uid);
  if (!inst) return false;
  const c = card(inst.id);
  if (costOf(state, side, inst.id) > s.budget) return false;
  if (c.type === 'unit' && s.board.length >= RULES.boardSize) return false;
  if (c.type === 'operation' && c.target && c.target !== 'none') {
    return validTargets(state, side, c.target, { maxIntegrity: c.targetMaxIntegrity ?? null }).length > 0;
  }
  return true;
}

/** What target spec (if any) a card in hand needs. Units with an optional Rig-Up target return it too. */
export function targetSpecFor(id) {
  const c = card(id);
  if (c.type === 'operation') return c.target && c.target !== 'none' ? c.target : null;
  if (c.type === 'unit') return c.onPlay?.target && c.onPlay.target !== 'none' ? c.onPlay.target : null;
  return null;
}

export function playCard(state, side, uid, target = null) {
  if (!canPlay(state, side, uid)) return false;
  const s = state.sides[side];
  const inst = s.hand.find((c) => c.uid === uid);
  const c = card(inst.id);
  const spec = targetSpecFor(inst.id);
  if (spec) {
    const valid = validTargets(state, side, spec, { maxIntegrity: c.targetMaxIntegrity ?? null });
    const required = c.type === 'operation';
    if (target && !valid.some((v) => sameRef(v, target))) return false;
    if (required && !target) return false;
    if (!target && valid.length && c.type === 'unit') return false; // must choose when a choice exists
  }
  const cost = costOf(state, side, inst.id);
  s.budget -= cost;
  if (s.discount > 0) s.discount = 0;
  s.hand = s.hand.filter((h) => h.uid !== uid);
  s.stats.played += 1;
  emit(state, { type: 'play', side, id: inst.id, uid, target });
  log(state, `${s.name} plays ${c.name}.`);

  if (c.type === 'unit') {
    const u = makeUnit(state, inst.id);
    u.uid = uid; // keep the hand uid so the UI can animate the same card
    u.attacksLeft = hasKw(u, 'spud') ? (hasKw(u, 'dual') ? 2 : 1) : 0;
    s.board.push(u);
    emit(state, { type: 'summon', uid: u.uid, side, id: u.id });
    if (c.onPlay) runEffects(state, side, c.onPlay.effects, { target, source: { unit: u, side }, cardId: c.id });
  } else if (c.type === 'operation') {
    runEffects(state, side, c.effects, { target, cardId: c.id });
    s.grave.push(c.id);
  } else if (c.type === 'field') {
    if (state.field) state.sides[state.field.owner].grave.push(state.field.id);
    state.field = { id: c.id, owner: side, kind: c.field };
    emit(state, { type: 'field', side, id: c.id });
  }
  resolveDeaths(state);
  checkWinner(state);
  return true;
}

/** Attack targets available to a given attacker (respects Casing). */
export function attackTargets(state, side, attackerUid) {
  if (state.phase !== 'play' || state.active !== side) return [];
  const atk = state.sides[side].board.find((u) => u.uid === attackerUid);
  if (!atk || atk.attacksLeft <= 0 || atk.power <= 0) return [];
  const foe = state.sides[other(side)];
  const casing = foe.board.filter((u) => hasKw(u, 'casing'));
  if (casing.length) return casing.map((u) => ({ kind: 'unit', uid: u.uid, side: foe.key }));
  return [...foe.board.map((u) => ({ kind: 'unit', uid: u.uid, side: foe.key })), { kind: 'well', side: foe.key }];
}

export function attack(state, side, attackerUid, target) {
  const legal = attackTargets(state, side, attackerUid);
  if (!legal.some((t) => sameRef(t, target))) return false;
  const atk = state.sides[side].board.find((u) => u.uid === attackerUid);
  const atkRef = { unit: atk, side };
  atk.attacksLeft -= 1;
  emit(state, { type: 'attack', side, uid: atk.uid, target });

  if (target.kind === 'well') {
    log(state, `${card(atk.id).name} hits the enemy Well for ${atk.power}.`);
    damageWell(state, target.side, atk.power, atkRef);
  } else {
    const defRef = findUnit(state, target.uid);
    const def = defRef.unit;
    const dmg = atk.power + advantage(atk.id, def.id);
    const back = def.power + advantage(def.id, atk.id);
    const before = def.integrity;
    const hadBop = hasKw(def, 'bop');
    log(state, `${card(atk.id).name} attacks ${card(def.id).name}.`);
    const dealt = damageUnit(state, defRef, dmg, atkRef);
    if (hasKw(atk, 'fracture') && !hadBop && dealt > before) {
      damageWell(state, defRef.side, dealt - before, atkRef, 'fracture');
    }
    damageUnit(state, atkRef, back, defRef);
  }
  resolveDeaths(state);
  checkWinner(state);
  return true;
}

export function canUsePower(state, side) {
  const s = state.sides[side];
  if (state.phase !== 'play' || state.active !== side || s.powerUsed) return false;
  const p = COMMANDERS[s.commander].power;
  if (s.budget < p.cost) return false;
  if (p.effects.some((e) => e.op === 'summon') && s.board.length >= RULES.boardSize) return false;
  if (p.target && p.target !== 'none') return validTargets(state, side, p.target).length > 0;
  return true;
}

export function usePower(state, side, target = null) {
  if (!canUsePower(state, side)) return false;
  const s = state.sides[side];
  const p = COMMANDERS[s.commander].power;
  if (p.target && p.target !== 'none') {
    if (!target || !validTargets(state, side, p.target).some((v) => sameRef(v, target))) return false;
  }
  s.budget -= p.cost;
  s.powerUsed = true;
  emit(state, { type: 'power', side, name: p.name, target });
  log(state, `${s.name} uses ${p.name}.`);
  runEffects(state, side, p.effects, { target });
  resolveDeaths(state);
  checkWinner(state);
  return true;
}

/** Concede: the other side wins immediately. */
export function concede(state, side) {
  if (state.phase === 'over') return;
  state.sides[side].hp = 0;
  state.phase = 'over';
  state.winner = other(side);
  emit(state, { type: 'gameover', winner: state.winner, draw: false, reason: 'concede' });
}

// ------------------------------------------------------------------ action enumeration (AI & tests)

export function legalActions(state, side) {
  if (state.phase !== 'play' || state.active !== side) return [];
  const s = state.sides[side];
  const actions = [];
  for (const h of s.hand) {
    if (!canPlay(state, side, h.uid)) continue;
    const spec = targetSpecFor(h.id);
    const c = card(h.id);
    if (spec) {
      const ts = validTargets(state, side, spec, { maxIntegrity: c.targetMaxIntegrity ?? null });
      if (ts.length) ts.forEach((t) => actions.push({ type: 'play', uid: h.uid, target: t }));
      else if (c.type === 'unit') actions.push({ type: 'play', uid: h.uid, target: null });
    } else actions.push({ type: 'play', uid: h.uid, target: null });
  }
  for (const u of s.board) {
    for (const t of attackTargets(state, side, u.uid)) actions.push({ type: 'attack', uid: u.uid, target: t });
  }
  if (canUsePower(state, side)) {
    const p = COMMANDERS[s.commander].power;
    if (p.target && p.target !== 'none') validTargets(state, side, p.target).forEach((t) => actions.push({ type: 'power', target: t }));
    else actions.push({ type: 'power', target: null });
  }
  actions.push({ type: 'end' });
  return actions;
}

export function applyAction(state, side, a) {
  switch (a.type) {
    case 'play': return playCard(state, side, a.uid, a.target);
    case 'attack': return attack(state, side, a.uid, a.target);
    case 'power': return usePower(state, side, a.target);
    case 'end': return endTurn(state, side);
    default: return false;
  }
}

/** Take (and clear) pending events for the UI. */
export function drainEvents(state) {
  const ev = state.events;
  state.events = [];
  return ev;
}

export function cloneState(state) {
  return structuredClone(state);
}
