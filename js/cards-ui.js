// Card and unit markup. JavaScript only builds plain elements with class names;
// all visuals (frames, discipline colours, CSS-drawn art, rarity foils) live in css/cards.css.

import { h, hash } from './dom.js';
import { card, DISCIPLINES, KEYWORDS, RARITIES } from './engine.js';

const rarityLabel = Object.fromEntries(RARITIES.map((r) => [r.id, r.label]));
const TYPE_LABEL = { unit: 'Unit', operation: 'Operation', field: 'Field' };

export function cardTypeLine(c) {
  const t = c.powerup ? 'Power-up' : TYPE_LABEL[c.type];
  return `${t} · ${DISCIPLINES[c.disc].label}`;
}

/** Plain-text description for screen readers and the zoom view. */
export function cardSummary(c, cost = c.cost) {
  const bits = [`${c.name}. ${rarityLabel[c.rarity]} ${cardTypeLine(c)}. Cost ${cost}.`];
  if (c.type === 'unit') bits.push(`${c.power} Power, ${c.integrity} Integrity.`);
  if (c.kw?.length) bits.push(`${c.kw.map((k) => KEYWORDS[k].label).join(', ')}.`);
  if (c.text) bits.push(c.text);
  return bits.join(' ');
}

function art(c) {
  const v = hash(c.id) % 4;
  return h('div', { class: `c-art art-${c.disc}${c.powerup ? ' art-powerup' : ''}`, dataset: { v: String(v) }, 'aria-hidden': 'true' },
    h('span', { class: 'art-layer art-a' }),
    h('span', { class: 'art-layer art-b' }),
    h('span', { class: 'c-glyph' }, c.glyph ?? c.name.slice(0, 2)));
}

/**
 * Full card face.
 * opts: { cost (effective), count (owned), dim, small, uid, playable }
 */
export function renderCard(id, opts = {}) {
  const c = card(id);
  const cost = opts.cost ?? c.cost;
  const beats = DISCIPLINES[c.disc].beats;
  const el = h('article', {
    class: [
      'card', `d-${c.disc}`, `r-${c.rarity}`, `t-${c.type}`,
      c.powerup ? 'is-powerup' : '', c.junk ? 'is-junk' : '',
      opts.small ? 'is-small' : '', opts.dim ? 'is-dim' : '', opts.playable ? 'is-playable' : '',
      cost < c.cost ? 'is-cheaper' : cost > c.cost ? 'is-pricier' : '',
    ].filter(Boolean).join(' '),
    dataset: { id, ...(opts.uid ? { uid: String(opts.uid) } : {}) },
    tabindex: opts.focusable === false ? null : '0',
    role: 'button',
    'aria-label': cardSummary(c, cost),
  },
  h('div', { class: 'c-frame' },
    h('span', { class: 'c-cost', title: 'Budget cost' }, String(cost)),
    h('span', { class: 'c-gem', title: rarityLabel[c.rarity] }),
    art(c),
    h('h3', { class: 'c-name' }, c.name),
    h('p', { class: 'c-type' }, cardTypeLine(c)),
    c.kw?.length ? h('p', { class: 'c-kws' }, c.kw.map((k) => h('span', { class: `kw kw-${k}`, title: KEYWORDS[k].text }, KEYWORDS[k].label))) : null,
    c.text ? h('p', { class: 'c-text' }, c.text) : null,
    !opts.small && c.flavor ? h('p', { class: 'c-flavor' }, c.flavor) : null,
    c.type === 'unit' ? h('span', { class: 'c-pow', title: 'Power' }, String(c.power)) : null,
    c.type === 'unit' ? h('span', { class: 'c-int', title: 'Integrity' }, String(c.integrity)) : null,
    beats && c.type === 'unit' && !opts.small ? h('span', { class: `c-beats d-${beats}`, title: `+1 damage against ${DISCIPLINES[beats].label}` }, `▲ ${DISCIPLINES[beats].label}`) : null,
    c.rarity === 'brilliant' ? h('span', { class: 'c-foil-label' }, 'Blowout Brilliant') : null,
  ),
  opts.count != null ? h('span', { class: 'c-count' }, `×${opts.count}`) : null);
  return el;
}

