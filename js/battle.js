// Battle screen controller: input, targeting, animation/sound queue, AI turns,
// mulligan, pause menu (Leave), and the end screen with two-sided rematch consent.

import {
  createMatch, mulligan, playCard, attack, endTurn, usePower, concede, canPlay, canUsePower, costOf, targetSpecFor,
  validTargets, attackTargets, drainEvents, applyAction, card, COMMANDERS, STARTER_DECKS, BOSSES, RULES,
} from './engine.js';
import { nextAction, chooseMulligan, DIFFICULTIES, rematchReply } from './ai.js';
import { renderCard, renderUnit, updateUnit, renderBack, renderZoom } from './cards-ui.js';
import { h, setText, wait } from './dom.js';
import { sfx } from './audio.js';

const $ = (id) => document.getElementById(id);
const SPEED = { slow: 1.5, normal: 1, fast: 0.45 };

/**
 * Put `nodes` into `parent` in order, moving only what is out of place.
 * (replaceChildren would detach every node and restart its CSS animations.)
 */
function syncChildren(parent, nodes) {
  nodes.forEach((n, i) => { if (parent.children[i] !== n) parent.insertBefore(n, parent.children[i] ?? null); });
  while (parent.children.length > nodes.length) parent.lastElementChild.remove();
}

/** Add a one-shot animation class that removes itself when the animation ends. */
function animateOnce(el, cls) {
  el.classList.add(cls);
  el.addEventListener('animationend', function done(e) {
    if (e.target !== el) return;
    el.classList.remove(cls);
    el.removeEventListener('animationend', done);
  });
}

const TAUNTS = {
  'the-formation': { start: 'You are drilling into 0.6 psi per foot. Mind your mud weight.', low: 'The pressure is bleeding off…', big: 'Feel that? That is pore pressure.' },
  'typhoon-season': { start: 'Secure the deck. The season has started.', low: 'The eye is passing…', big: 'Category five. Evacuate.' },
  'market-crash': { start: 'Brent is falling. How much can you afford to lose?', low: 'The bulls are back…', big: 'Margin call. Pay up.' },
};

