// Tiny, injection-safe DOM builder. Text is always inserted as text nodes;
// there is deliberately no way to pass raw HTML through this helper.

const BLOCKED_ATTRS = /^(on|style$|srcdoc$|formaction$)/i;

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'on') for (const [evt, fn] of Object.entries(value)) el.addEventListener(evt, fn);
    else if (key === 'ref') value(el);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'css') for (const [p, v] of Object.entries(value)) el.style.setProperty(p, v);
    else if (BLOCKED_ATTRS.test(key)) throw new Error(`Attribute "${key}" is not allowed in h(); use the "on" or "css" props.`);
    else if (key === 'href' && !/^(#|https:\/\/|\.\/)/.test(String(value))) throw new Error('Only #, ./ and https:// links are allowed.');
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function setText(el, text) {
  if (el && el.textContent !== text) el.textContent = text;
}

/** Promise that resolves after `ms` milliseconds. */
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Stable small hash of a string (for per-card art variation). */
export function hash(str) {
  let x = 2166136261;
  for (let i = 0; i < str.length; i++) x = Math.imul(x ^ str.charCodeAt(i), 16777619);
  return x >>> 0;
}
