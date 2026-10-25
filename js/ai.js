// The Environment's brain. Pure: given a state, returns the next action.
//
// Strategy: greedy one-step lookahead. Every legal action is simulated on a
// cloned state and scored with `evaluate()`. The best action is taken if it
// improves on doing nothing; otherwise the AI ends its turn.
// Difficulty adds mistakes: Rookie often plays randomly, Engineer sometimes
// picks the second-best move, Senior always plays its best line and checks for lethal.

import { legalActions, applyAction, cloneState, card, other } from './engine.js';
import { createRng } from './rng.js';

export const DIFFICULTIES = {
  rookie: { label: 'Rookie', blunder: 0.45, second: 0.2, bossHp: 20, packs: 1 },
  engineer: { label: 'Engineer', blunder: 0.08, second: 0.25, bossHp: 25, packs: 1 },
  senior: { label: 'Senior', blunder: 0, second: 0, bossHp: 30, packs: 2 },
};

const KW_VALUE = { casing: 1.2, bop: 1.6, recovery: 1.2, waterflood: 1.4, fracture: 0.6, sour: 0.8, spud: 0.2, dual: 0 };

function unitValue(u) {
  if (u.integrity <= 0) return 0;
  let v = u.power * 1.3 + u.integrity * 1.0;
  for (const k of u.kw) v += KW_VALUE[k] ?? 0;
  if (u.kw.includes('dual')) v += u.power * 0.9;
  const c = card(u.id);
  if (c.onTurnStart) v += 2.5;
  if (u.stuck) v -= u.power * 0.5;
  if (u.sour) v -= u.sour * 0.8;
  return v;
}

/** Heuristic score of a position from `side`'s point of view. */
export function evaluate(state, side) {
  if (state.phase === 'over') {
    if (state.winner === side) return 10_000 - state.turn;
    if (state.winner === other(side)) return -10_000;
    return 0;
  }
  const me = state.sides[side];
  const foe = state.sides[other(side)];
  const hpScore = (hp) => (hp <= 0 ? -200 : hp <= 5 ? hp * 2.2 - 5 : hp <= 12 ? hp * 1.4 : hp * 1.0);
  let s = 0;
  s += hpScore(me.hp) - hpScore(foe.hp) * 1.15;
  s += me.board.reduce((a, u) => a + unitValue(u), 0);
  s -= foe.board.reduce((a, u) => a + unitValue(u), 0) * 1.05;
  const junk = (h) => h.filter((c) => card(c.id).junk).length;
  s += (me.hand.length - junk(me.hand)) * 0.7 - junk(me.hand) * 1.5;
  s -= (foe.hand.length - junk(foe.hand)) * 0.5;
  s += me.maxBudget * 0.6;
  // Pressure: total power we threaten next turn vs their Well
  const threat = me.board.reduce((a, u) => a + u.power * (u.kw.includes('dual') ? 2 : 1), 0);
  if (threat >= foe.hp) s += 15;
  const foeThreat = foe.board.reduce((a, u) => a + u.power * (u.kw.includes('dual') ? 2 : 1), 0);
  if (foeThreat >= me.hp) s -= 20;
  if (foe.skipAttacks) s += foeThreat * 0.6;
  return s;
}

/** Choose cards to replace at the start: anything costing 4 or more, and duplicate junk. */
export function chooseMulligan(state, side) {
  return state.sides[side].hand.filter((c) => card(c.id).cost >= 4).map((c) => c.uid);
}

/**
 * Pick the next action for `side`. Returns an action object (possibly { type: 'end' }).
 * `salt` keeps difficulty randomness deterministic per decision.
 */
export function nextAction(state, side, difficulty = 'engineer', salt = 0) {
  const cfg = DIFFICULTIES[difficulty] ?? DIFFICULTIES.engineer;
  const rng = createRng(`${state.seed}:ai:${state.turn}:${salt}`);
  const actions = legalActions(state, side).filter((a) => a.type !== 'end');
  if (!actions.length) return { type: 'end' };

  // Rookie-style blunder: a random legal move (or ending the turn early).
  if (cfg.blunder && rng.next() < cfg.blunder) {
    return rng.next() < 0.25 ? { type: 'end' } : actions[Math.floor(rng.next() * actions.length)];
  }

  const base = evaluate(state, side);
  const scored = [];
  for (const a of actions) {
    const sim = cloneState(state);
    sim.events = [];
    if (!applyAction(sim, side, a)) continue;
    let v = evaluate(sim, side);
    // Small tie-breakers: prefer spending budget, prefer attacking before ending.
    if (a.type === 'play') v += 0.05 * card(state.sides[side].hand.find((h) => h.uid === a.uid).id).cost;
    scored.push({ a, v });
    if (sim.phase === 'over' && sim.winner === side) return a; // lethal: take it
  }
  if (!scored.length) return { type: 'end' };
  scored.sort((x, y) => y.v - x.v);
  let pick = scored[0];
  if (cfg.second && scored.length > 1 && rng.next() < cfg.second && scored[1].v > base) pick = scored[1];
  return pick.v > base - 0.01 ? pick.a : { type: 'end' };
}

/** Decide whether the AI agrees to a rematch, and what it says. */
export function rematchReply(lastWinner, side, rngSeed) {
  const rng = createRng(`rematch:${rngSeed}`);
  const won = lastWinner === side;
  const lines = won
    ? ['The rock always wins eventually. Again?', 'Pressure builds. I accept.', 'Back to spud. I am ready.']
    : ['You found the window this time. Rematch accepted.', 'Fine. I will come back over-pressured.', 'The formation remembers. Again.'];
  return { accept: true, line: lines[Math.floor(rng.next() * lines.length)] };
}
