// App shell: hash router, shared UI (modal, toast, coach, zoom), and every
// non-battle screen (menu, match setup, collection, deck builder, packs,
// records, leaderboard, rules, settings).

import { CARDS, DISCIPLINES, KEYWORDS, RARITIES, STARTER_DECKS, BOSSES, COMMANDERS, card } from './engine.js';
import { DIFFICULTIES } from './ai.js';
import {
  defaultProfile, validateProfile, deckProblems, openPack, recordResult, ACHIEVEMENTS, COLLECTIBLE, MAX_COPIES, cleanName,
} from './profile.js';
import { createBattle, deckFor } from './battle.js';
import { renderCard, renderZoom } from './cards-ui.js';
import { audio, sfx } from './audio.js';
import { cloudConfigured, submitResult, fetchLeaderboard } from './cloud.js';
import { h, setText, wait } from './dom.js';

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'wellbore-wars.profile.v1';
const SEED_KEY = 'wellbore-wars.seed.v1';
const rarityLabel = Object.fromEntries(RARITIES.map((r) => [r.id, r.label]));
const PLAYER_COMMANDERS = ['drilling-engineer', 'reservoir-engineer', 'production-engineer'];

// ------------------------------------------------------------------ profile persistence

function loadProfile() {
  try { return validateProfile(localStorage.getItem(STORAGE_KEY)); } catch { return defaultProfile(); }
}
function saveProfile() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(profile)); } catch { /* storage blocked: play without saving */ }
  refreshBadges();
}
function profileSeed() {
  try {
    let s = localStorage.getItem(SEED_KEY);
    if (!s || !/^[a-z0-9]{6,24}$/.test(s)) {
      const b = new Uint32Array(2);
      crypto.getRandomValues(b);
      s = b[0].toString(36) + b[1].toString(36);
      localStorage.setItem(SEED_KEY, s);
    }
    return s;
  } catch { return 'local'; }
}

let profile = loadProfile();
const seed = profileSeed();
audio.configure(profile.settings);

// ------------------------------------------------------------------ shared UI

const dialog = $('modal');
let modalOnClose = null;

const ui = {
  modal({ title, body, actions = [], cls = '', dismissable = true }) {
    dialog.className = `modal ${cls}`;
    dialog.dataset.dismissable = dismissable ? '1' : '';
    const btns = actions.map((a) => {
      const b = h('button', { type: 'button', class: `btn${a.primary ? ' btn-primary' : ''}${a.danger ? ' btn-danger' : ''}` }, a.label);
      b.addEventListener('click', () => { sfx.click(); a.onClick(); });
      a.ref?.(b);
      return b;
    });
    dialog.replaceChildren(
      h('h2', { id: 'modal-title' }, title),
      h('div', { class: 'modal-body' }, body),
      btns.length ? h('div', { class: 'modal-actions' }, btns) : null,
    );
    if (!dialog.open) dialog.showModal();
    (dialog.querySelector('.btn-primary') ?? dialog.querySelector('button'))?.focus();
  },
  closeModal() {
    if (dialog.open) dialog.close();
    modalOnClose?.();
    modalOnClose = null;
  },
  modalOpen: () => dialog.open,
  toast(msg) {
    const t = $('toast');
    setText(t, msg);
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), 2600);
  },
  zoom(id) {
    if (!CARDS[id]) return;
    sfx.click();
    ui.modal({ title: card(id).name, cls: 'modal-zoom', body: renderZoom(id), actions: [{ label: 'Close', primary: true, onClick: ui.closeModal }] });
  },
  coach(text, onDone) {
    const c = $('coach');
    c.replaceChildren(
      h('span', { class: 'coach-tag' }, 'Tip'),
      h('p', null, text),
      h('div', { class: 'coach-actions' },
        h('button', { type: 'button', class: 'btn btn-small btn-primary', on: { click: () => c.classList.remove('show') } }, 'Got it'),
        h('button', { type: 'button', class: 'btn btn-small', on: { click: () => { c.classList.remove('show'); onDone(); } } }, 'Turn off tips')),
    );
    c.classList.add('show');
  },
  saveProfile,
  showRulesOverlay() {
    const box = $('screen-rules').querySelector('.rules').cloneNode(true);
    box.querySelector('h1')?.remove();
    ui.modal({ title: 'How to play', cls: 'modal-wide modal-rules', body: box, actions: [{ label: 'Back to match', primary: true, onClick: ui.closeModal }] });
  },
};

