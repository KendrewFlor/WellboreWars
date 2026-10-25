// Seeded, reproducible pseudo-random numbers.
// sfc32 (Small Fast Counter) — good statistical quality, tiny, no dependencies.
// The seed is shown in the UI so any run (and any crate roll) can be replayed.

export function hashSeed(str) {
  // cyrb128-style string hash -> four 32-bit words
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

export function createRng(seed) {
  let [a, b, c, d] = hashSeed(String(seed));
  const next = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    const r = (t + d) | 0;
    c = (c + r) | 0;
    return (r >>> 0) / 4294967296;
  };
  // Warm up so similar seeds diverge immediately.
  for (let i = 0; i < 15; i++) next();
  return {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    // Standard normal via Box–Muller
    normal: () => {
      let u = 0;
      while (u === 0) u = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
    },
  };
}

export function freshSeed() {
  const buf = new Uint32Array(2);
  globalThis.crypto.getRandomValues(buf);
  return buf[0].toString(36) + buf[1].toString(36);
}