export function createBattle({ ui, getProfile, onResult, onLeave }) {
  let state = null;
  let cfg = null; // { deckKey, deckCards, commander, bossKey, difficulty }
  let mode = { type: 'idle' };
  let busy = false;
  let alive = false;
  let aiSalt = 0;
  const keep = new Set(); // unit uids kept on screen until their death animation plays
  const root = $('screen-battle');

  const speed = () => SPEED[getProfile().settings.speed] ?? 1;
  const reduced = () => getProfile().settings.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;
  const D = (ms) => (reduced() ? Math.min(ms, 120) : ms * speed());

  // ---------------------------------------------------------------- lifecycle

  function start(config) {
    cfg = config;
    const profile = getProfile();
    const boss = BOSSES[cfg.bossKey];
    const seed = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
    state = createMatch({
      seed,
      player: { name: profile.name, commander: cfg.commander, deck: cfg.deckCards },
      opponent: { name: boss.name, commander: boss.commander, deck: boss.cards, hp: DIFFICULTIES[cfg.difficulty].bossHp },
    });
    mulligan(state, 'o', chooseMulligan(state, 'o'));
    drainEvents(state);
    alive = true;
    busy = false;
    aiSalt = 0;
    mode = { type: 'idle' };
    keep.clear();
    $('b-enemy-lane').replaceChildren();
    $('b-player-lane').replaceChildren();
    $('b-hand').replaceChildren();
    $('b-log').replaceChildren();
    setText($('b-enemy-name'), boss.name);
    setText($('b-enemy-title'), `${boss.title} · ${DIFFICULTIES[cfg.difficulty].label}`);
    setText($('b-player-name'), profile.name);
    setText($('b-player-title'), COMMANDERS[cfg.commander].name);
    $('b-enemy-portrait').className = `portrait boss-${cfg.bossKey}`;
    $('b-player-portrait').className = `portrait cmd-${cfg.commander}`;
    renderAll();
    sfx.shuffle();
    showMulligan();
  }

  function stop() {
    alive = false;
    busy = false;
    hideBubble();
  }

  // ---------------------------------------------------------------- rendering

  function renderAll() {
    if (!state) return;
    renderHud('p');
    renderHud('o');
    renderLane('p');
    renderLane('o');
    renderHand();
    renderEnemyHand();
    renderField();
    renderLog();
    renderControls();
    applyHighlights();
  }

  function renderHud(side) {
    const s = state.sides[side];
    const pre = side === 'p' ? 'b-player' : 'b-enemy';
    setText($(`${pre}-hp`), String(Math.max(0, s.hp)));
    $(`${pre}-hpbar`).style.setProperty('--hp', String(Math.max(0, s.hp) / s.maxHp));
    $(`${pre}-portrait`).classList.toggle('is-low', s.hp <= 8);
    setText($(`${pre}-deck`), String(s.deck.length));
    const gems = $(`${pre}-budget`);
    if (gems.childElementCount !== RULES.maxBudget) gems.replaceChildren(...Array.from({ length: RULES.maxBudget }, () => h('span', { class: 'gem' })));
    [...gems.children].forEach((g, i) => { g.classList.toggle('full', i < s.budget); g.classList.toggle('max', i < s.maxBudget); });
    setText($(`${pre}-budget-text`), `${s.budget}/${s.maxBudget}`);
    const flags = [];
    if (s.tax) flags.push(`Costs +${s.tax}`);
    if (s.discount) flags.push(`Next card −${s.discount}`);
    if (s.skipAttacks) flags.push('Waiting on weather');
    setText($(`${pre}-flags`), flags.join(' · '));
  }

  function renderLane(side) {
    const lane = side === 'p' ? $('b-player-lane') : $('b-enemy-lane');
    const units = state.sides[side].board;
    const existing = new Map([...lane.children].map((el) => [Number(el.dataset.uid), el]));
    const order = [];
    for (const u of units) {
      let el = existing.get(u.uid);
      if (el) updateUnit(el, u);
      else { el = renderUnit(u); animateOnce(el, 'enter'); }
      el.classList.toggle('can-attack', side === 'p' && state.active === 'p' && state.phase === 'play' && attackTargets(state, 'p', u.uid).length > 0);
      order.push(el);
      existing.delete(u.uid);
    }
    for (const [uid, el] of existing) if (keep.has(uid)) order.push(el);
    syncChildren(lane, order);
    lane.dataset.count = String(order.length);
  }

  function renderHand() {
    const hand = $('b-hand');
    const s = state.sides.p;
    const existing = new Map([...hand.children].map((el) => [Number(el.dataset.uid), el]));
    const order = s.hand.map((c) => {
      const cost = costOf(state, 'p', c.id);
      let el = existing.get(c.uid);
      if (!el || el.querySelector('.c-cost').textContent !== String(cost)) {
        const fresh = renderCard(c.id, { cost, uid: c.uid });
        if (!el) animateOnce(fresh, 'drawn');
        el = fresh;
      }
      el.classList.toggle('is-playable', state.phase === 'play' && state.active === 'p' && canPlay(state, 'p', c.uid));
      el.classList.toggle('selected', mode.type === 'card' && mode.uid === c.uid);
      return el;
    });
    syncChildren(hand, order);
    hand.style.setProperty('--n', String(order.length));
  }

  function renderEnemyHand() {
    const n = state.sides.o.hand.length;
    const box = $('b-enemy-hand');
    if (box.childElementCount !== n) box.replaceChildren(...Array.from({ length: n }, renderBack));
    box.style.setProperty('--n', String(n));
  }

  function renderField() {
    const slot = $('b-field');
    const f = state.field;
    if (!f) { if (slot.dataset.id) { slot.replaceChildren(h('span', { class: 'field-empty' }, 'No field')); slot.dataset.id = ''; } return; }
    if (slot.dataset.id !== f.id) {
      slot.dataset.id = f.id;
      slot.replaceChildren(renderCard(f.id, { small: true }), h('span', { class: `field-owner side-${f.owner}` }, f.owner === 'p' ? 'Yours' : 'Theirs'));
    }
  }

  function renderLog() {
    const box = $('b-log');
    const items = state.log.slice(-40);
    box.replaceChildren(...items.map((l) => h('li', null, h('span', { class: 'log-turn' }, String(l.turn)), l.text)));
    box.scrollTop = box.scrollHeight;
  }

  function renderControls() {
    const myTurn = state.phase === 'play' && state.active === 'p';
    const endBtn = $('b-end');
    endBtn.disabled = !myTurn || busy;
    const actionsLeft = myTurn && (state.sides.p.hand.some((c) => canPlay(state, 'p', c.uid)) || state.sides.p.board.some((u) => attackTargets(state, 'p', u.uid).length) || canUsePower(state, 'p'));
    endBtn.classList.toggle('is-ready', myTurn && !actionsLeft);
    setText(endBtn, myTurn ? (actionsLeft ? 'End turn' : 'End turn ✓') : state.phase === 'over' ? 'Match over' : "Environment's turn");
    const pw = $('b-power');
    const p = COMMANDERS[cfg.commander].power;
    setText($('b-power-name'), p.name);
    setText($('b-power-text'), `${p.cost} Budget: ${p.text}`);
    pw.disabled = !myTurn || busy || !canUsePower(state, 'p');
    pw.classList.toggle('selected', mode.type === 'power');
    pw.classList.toggle('used', state.sides.p.powerUsed);
    const ep = COMMANDERS[BOSSES[cfg.bossKey].commander];
    setText($('b-enemy-power'), `${ep.power.name} · ${ep.passive ? ep.passive.text : ''}`);
    root.classList.toggle('my-turn', myTurn);
    root.classList.toggle('their-turn', state.active === 'o' && state.phase === 'play');
  }

  /** Mark valid targets for the current selection. */
  function applyHighlights() {
    root.querySelectorAll('.is-target').forEach((el) => el.classList.remove('is-target'));
    root.querySelectorAll('.unit.selected').forEach((el) => el.classList.remove('selected'));
    root.classList.toggle('targeting', mode.type !== 'idle');
    for (const t of currentTargets()) targetEl(t)?.classList.add('is-target');
    if (mode.type === 'attack') unitEl(mode.uid)?.classList.add('selected');
    const hint = { card: 'Choose a target — Esc or right-click to cancel', attack: 'Choose what to attack', power: 'Choose a target for your Commander power' }[mode.type] ?? '';
    setText($('b-hint'), hint);
  }

  function currentTargets() {
    if (!state || state.phase !== 'play') return [];
    if (mode.type === 'card') {
      const inst = state.sides.p.hand.find((c) => c.uid === mode.uid);
      if (!inst) return [];
      return validTargets(state, 'p', targetSpecFor(inst.id), { maxIntegrity: card(inst.id).targetMaxIntegrity ?? null });
    }
    if (mode.type === 'attack') return attackTargets(state, 'p', mode.uid);
    if (mode.type === 'power') return validTargets(state, 'p', COMMANDERS[cfg.commander].power.target);
    return [];
  }

  const unitEl = (uid) => root.querySelector(`.unit[data-uid="${uid}"]`);
  const wellEl = (side) => $(side === 'p' ? 'b-player-portrait' : 'b-enemy-portrait');
  const targetEl = (t) => (t.kind === 'well' ? wellEl(t.side) : unitEl(t.uid));

  // ---------------------------------------------------------------- effects

  function floater(el, text, kind) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    const f = h('span', { class: `floater ${kind}`, css: { left: `${r.left + r.width / 2}px`, top: `${r.top + r.height / 2}px` } }, text);
    $('b-fx').append(f);
    setTimeout(() => f.remove(), 1200);
  }

  function flash(el, cls, ms = 450) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), ms);
  }

  function banner(text, cls = '') {
    const b = $('b-banner');
    b.className = `banner show ${cls}`;
    setText(b, text);
    setTimeout(() => b.classList.remove('show'), D(1100));
  }

  let bubbleTimer = 0;
  function say(text) {
    const b = $('b-bubble');
    setText(b, text);
    b.classList.add('show');
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(hideBubble, 3200);
  }
  function hideBubble() { $('b-bubble')?.classList.remove('show'); }

  async function revealEnemyCard(id) {
    const box = $('b-reveal');
    box.replaceChildren(renderCard(id, { focusable: false }));
    box.classList.add('show');
    await wait(D(1000));
    box.classList.remove('show');
    await wait(D(150));
  }

  async function lunge(attacker, target) {
    if (!attacker || !target || reduced()) return;
    const a = attacker.getBoundingClientRect();
    const t = target.getBoundingClientRect();
    attacker.style.setProperty('--dx', `${(t.left + t.width / 2 - (a.left + a.width / 2)) * 0.8}px`);
    attacker.style.setProperty('--dy', `${(t.top + t.height / 2 - (a.top + a.height / 2)) * 0.8}px`);
    flash(attacker, 'lunge', D(420));
    await wait(D(230));
  }

  const HANDLERS = {
    async turn(e) {
      renderAll();
      if (e.side === 'p') { sfx.turn(); banner('Your turn'); } else { sfx.enemyTurn(); banner("Environment's turn", 'enemy'); }
      await wait(D(500));
    },
    async draw(e) { if (e.side === 'p') { sfx.draw(); renderHand(); await wait(D(140)); } else renderEnemyHand(); },
    async play(e) {
      const c = card(e.id);
      if (e.side === 'o') {
        sfx.draw();
        renderEnemyHand();
        await revealEnemyCard(e.id);
        if (['legendary', 'brilliant'].includes(c.rarity)) say(TAUNTS[cfg.bossKey].big);
      }
      c.type === 'unit' ? sfx.play() : sfx.spell();
      if (c.rarity === 'brilliant') { root.classList.add('brilliant-flash'); setTimeout(() => root.classList.remove('brilliant-flash'), 1400); sfx.reveal('brilliant'); }
      renderHand();
      renderHud(e.side);
    },
    async summon() { renderLane('p'); renderLane('o'); await wait(D(260)); },
    async attack(e) {
      sfx.attack();
      await lunge(unitEl(e.uid), targetEl(e.target));
    },
    async damage(e) {
      const el = targetEl(e.target);
      floater(el, `−${e.amount}`, 'dmg');
      flash(el, 'hit');
      if (e.target.kind === 'well') {
        sfx.wellHit();
        renderHud(e.target.side);
        if (e.amount >= 4 && !reduced()) flash(root, 'shake', 400);
        if (e.target.side === 'o' && state.sides.o.hp > 0 && state.sides.o.hp <= 8 && !root.dataset.lowSaid) { root.dataset.lowSaid = '1'; say(TAUNTS[cfg.bossKey].low); }
      } else sfx.hit();
      const f = state && e.target.kind === 'unit' ? state.sides.p.board.concat(state.sides.o.board).find((u) => u.uid === e.target.uid) : null;
      if (f && el) updateUnit(el, f);
      await wait(D(220));
    },
    async heal(e) { const el = targetEl(e.target); floater(el, `+${e.amount}`, 'heal'); flash(el, 'healed', 600); sfx.heal(); renderHud('p'); renderHud('o'); await wait(D(160)); },
    async shield(e) { flash(unitEl(e.uid), 'pop', 500); sfx.shield(); await wait(D(200)); },
    async death(e) {
      const el = unitEl(e.uid);
      sfx.death();
      if (el) { el.classList.add('dying'); await wait(D(480)); el.remove(); }
      keep.delete(e.uid);
    },
    async buff(e) { flash(unitEl(e.uid), 'buffed', 600); sfx.buff(); await wait(D(120)); },
    async grant(e) { flash(unitEl(e.uid), 'buffed', 600); sfx.shield(); await wait(D(120)); },
    async status(e) { flash(unitEl(e.uid), e.status === 'stuck' ? 'stunned' : 'soured', 700); sfx.stun(); await wait(D(150)); },
    async field(e) { renderField(); sfx.spell(); ui.toast(`${card(e.id).name} is now in play.`); await wait(D(300)); },
    async skip(e) { ui.toast(e.side === 'p' ? 'Wait on Weather: your units cannot attack next turn.' : 'Wait on Weather: enemy units cannot attack next turn.'); sfx.stun(); },
    async junk(e) { ui.toast(e.side === 'p' ? `Pit Gain! ${e.n} Cuttings added to your hand.` : `Pit Gain! ${e.n} Cuttings added to their hand.`); sfx.alarm(); renderHand(); renderEnemyHand(); await wait(D(300)); },
    async tax(e) { ui.toast(e.side === 'p' ? `Your cards cost +${e.n} next turn.` : `Their cards cost +${e.n} next turn.`); },
    async discard(e) { ui.toast(e.side === 'p' ? `Lost circulation! You discarded ${card(e.id).name}.` : `They discarded ${card(e.id).name}.`); sfx.death(); renderHand(); renderEnemyHand(); },
    async burn(e) { ui.toast(`Hand full — ${card(e.id).name} was burned.`); },
    async fatigue(e) { ui.toast(`${e.side === 'p' ? 'You are' : 'They are'} out of cards — ${e.amount} fatigue damage.`); sfx.alarm(); },
    async passive(e) { banner(e.name, 'enemy'); sfx.alarm(); await wait(D(500)); },
    async power(e) { sfx.power(); if (e.side === 'o') { banner(e.name, 'enemy'); await wait(D(400)); } },
    async bounce(e) { const el = unitEl(e.uid); if (el) { el.classList.add('bounced'); await wait(D(350)); } renderAll(); },
    async swap(e) { flash(unitEl(e.uid), 'swapped', 600); sfx.spell(); await wait(D(200)); },
    async cleanse() { sfx.heal(); },
    async destroy(e) { flash(unitEl(e.uid), 'hit'); },
    async gameover() {},
  };

  async function playEvents(events) {
    for (const e of events) if (e.type === 'death') keep.add(e.uid);
    for (const e of events) {
      if (!alive) return;
      await HANDLERS[e.type]?.(e);
    }
    keep.clear();
    renderAll();
  }

  // ---------------------------------------------------------------- actions

  async function act(fn) {
    if (busy || !alive) return;
    busy = true;
    const ok = fn();
    mode = { type: 'idle' };
    if (!ok) { sfx.error(); busy = false; renderAll(); return; }
    await playEvents(drainEvents(state));
    busy = false;
    if (state.phase === 'over') return finish();
    if (state.active === 'o') return runAI();
    renderAll();
    coach();
  }

  async function runAI() {
    busy = true;
    renderAll();
    while (alive && state.phase === 'play' && state.active === 'o') {
      await wait(D(520));
      if (!alive) return;
      const a = nextAction(state, 'o', cfg.difficulty, aiSalt++);
      if (!applyAction(state, 'o', a)) applyAction(state, 'o', { type: 'end' });
      await playEvents(drainEvents(state));
    }
    busy = false;
    if (!alive) return;
    if (state.phase === 'over') return finish();
    renderAll();
    coach();
  }

  function onCardClick(uid) {
    if (busy || state.phase !== 'play' || state.active !== 'p') { sfx.error(); return; }
    if (mode.type === 'card' && mode.uid === uid) { mode = { type: 'idle' }; renderAll(); return; }
    if (!canPlay(state, 'p', uid)) {
      sfx.error();
      flash($('b-hand').querySelector(`[data-uid="${uid}"]`), 'nope', 400);
      const inst = state.sides.p.hand.find((c) => c.uid === uid);
      if (inst && costOf(state, 'p', inst.id) > state.sides.p.budget) ui.toast('Not enough Budget.');
      else if (inst && card(inst.id).type === 'unit') ui.toast('Your board is full (6 units).');
      else ui.toast('No valid target for that card.');
      return;
    }
    const inst = state.sides.p.hand.find((c) => c.uid === uid);
    const spec = targetSpecFor(inst.id);
    const targets = spec ? validTargets(state, 'p', spec, { maxIntegrity: card(inst.id).targetMaxIntegrity ?? null }) : [];
    if (!spec || (targets.length === 0 && card(inst.id).type === 'unit')) return act(() => playCard(state, 'p', uid, null));
    sfx.click();
    mode = { type: 'card', uid };
    renderAll();
  }

  function onTarget(t) {
    if (busy) return;
    const valid = currentTargets().some((x) => x.kind === t.kind && (t.kind === 'well' ? x.side === t.side : x.uid === t.uid));
    if (!valid) return false;
    if (mode.type === 'card') { const uid = mode.uid; act(() => playCard(state, 'p', uid, t)); return true; }
    if (mode.type === 'attack') { const uid = mode.uid; act(() => attack(state, 'p', uid, t)); return true; }
    if (mode.type === 'power') { act(() => usePower(state, 'p', t)); return true; }
    return false;
  }

  function onUnitClick(uid, side) {
    if (busy || !state || state.phase !== 'play') return;
    if (mode.type !== 'idle' && onTarget({ kind: 'unit', uid, side })) return;
    if (side === 'p' && state.active === 'p' && attackTargets(state, 'p', uid).length) {
      sfx.click();
      mode = mode.type === 'attack' && mode.uid === uid ? { type: 'idle' } : { type: 'attack', uid };
      renderAll();
      return;
    }
    if (side === 'p' && state.active === 'p') {
      const u = state.sides.p.board.find((x) => x.uid === uid);
      ui.toast(u?.stuck ? 'Stuck pipe — this unit cannot attack this turn.' : u?.power === 0 ? 'This unit has no Power.' : 'This unit is not ready yet (no Spud).');
    }
  }

  function onWellClick(side) {
    if (busy || !state || state.phase !== 'play') return;
    if (mode.type !== 'idle') onTarget({ kind: 'well', side });
  }

  function onPower() {
    if (busy || !canUsePower(state, 'p')) { sfx.error(); return; }
    const p = COMMANDERS[cfg.commander].power;
    if (!p.target || p.target === 'none') return act(() => usePower(state, 'p', null));
    mode = mode.type === 'power' ? { type: 'idle' } : { type: 'power' };
    sfx.click();
    renderAll();
  }

  function onEnd() {
    if (busy || state.active !== 'p' || state.phase !== 'play') return;
    sfx.click();
    act(() => endTurn(state, 'p'));
  }

  function cancel() {
    if (mode.type !== 'idle') { mode = { type: 'idle' }; renderAll(); return true; }
    return false;
  }

  // ---------------------------------------------------------------- input wiring (once)

  root.addEventListener('click', (e) => {
    if (!state || !alive) return;
    const handCard = e.target.closest('#b-hand .card');
    if (handCard) return onCardClick(Number(handCard.dataset.uid));
    const unit = e.target.closest('.unit');
    if (unit) return onUnitClick(Number(unit.dataset.uid), unit.closest('#b-player-lane') ? 'p' : 'o');
    const portrait = e.target.closest('.portrait');
    if (portrait) return onWellClick(portrait.id === 'b-player-portrait' ? 'p' : 'o');
    if (e.target.closest('#b-power')) return onPower();
    if (e.target.closest('#b-end')) return onEnd();
    if (e.target.closest('#b-menu')) return openPause();
    if (e.target.closest('#b-log-toggle, #b-log-close')) { root.classList.toggle('log-open'); return; }
    if (e.target.closest('.board-bg, .lane')) cancel();
  });

  // Right-click or long-press: zoom any card or unit
  root.addEventListener('contextmenu', (e) => {
    const el = e.target.closest('.card[data-id], .unit[data-id]');
    e.preventDefault();
    if (cancel()) return;
    if (el) ui.zoom(el.dataset.id);
  });
  let pressTimer = 0;
  root.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.card[data-id], .unit[data-id]');
    if (!el || e.pointerType === 'mouse') return;
    pressTimer = setTimeout(() => { pressTimer = -1; ui.zoom(el.dataset.id); }, 480);
  });
  root.addEventListener('pointerup', (e) => { if (pressTimer === -1) e.preventDefault(); clearTimeout(pressTimer); });
  root.addEventListener('pointercancel', () => clearTimeout(pressTimer));

  root.addEventListener('keydown', (e) => {
    if (!state || !alive) return;
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.card, .unit, .portrait')) { e.preventDefault(); e.target.click(); }
    if (e.key === 'z' && e.target.dataset?.id) ui.zoom(e.target.dataset.id);
  });
  document.addEventListener('keydown', (e) => {
    if (!alive || !root.classList.contains('active') || ui.modalOpen()) return;
    if (e.key === 'Escape') {
      // preventDefault stops the same keypress from instantly closing the pause dialog it opens
      e.preventDefault();
      if (root.classList.contains('log-open')) root.classList.remove('log-open');
      else if (!cancel()) openPause();
    }
    if ((e.key === 'e' || e.key === 'E') && !e.target.matches('input, textarea')) onEnd();
  });

  // ---------------------------------------------------------------- mulligan

  function showMulligan() {
    const replace = new Set();
    const hand = state.sides.p.hand;
    const first = state.first === 'p';
    const grid = h('div', { class: 'mulligan-hand' }, hand.map((c) => {
      const el = renderCard(c.id, { uid: c.uid });
      el.addEventListener('click', () => {
        if (c.id === 'spare-budget') return;
        replace.has(c.uid) ? replace.delete(c.uid) : replace.add(c.uid);
        el.classList.toggle('replace', replace.has(c.uid));
        sfx.click();
      });
      return el;
    }));
    ui.modal({
      title: first ? 'You go first' : 'You go second',
      cls: 'modal-wide modal-mulligan',
      body: [
        h('p', null, first ? 'You start with 3 cards.' : 'You start with 4 cards and a Spare Budget for going second.', ' Click any cards you want to swap for new ones.'),
        grid,
      ],
      actions: [{ label: 'Keep hand & start', primary: true, onClick: async () => {
        ui.closeModal();
        mulligan(state, 'p', [...replace]);
        say(TAUNTS[cfg.bossKey].start);
        await playEvents(drainEvents(state));
        if (state.active === 'o') runAI();
        else coach();
      } }],
      dismissable: false,
    });
  }

  // ---------------------------------------------------------------- tutorial coach

  function coach() {
    const p = getProfile();
    if (p.seen.tutorial || state.phase !== 'play' || state.active !== 'p') return;
    const s = state.sides.p;
    let tip = null;
    if (s.turns === 1) tip = 'Click a glowing card to play it. The number in the top-left is its Budget cost. You gain 1 Budget each turn (max 10).';
    else if (s.board.some((u) => attackTargets(state, 'p', u.uid).length)) tip = 'Your units are ready. Click one of your units, then click an enemy unit or the enemy Well to attack. Right-click (or press and hold) any card to read it.';
    else if (canUsePower(state, 'p')) tip = 'Your Commander power (bottom right) costs 2 Budget and can be used once per turn.';
    if (s.turns >= 4) { p.seen.tutorial = true; ui.saveProfile(); }
    if (tip) ui.coach(tip, () => { p.seen.tutorial = true; ui.saveProfile(); });
  }

  // ---------------------------------------------------------------- pause & leave

  function openPause() {
    if (!state || state.phase === 'over') return;
    sfx.click();
    ui.modal({
      title: 'Paused',
      body: [
        h('p', null, `${BOSSES[cfg.bossKey].name} · ${DIFFICULTIES[cfg.difficulty].label} · Turn ${state.turn}`),
        h('p', { class: 'hint' }, 'Shortcuts: E ends your turn · Esc cancels a selection · right-click or press-and-hold a card to read it.'),
      ],
      actions: [
        { label: 'How to play', onClick: () => { ui.closeModal(); ui.showRulesOverlay(); } },
        { label: 'Leave match', danger: true, onClick: confirmLeave },
        { label: 'Resume', primary: true, onClick: ui.closeModal },
      ],
    });
  }

  function confirmLeave() {
    ui.modal({
      title: 'Leave this match?',
      body: h('p', null, 'Leaving counts as conceding: it records a loss and returns you to the main menu.'),
      actions: [
        { label: 'Stay', onClick: ui.closeModal },
        { label: 'Concede & leave', danger: true, primary: true, onClick: () => {
          ui.closeModal();
          concede(state, 'p');
          drainEvents(state);
          report(false, 'concede');
          stop();
          onLeave();
        } },
      ],
    });
  }

  // ---------------------------------------------------------------- end of match & rematch consent

  function report(won, reason) {
    return onResult({
      won,
      reason,
      boss: cfg.bossKey,
      difficulty: cfg.difficulty,
      deckKey: cfg.deckKey,
      flawless: won && state.sides.p.hp === state.sides.p.maxHp,
      turns: state.turn,
      stats: { ...state.sides.p.stats },
    });
  }

  async function finish() {
    busy = true;
    renderAll();
    const won = state.winner === 'p';
    const draw = state.draw;
    await wait(D(500));
    if (won) { sfx.victory(); root.classList.add('won'); } else { sfx.defeat(); root.classList.add('lost'); }
    say(won ? TAUNTS[cfg.bossKey].low : 'Back to the site survey, engineer.');
    const rewards = await report(won, draw ? 'draw' : 'normal');
    setTimeout(() => root.classList.remove('won', 'lost'), 2500);
    showEndScreen(won, draw, rewards);
  }

  function showEndScreen(won, draw, rewards) {
    const consent = { you: false, them: false };
    let started = false;
    const youRow = h('li', { class: 'consent-row' }, h('span', { class: 'consent-who' }, 'You'), h('span', { class: 'consent-state' }, 'Deciding…'));
    const themRow = h('li', { class: 'consent-row' }, h('span', { class: 'consent-who' }, BOSSES[cfg.bossKey].name), h('span', { class: 'consent-state' }, 'Deciding…'));
    const line = h('p', { class: 'consent-line' });
    let rematchBtn;

    const update = () => {
      youRow.classList.toggle('ready', consent.you);
      themRow.classList.toggle('ready', consent.them);
      setText(youRow.lastChild, consent.you ? 'Ready ✓' : 'Deciding…');
      setText(themRow.lastChild, consent.them ? 'Ready ✓' : 'Deciding…');
      if (rematchBtn) {
        setText(rematchBtn, consent.you ? 'Waiting for opponent…' : consent.them ? 'Accept rematch' : 'Request rematch');
        rematchBtn.disabled = consent.you;
      }
      if (consent.you && consent.them && !started) {
        started = true;
        sfx.consent();
        countdown();
      }
    };

    const countdown = async () => {
      for (const n of ['3', '2', '1']) { setText(line, `Both players agreed. Rematch in ${n}…`); await wait(600); if (!alive) return; }
      ui.closeModal();
      start(cfg);
    };

    // The opponent decides on its own a little later — it may ask first.
    const reply = rematchReply(state.winner, 'o', state.seed);
    const themTimer = setTimeout(() => {
      if (!alive || !reply.accept) return;
      consent.them = true;
      setText(line, `“${reply.line}”`);
      sfx.consent();
      update();
    }, 1800 + Math.random() * 1400);

    const title = draw ? 'Draw' : won ? 'Victory' : 'Defeat';
    const s = state.sides.p.stats;
    ui.modal({
      title,
      cls: `modal-end ${won ? 'is-win' : 'is-loss'}`,
      body: [
        h('p', { class: 'end-sub' }, won ? `You brought ${BOSSES[cfg.bossKey].name} under control.` : draw ? 'Both Wells failed at once.' : 'Your Well integrity failed.'),
        h('dl', { class: 'end-stats' },
          h('dt', null, 'Turns'), h('dd', null, String(state.turn)),
          h('dt', null, 'Damage dealt'), h('dd', null, String(s.damage)),
          h('dt', null, 'Cards played'), h('dd', null, String(s.played)),
          h('dt', null, 'Units destroyed'), h('dd', null, String(s.destroyed)),
          h('dt', null, 'Well integrity left'), h('dd', null, `${Math.max(0, state.sides.p.hp)}/${state.sides.p.maxHp}`),
        ),
        rewards?.packs ? h('p', { class: 'end-reward' }, `+${rewards.packs} card pack${rewards.packs > 1 ? 's' : ''}`) : null,
        rewards?.cloud ? h('p', { class: 'hint' }, rewards.cloud) : null,
        h('h3', { class: 'consent-title' }, 'Play again?'),
        h('p', { class: 'hint' }, 'A rematch starts only when both players agree.'),
        h('ul', { class: 'consent' }, youRow, themRow),
        line,
      ],
      actions: [
        { label: 'Leave to menu', onClick: () => { clearTimeout(themTimer); ui.closeModal(); stop(); onLeave(); } },
        { label: 'Change deck', onClick: () => { clearTimeout(themTimer); ui.closeModal(); stop(); onLeave('play'); } },
        { label: 'Request rematch', primary: true, ref: (b) => { rematchBtn = b; }, onClick: () => { consent.you = true; sfx.click(); setText(line, 'Rematch requested. Waiting for the opponent…'); update(); } },
      ],
      dismissable: false,
    });
    update();
  }

  return { start, stop, isActive: () => alive };
}

export function deckFor(profile, deckKey) {
  if (deckKey === 'custom') return { cards: profile.customDeck, commander: profile.customCommander, name: 'Custom deck' };
  const d = STARTER_DECKS[deckKey];
  return { cards: d.cards, commander: d.commander, name: d.name };
}