dialog.addEventListener('cancel', (e) => { if (!dialog.dataset.dismissable) e.preventDefault(); else { modalOnClose?.(); modalOnClose = null; } });
dialog.addEventListener('click', (e) => { if (e.target === dialog && dialog.dataset.dismissable) ui.closeModal(); });

function announceAchievements(ids) {
  ids.forEach((id, i) => setTimeout(() => {
    const a = ACHIEVEMENTS.find((x) => x.id === id);
    if (!a) return;
    const box = $('achv');
    box.replaceChildren(h('span', { class: 'achv-icon', 'aria-hidden': 'true' }), h('div', null, h('strong', null, `Achievement: ${a.label}`), h('span', null, a.desc)));
    box.classList.add('show');
    sfx.achievement();
    setTimeout(() => box.classList.remove('show'), 3200);
  }, i * 3400));
}

function refreshBadges() {
  setText($('nav-packs'), String(profile.packs));
  setText($('menu-packs'), String(profile.packs));
  $('nav-packs').classList.toggle('hot', profile.packs > 0);
  setText($('menu-profile'), `${profile.name} · ${profile.stats.wins} wins · ${profile.stats.losses} losses${profile.stats.streak > 1 ? ` · ${profile.stats.streak} win streak` : ''}`);
  const on = profile.settings.sfxOn || profile.settings.musicOn;
  $('sound-toggle').setAttribute('aria-pressed', String(on));
  $('sound-toggle').classList.toggle('off', !on);
}

// ------------------------------------------------------------------ router

const SCREENS = ['menu', 'play', 'battle', 'collection', 'deck', 'packs', 'records', 'leaderboard', 'rules', 'settings'];
const ENTER = {};