export function renderBack() {
  return h('div', { class: 'card-back', 'aria-hidden': 'true' }, h('span', { class: 'back-logo' }, 'WW'));
}

/** Compact board unit. */
export function renderUnit(u) {
  const c = card(u.id);
  const el = h('div', { class: `unit d-${c.disc} r-${c.rarity}`, dataset: { uid: String(u.uid), id: u.id }, tabindex: '0', role: 'button' },
    h('div', { class: 'u-ring' }),
    art(c),
    h('span', { class: 'u-name' }, c.name),
    h('span', { class: 'u-pow', title: 'Power' }),
    h('span', { class: 'u-int', title: 'Integrity' }),
    h('div', { class: 'u-badges' }),
  );
  updateUnit(el, u);
  return el;
}

/** Update stats and status classes in place (keeps animations smooth). */
export function updateUnit(el, u) {
  const c = card(u.id);
  const pow = el.querySelector('.u-pow');
  const int = el.querySelector('.u-int');
  if (pow.textContent !== String(u.power)) pow.textContent = String(u.power);
  if (int.textContent !== String(u.integrity)) int.textContent = String(u.integrity);
  pow.classList.toggle('up', u.power > c.power);
  pow.classList.toggle('down', u.power < c.power);
  int.classList.toggle('down', u.integrity < u.maxIntegrity);
  int.classList.toggle('up', u.maxIntegrity > c.integrity && u.integrity >= u.maxIntegrity);
  for (const k of ['casing', 'bop', 'spud', 'fracture', 'recovery', 'sour', 'waterflood', 'dual']) el.classList.toggle(`k-${k}`, u.kw.includes(k));
  el.classList.toggle('s-stuck', u.stuck > 0);
  el.classList.toggle('s-sour', u.sour > 0);
  const badges = el.querySelector('.u-badges');
  const want = [...u.kw.filter((k) => k !== 'casing' && k !== 'bop'), ...(u.stuck ? ['stuck'] : []), ...(u.sour ? ['h2s'] : [])].join(',');
  if (badges.dataset.k !== want) {
    badges.dataset.k = want;
    const label = { spud: 'Spud', fracture: 'Fracture', recovery: 'Recovery', sour: 'Sour', waterflood: 'Waterflood', dual: 'Dual', stuck: 'Stuck', h2s: 'H₂S' };
    badges.replaceChildren(...want.split(',').filter(Boolean).map((k) => h('span', { class: `badge b-${k}`, title: label[k] }, label[k])));
  }
  el.setAttribute('aria-label', `${c.name}, ${u.power} power, ${u.integrity} integrity${u.kw.length ? ', ' + u.kw.map((k) => KEYWORDS[k].label).join(', ') : ''}${u.stuck ? ', stuck' : ''}${u.sour ? ', H2S' : ''}`);
}

/** Big zoom view with full rules text for a card. */
export function renderZoom(id) {
  const c = card(id);
  const kws = c.kw ?? [];
  return h('div', { class: 'zoom' },
    renderCard(id, { focusable: false }),
    h('div', { class: 'zoom-info' },
      h('h2', null, c.name),
      h('p', { class: `zoom-rarity r-${c.rarity}` }, `${rarityLabel[c.rarity]} · ${cardTypeLine(c)}`),
      c.text ? h('p', null, c.text) : null,
      kws.length ? h('dl', { class: 'zoom-kws' }, kws.flatMap((k) => [h('dt', null, KEYWORDS[k].label), h('dd', null, KEYWORDS[k].text)])) : null,
      DISCIPLINES[c.disc].beats && c.type === 'unit' ? h('p', { class: 'hint' }, `Discipline wheel: deals +1 damage to ${DISCIPLINES[DISCIPLINES[c.disc].beats].label} units.`) : null,
      c.flavor ? h('p', { class: 'zoom-flavor' }, c.flavor) : null,
    ));
}
