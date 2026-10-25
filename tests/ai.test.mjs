import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, mulligan, applyAction, drainEvents, legalActions, STARTER_DECKS, BOSSES, RULES } from '../js/engine.js';
import { nextAction, chooseMulligan, evaluate, DIFFICULTIES, rematchReply } from '../js/ai.js';

function runGame(pDeck, boss, seed, diffP = 'engineer', diffO = 'engineer', onStep = null) {
  const d = STARTER_DECKS[pDeck], b = BOSSES[boss];
  const s = createMatch({ seed, player: { name: 'P', commander: d.commander, deck: d.cards }, opponent: { name: b.name, commander: b.commander, deck: b.cards, hp: DIFFICULTIES[diffO].bossHp } });
  mulligan(s, 'p', chooseMulligan(s, 'p'));
  mulligan(s, 'o', chooseMulligan(s, 'o'));
  let steps = 0;
  while (s.phase !== 'over' && steps < 4000) {
    const side = s.active;
    const a = nextAction(s, side, side === 'p' ? diffP : diffO, steps);
    assert.ok(applyAction(s, side, a), `AI chose an illegal action ${JSON.stringify(a)}`);
    drainEvents(s);
    onStep?.(s);
    steps++;
  }
  return { s, steps };
}

test('AI vs AI games always finish with legal moves and sane invariants', () => {
  let n = 0;
  for (const pd of Object.keys(STARTER_DECKS)) {
    for (const boss of Object.keys(BOSSES)) {
      for (const diff of Object.keys(DIFFICULTIES)) {
        const { s } = runGame(pd, boss, `inv-${pd}-${boss}-${diff}`, diff, diff, (st) => {
          for (const k of ['p', 'o']) {
            const side = st.sides[k];
            assert.ok(side.board.length <= RULES.boardSize);
            assert.ok(side.hand.length <= RULES.handSize);
            assert.ok(side.hp <= side.maxHp);
            assert.ok(side.budget >= 0 && side.maxBudget <= RULES.maxBudget);
            side.board.forEach((u) => assert.ok(u.integrity > 0 && u.power >= 0, `dead/negative unit left on board: ${u.id}`));
          }
        });
        assert.equal(s.phase, 'over');
        n++;
      }
    }
  }
  assert.equal(n, 27);
});

test('Senior AI takes lethal when it is available', () => {
  const d = STARTER_DECKS['drill-crew'];
  const s = createMatch({ seed: 'lethal', player: { name: 'P', commander: d.commander, deck: d.cards }, opponent: { name: 'O', commander: d.commander, deck: d.cards }, first: 'o' });
  mulligan(s, 'p', []); mulligan(s, 'o', []);
  s.sides.p.hp = 3;
  s.sides.o.board = [{ uid: 9001, id: 'derrickhand', power: 3, integrity: 1, maxIntegrity: 1, kw: ['spud'], attacksLeft: 1, stuck: 0, sour: 0 }];
  s.sides.p.board = [];
  const a = nextAction(s, 'o', 'senior');
  assert.equal(a.type, 'attack');
  assert.deepEqual(a.target, { kind: 'well', side: 'p' });
});

test('evaluate prefers winning and having more board', () => {
  const d = STARTER_DECKS['drill-crew'];
  const s = createMatch({ seed: 'eval', player: { name: 'P', commander: d.commander, deck: d.cards }, opponent: { name: 'O', commander: d.commander, deck: d.cards } });
  const base = evaluate(s, 'p');
  s.sides.p.board.push({ uid: 1, id: 'roughneck', power: 1, integrity: 2, maxIntegrity: 2, kw: [], attacksLeft: 0, stuck: 0, sour: 0 });
  assert.ok(evaluate(s, 'p') > base);
  s.phase = 'over'; s.winner = 'p';
  assert.ok(evaluate(s, 'p') > 1000);
});

test('difficulty matters: Senior beats Rookie more often than not', () => {
  let seniorWins = 0;
  const games = 24;
  for (let i = 0; i < games; i++) {
    const { s } = runGame('production-ops', 'the-formation', `diff-${i}`, 'senior', 'rookie');
    if (s.winner === 'p') seniorWins++;
  }
  assert.ok(seniorWins / games > 0.6, `senior won ${seniorWins}/${games}`);
});

test('rematch reply always consents and speaks in character', () => {
  const r = rematchReply('o', 'o', 'x');
  assert.equal(r.accept, true);
  assert.ok(r.line.length > 5);
  assert.ok(legalActions);
});