function route() {
  let name = location.hash.replace(/^#\//, '') || 'menu';
  if (!SCREENS.includes(name)) name = 'menu';
  if (name === 'battle' && !battle.isActive()) name = 'play';
  if (name !== 'battle' && battle.isActive()) {
    // Navigating away mid-match goes through the Leave confirmation instead.
    history.replaceState(null, '', '#/battle');
    document.getElementById('b-menu').click();
    return;
  }
  for (const s of SCREENS) {
    const el = $(`screen-${s}`);
    el.classList.toggle('active', s === name);
    el.hidden = s !== name;
  }
  document.body.dataset.screen = name;
  document.querySelectorAll('[data-nav]').forEach((a) => a.setAttribute('aria-current', a.dataset.nav === name ? 'page' : 'false'));
  ENTER[name]?.();
  if (name !== 'battle') $(`screen-${name}`).querySelector('h1')?.focus?.({ preventScroll: true });
  window.scrollTo(0, 0);
}
const go = (name) => { if (location.hash === `#/${name}`) route(); else location.hash = `#/${name}`; };
window.addEventListener('hashchange', route);

// ------------------------------------------------------------------ battle

const battle = createBattle({
  ui,
  getProfile: () => profile,
  onResult: async (r) => {
    const rewards = recordResult(profile, r);
    saveProfile();
    announceAchievements(rewards.unlocked);
    if (profile.cloud.optIn && cloudConfigured() && r.reason !== 'draw') {
      const res = await submitResult(profile.name, r.won);
      rewards.cloud = res.message;
    }
    return rewards;
  },
  onLeave: (to = 'menu') => go(to),
});

// ------------------------------------------------------------------ match setup

let setup = { deck: profile.lastDeck, boss: profile.lastBoss, difficulty: profile.difficulty };

function choice({ key, selected, title, sub, extra, cls, onPick }) {
  const b = h('button', { type: 'button', role: 'radio', class: `choice ${cls}`, 'aria-checked': String(selected), dataset: { key } },
    h('span', { class: 'choice-art', 'aria-hidden': 'true' }),
    h('strong', null, title),
    h('span', { class: 'choice-sub' }, sub),
    extra ? h('span', { class: 'choice-extra' }, extra) : null);
  b.addEventListener('click', () => { sfx.click(); onPick(key); });
  return b;
}

ENTER.play = function renderSetup() {
  const decks = [...Object.entries(STARTER_DECKS).map(([k, d]) => ({ k, name: d.name, blurb: d.blurb, cmd: d.commander, discs: d.discs })),
    { k: 'custom', name: 'Custom deck', blurb: 'The deck you built in the Deck builder.', cmd: profile.customCommander, discs: [...new Set(profile.customDeck.map((id) => card(id).disc))].slice(0, 3) }];
  $('play-decks').replaceChildren(...decks.map((d) => choice({
    key: d.k, selected: setup.deck === d.k, title: d.name, sub: d.blurb, cls: `deck-choice cmd-${d.cmd} ${d.discs.map((x) => `has-${x}`).join(' ')}`,
    extra: `${COMMANDERS[d.cmd].name} · ${COMMANDERS[d.cmd].power.name}`,
    onPick: (k) => { setup.deck = k; renderSetup(); },
  })));
  $('play-bosses').replaceChildren(...Object.entries(BOSSES).map(([k, b]) => {
    const rec = profile.stats.byBoss[k];
    return choice({
      key: k, selected: setup.boss === k, title: b.name, sub: b.blurb, cls: `boss-choice boss-${k}`,
      extra: `${COMMANDERS[b.commander].passive.text}${rec ? ` · Record ${rec.wins}–${rec.losses}` : ''}`,
      onPick: (key) => { setup.boss = key; renderSetup(); },
    });
  }));
  $('play-difficulty').replaceChildren(...Object.entries(DIFFICULTIES).map(([k, d]) => {
    const b = h('button', { type: 'button', role: 'radio', class: 'seg-btn', 'aria-checked': String(setup.difficulty === k) }, d.label);
    b.addEventListener('click', () => { sfx.click(); setup.difficulty = k; renderSetup(); });
    return b;
  }));
  const d = DIFFICULTIES[setup.difficulty];
  setText($('play-difficulty-hint'), `Boss Well: ${d.bossHp}. Reward: ${d.packs} pack${d.packs > 1 ? 's' : ''} per win. ${setup.difficulty === 'rookie' ? 'The Environment makes plenty of mistakes.' : setup.difficulty === 'senior' ? 'The Environment plays its best line every time.' : 'A fair fight.'}`);
  const problems = setup.deck === 'custom' ? deckProblems(profile.customDeck, profile.collection) : [];
  setText($('play-warn'), problems.length ? `Your custom deck isn't legal yet: ${problems[0]}` : '');
  $('play-start').disabled = problems.length > 0;
};

$('play-start').addEventListener('click', () => {
  const deck = deckFor(profile, setup.deck);
  profile.lastDeck = setup.deck;
  profile.lastBoss = setup.boss;
  profile.difficulty = setup.difficulty;
  saveProfile();
  sfx.play();
  history.pushState(null, '', '#/battle');
  for (const s of SCREENS) { $(`screen-${s}`).classList.toggle('active', s === 'battle'); $(`screen-${s}`).hidden = s !== 'battle'; }
  document.body.dataset.screen = 'battle';
  battle.start({ deckKey: setup.deck, deckCards: deck.cards, commander: deck.commander, bossKey: setup.boss, difficulty: setup.difficulty });
});

// ------------------------------------------------------------------ collection

const colFilter = { q: '', disc: null, rarity: null, owned: false };

function chips(container, items, current, onPick) {
  container.replaceChildren(
    h('button', { type: 'button', class: 'chip', 'aria-pressed': String(current == null), on: { click: () => onPick(null) } }, 'All'),
    ...items.map(([k, label]) => h('button', { type: 'button', class: `chip chip-${k}`, 'aria-pressed': String(current === k), on: { click: () => { sfx.click(); onPick(k); } } }, label)),
  );
}

const playerDiscs = Object.entries(DISCIPLINES).filter(([k]) => k !== 'hazard');

ENTER.collection = function renderCollection() {
  chips($('col-discs'), playerDiscs.map(([k, d]) => [k, d.label]), colFilter.disc, (k) => { colFilter.disc = k; renderCollection(); });
  chips($('col-rarities'), RARITIES.map((r) => [r.id, r.label]), colFilter.rarity, (k) => { colFilter.rarity = k; renderCollection(); });
  const q = colFilter.q.toLowerCase();
  const list = COLLECTIBLE.filter((id) => {
    const c = card(id);
    if (colFilter.disc && c.disc !== colFilter.disc) return false;
    if (colFilter.rarity && c.rarity !== colFilter.rarity) return false;
    if (colFilter.owned && !profile.collection[id]) return false;
    if (q && !`${c.name} ${c.text ?? ''} ${(c.kw ?? []).join(' ')}`.toLowerCase().includes(q)) return false;
    return true;
  }).sort(byCostThenName);
  $('col-grid').replaceChildren(...list.map((id) => {
    const n = profile.collection[id] ?? 0;
    const el = renderCard(id, { count: n, dim: n === 0 });
    el.addEventListener('click', () => ui.zoom(id));
    return el;
  }));
  if (!list.length) $('col-grid').replaceChildren(h('p', { class: 'empty' }, 'No cards match these filters.'));
  const owned = COLLECTIBLE.filter((id) => profile.collection[id]).length;
  setText($('col-progress'), `${owned} of ${COLLECTIBLE.length} cards collected`);
};
$('col-search').addEventListener('input', (e) => { colFilter.q = e.target.value; ENTER.collection(); });
$('col-owned').addEventListener('change', (e) => { colFilter.owned = e.target.checked; ENTER.collection(); });

function byCostThenName(a, b) {
  return card(a).cost - card(b).cost || card(a).name.localeCompare(card(b).name);
}

// ------------------------------------------------------------------ deck builder

let draft = null;
const deckFilter = { q: '', disc: null };

ENTER.deck = function renderDeckBuilder() {
  draft ??= { cards: [...profile.customDeck], commander: profile.customCommander };
  chips($('deck-discs'), playerDiscs.map(([k, d]) => [k, d.label]), deckFilter.disc, (k) => { deckFilter.disc = k; renderDeckBuilder(); });
  const sel = $('deck-commander');
  if (!sel.childElementCount) sel.replaceChildren(...PLAYER_COMMANDERS.map((k) => h('option', { value: k }, COMMANDERS[k].name)));
  sel.value = draft.commander;
  setText($('deck-commander-text'), `${COMMANDERS[draft.commander].power.name}: ${COMMANDERS[draft.commander].power.text}`);

  const counts = {};
  draft.cards.forEach((id) => { counts[id] = (counts[id] ?? 0) + 1; });
  const q = deckFilter.q.toLowerCase();
  const pool = COLLECTIBLE.filter((id) => profile.collection[id] > 0)
    .filter((id) => !deckFilter.disc || card(id).disc === deckFilter.disc)
    .filter((id) => !q || card(id).name.toLowerCase().includes(q))
    .sort(byCostThenName);
  $('deck-pool').replaceChildren(...pool.map((id) => {
    const limit = Math.min(MAX_COPIES[card(id).rarity], profile.collection[id]);
    const left = limit - (counts[id] ?? 0);
    const el = renderCard(id, { small: true, count: left, dim: left <= 0 });
    el.addEventListener('click', () => {
      if (left <= 0) { sfx.error(); ui.toast(`No more copies of ${card(id).name} available.`); return; }
      if (draft.cards.length >= 20) { sfx.error(); ui.toast('Your deck already has 20 cards.'); return; }
      draft.cards.push(id); sfx.draw(); renderDeckBuilder();
    });
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); ui.zoom(id); });
    return el;
  }));

  const unique = [...new Set(draft.cards)].sort(byCostThenName);
  $('deck-rows').replaceChildren(...unique.map((id) => {
    const c = card(id);
    return h('li', null, h('button', { type: 'button', class: `deck-row d-${c.disc} r-${c.rarity}`, on: { click: () => { draft.cards.splice(draft.cards.indexOf(id), 1); sfx.click(); renderDeckBuilder(); } } },
      h('span', { class: 'dr-cost' }, String(c.cost)), h('span', { class: 'dr-name' }, c.name), h('span', { class: 'dr-n' }, `×${counts[id]}`)));
  }));
  setText($('deck-count'), String(draft.cards.length));
  const curve = Array(8).fill(0);
  draft.cards.forEach((id) => { curve[Math.min(7, card(id).cost)]++; });
  const max = Math.max(1, ...curve);
  $('deck-curve').replaceChildren(...curve.map((n, i) => h('span', { class: 'bar', css: { '--h': String(n / max) }, title: `${n} card${n === 1 ? '' : 's'} costing ${i}${i === 7 ? '+' : ''}` }, h('b', null, String(n)), h('i', null, i === 7 ? '7+' : String(i)))));
  const problems = deckProblems(draft.cards, profile.collection);
  setText($('deck-problems'), problems.slice(0, 3).join(' '));
  $('deck-save').disabled = problems.length > 0;
};
$('deck-search').addEventListener('input', (e) => { deckFilter.q = e.target.value; ENTER.deck(); });
$('deck-commander').addEventListener('change', (e) => { draft.commander = e.target.value; ENTER.deck(); });
$('deck-template').addEventListener('change', (e) => {
  const d = STARTER_DECKS[e.target.value];
  if (d) { draft = { cards: [...d.cards], commander: d.commander }; ENTER.deck(); }
  e.target.value = '';
});
$('deck-clear').addEventListener('click', () => { draft.cards = []; ENTER.deck(); });
$('deck-save').addEventListener('click', () => {
  if (deckProblems(draft.cards, profile.collection).length) return;
  profile.customDeck = [...draft.cards];
  profile.customCommander = draft.commander;
  profile.lastDeck = 'custom';
  setup.deck = 'custom';
  saveProfile();
  sfx.consent();
  ui.toast('Deck saved. Choose "Custom deck" when you start a match.');
});

// ------------------------------------------------------------------ packs

ENTER.packs = function renderPacks() {
  setText($('pack-count'), `×${profile.packs}`);
  $('pack-open').disabled = profile.packs <= 0;
  $('pack-open').classList.toggle('empty', profile.packs <= 0);
  $('pack-odds').replaceChildren(...RARITIES.map((r) => h('tr', { class: `r-${r.id}` }, h('th', { scope: 'row' }, r.label), h('td', null, `${(r.packOdds * 100).toFixed(r.packOdds < 0.01 ? 1 : 0)}%`))));
};

let opening = false;
$('pack-open').addEventListener('click', async () => {
  if (opening) return;
  if (profile.packs <= 0) { ui.toast('No packs left. Win matches to earn more.'); return; }
  opening = true;
  const result = openPack(profile, seed);
  saveProfile();
  const pack = $('pack-open');
  sfx.packShake();
  pack.classList.add('shaking');
  await wait(750);
  pack.classList.remove('shaking');
  pack.classList.add('burst');
  const box = $('pack-results');
  box.replaceChildren(...result.cards.map((id, i) => {
    const slot = h('button', { type: 'button', class: `reveal-slot r-${card(id).rarity}`, 'aria-label': 'Flip card', css: { '--i': String(i) } },
      h('span', { class: 'slot-back' }),
      h('span', { class: 'slot-front' }, renderCard(id, { focusable: false })),
      result.newIds.includes(id) ? h('span', { class: 'new-tag' }, 'New') : null);
    slot.addEventListener('click', () => {
      if (slot.classList.contains('flipped')) { ui.zoom(id); return; }
      slot.classList.add('flipped');
      sfx.reveal(card(id).rarity);
      if (card(id).rarity === 'brilliant') document.body.classList.add('brilliant-flash'), setTimeout(() => document.body.classList.remove('brilliant-flash'), 1500);
    });
    return slot;
  }));
  box.append(h('button', { type: 'button', class: 'btn btn-small reveal-all', on: { click: () => box.querySelectorAll('.reveal-slot:not(.flipped)').forEach((s, i) => setTimeout(() => s.click(), i * 220)) } }, 'Flip all'));
  setTimeout(() => pack.classList.remove('burst'), 600);
  announceAchievements(result.unlocked);
  ENTER.packs();
  opening = false;
});

// ------------------------------------------------------------------ records

ENTER.records = function renderRecords() {
  const st = profile.stats;
  const games = st.wins + st.losses;
  const stat = (label, value) => h('div', { class: 'stat' }, h('span', { class: 'stat-v' }, value), h('span', { class: 'stat-l' }, label));
  $('rec-stats').replaceChildren(
    stat('Wins', String(st.wins)), stat('Losses', String(st.losses)),
    stat('Win rate', games ? `${Math.round((st.wins / games) * 100)}%` : '—'),
    stat('Best streak', String(st.bestStreak)), stat('Packs opened', String(profile.packsOpened)),
    stat('Cards collected', `${COLLECTIBLE.filter((id) => profile.collection[id]).length}/${COLLECTIBLE.length}`),
  );
  $('rec-bosses').replaceChildren(...Object.entries(BOSSES).map(([k, b]) => {
    const r = st.byBoss[k] ?? { wins: 0, losses: 0 };
    return h('div', { class: `boss-rec boss-${k}` }, h('span', { class: 'choice-art', 'aria-hidden': 'true' }), h('strong', null, b.name), h('span', null, `${r.wins} wins · ${r.losses} losses`));
  }));
  $('rec-ach').replaceChildren(...ACHIEVEMENTS.map((a) => h('li', { class: `ach${profile.achievements[a.id] ? ' on' : ''}` },
    h('span', { class: 'achv-icon', 'aria-hidden': 'true' }), h('div', null, h('strong', null, a.label), h('span', null, a.desc)),
    h('span', { class: 'ach-state' }, profile.achievements[a.id] ? 'Unlocked' : 'Locked'))));
};

// ------------------------------------------------------------------ leaderboard

ENTER.leaderboard = async function renderLeaderboard() {
  const rows = $('lb-rows');
  if (!cloudConfigured()) {
    setText($('lb-status'), 'The global leaderboard is not switched on for this copy of the game. The repository owner can enable it with a free Firebase project — see docs/FIREBASE_SETUP.md.');
    rows.replaceChildren(h('tr', null, h('td', { colspan: '4', class: 'empty' }, 'Offline — your own record is on the Records screen.')));
    return;
  }
  setText($('lb-status'), profile.cloud.optIn ? 'Loading…' : 'Loading… (your results are not being sent — turn that on in Settings)');
  rows.replaceChildren();
  const res = await fetchLeaderboard(10);
  if (!res.ok) { setText($('lb-status'), 'Could not reach the leaderboard. Check your connection and try Refresh.'); return; }
  setText($('lb-status'), profile.cloud.optIn ? 'Top 10 engineers by wins.' : 'Top 10 engineers by wins. Turn on "Send my wins and losses" in Settings to appear here.');
  rows.replaceChildren(...(res.rows.length ? res.rows.map((r, i) => h('tr', { class: r.id === res.me ? 'me' : '' },
    h('td', null, String(i + 1)), h('td', null, r.name), h('td', null, String(r.wins)), h('td', null, String(r.losses))))
    : [h('tr', null, h('td', { colspan: '4', class: 'empty' }, 'No results yet — be the first.'))]));
};
$('lb-refresh').addEventListener('click', () => ENTER.leaderboard());

// ------------------------------------------------------------------ rules (keywords from data)

ENTER.rules = function renderRules() {
  const dl = $('rules-keywords');
  if (dl.childElementCount) return;
  dl.replaceChildren(...Object.entries(KEYWORDS).flatMap(([k, v]) => [h('dt', { class: `kw kw-${k}` }, v.label), h('dd', null, v.text)]));
};
ENTER.rules();

// ------------------------------------------------------------------ settings

ENTER.settings = function renderSettings() {
  const s = profile.settings;
  $('set-name').value = profile.name;
  $('set-sfx-on').checked = s.sfxOn;
  $('set-music-on').checked = s.musicOn;
  $('set-sfx').value = String(s.sfx);
  $('set-music').value = String(s.music);
  $('set-master').value = String(s.master);
  $('set-speed').value = s.speed;
  $('set-reduced').checked = s.reducedMotion;
  $('set-tutorial').checked = !profile.seen.tutorial;
  $('set-cloud').checked = profile.cloud.optIn;
  $('set-cloud').disabled = !cloudConfigured();
  setText($('set-cloud-status'), cloudConfigured() ? 'Only your engineer name, wins and losses are sent. You can switch this off at any time.' : 'Not available: this copy of the game has no Firebase project configured.');
};

$('settings-form').addEventListener('input', (e) => {
  const s = profile.settings;
  const t = e.target;
  if (t.id === 'set-name') {
    const n = cleanName(t.value);
    if (n.length >= 2) profile.name = n;
  }
  if (t.id === 'set-sfx-on') s.sfxOn = t.checked;
  if (t.id === 'set-music-on') s.musicOn = t.checked;
  if (t.id === 'set-sfx') s.sfx = Number(t.value);
  if (t.id === 'set-music') s.music = Number(t.value);
  if (t.id === 'set-master') s.master = Number(t.value);
  if (t.id === 'set-speed') s.speed = t.value;
  if (t.id === 'set-reduced') { s.reducedMotion = t.checked; document.body.classList.toggle('reduce-motion', t.checked); }
  if (t.id === 'set-tutorial') profile.seen.tutorial = !t.checked;
  if (t.id === 'set-cloud') profile.cloud.optIn = t.checked;
  audio.configure(s);
  saveProfile();
  if (t.type === 'range') sfx.click();
});
$('settings-form').addEventListener('submit', (e) => e.preventDefault());
$('set-reset').addEventListener('click', () => {
  ui.modal({
    title: 'Reset all progress?',
    body: h('p', null, 'This deletes your collection, packs, custom deck, records and achievements on this device. It cannot be undone.'),
    actions: [
      { label: 'Cancel', onClick: ui.closeModal },
      { label: 'Reset everything', danger: true, primary: true, onClick: () => { profile = defaultProfile(); draft = null; saveProfile(); audio.configure(profile.settings); ui.closeModal(); ENTER.settings(); ui.toast('Progress reset.'); } },
    ],
  });
});

$('sound-toggle').addEventListener('click', () => {
  const on = !(profile.settings.sfxOn || profile.settings.musicOn);
  profile.settings.sfxOn = on;
  profile.settings.musicOn = on;
  audio.configure(profile.settings);
  saveProfile();
  if (document.body.dataset.screen === 'settings') ENTER.settings();
});

// ------------------------------------------------------------------ global input

// Audio can only start after a user gesture.
window.addEventListener('pointerdown', () => audio.unlock(), { once: true });
window.addEventListener('keydown', () => audio.unlock(), { once: true });
// Subtle hover tick on buttons (desktop)
document.addEventListener('pointerover', (e) => { if (e.pointerType === 'mouse' && e.target.closest?.('.btn, .choice, .nav-links a')) sfx.hover(); });
// Keyboard: Enter/Space on role=button cards outside battle
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('.card[role="button"]') && !e.target.closest('#screen-battle')) { e.preventDefault(); e.target.click(); }
});

document.body.classList.toggle('reduce-motion', profile.settings.reducedMotion);
refreshBadges();
route();
