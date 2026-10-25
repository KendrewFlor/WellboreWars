// Sound effects and music, synthesised live with the Web Audio API.
// No audio files are downloaded. Audio starts only after the first click/tap
// (browsers block autoplay), and every sound respects the volume settings.

let ctx = null;
let master = null;
let sfxBus = null;
let musicBus = null;
let unlocked = false;
let settings = { master: 0.8, music: 0.4, sfx: 0.9, musicOn: true, sfxOn: true };
let musicTimer = null;
let musicStep = 0;

function ensure() {
  if (!unlocked) return null;
  if (!ctx) {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    sfxBus = ctx.createGain();
    musicBus = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    sfxBus.connect(master);
    musicBus.connect(master);
    master.connect(comp).connect(ctx.destination);
    applyVolumes();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function applyVolumes() {
  if (!ctx) return;
  master.gain.value = settings.master;
  sfxBus.gain.value = settings.sfxOn ? settings.sfx : 0;
  musicBus.gain.value = settings.musicOn ? settings.music * 0.35 : 0;
}

/** One enveloped oscillator note. */
function tone(freq, { at = 0, dur = 0.2, type = 'sine', gain = 0.2, glide = null, bus = 'sfx' } = {}) {
  const c = ensure();
  if (!c) return;
  const t = c.currentTime + at;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(bus === 'music' ? musicBus : sfxBus);
  o.start(t);
  o.stop(t + dur + 0.05);
}

/** Filtered noise burst: swishes, impacts, crumbles. */
function noise({ at = 0, dur = 0.2, gain = 0.3, freq = 1200, q = 0.8, type = 'bandpass', sweep = null } = {}) {
  const c = ensure();
  if (!c) return;
  const t = c.currentTime + at;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(sfxBus);
  src.start(t);
}

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);

export const sfx = {
  click: () => tone(1200, { dur: 0.04, type: 'square', gain: 0.05 }),
  hover: () => tone(1800, { dur: 0.025, type: 'sine', gain: 0.02 }),
  draw: () => noise({ dur: 0.18, freq: 2500, sweep: 6000, gain: 0.18, q: 0.6 }),
  shuffle: () => { for (let i = 0; i < 6; i++) noise({ at: i * 0.05, dur: 0.06, freq: 3000, gain: 0.12 }); },
  play: () => { noise({ dur: 0.12, freq: 400, gain: 0.25, type: 'lowpass' }); tone(110, { dur: 0.25, glide: 55, gain: 0.3 }); },
  spell: () => { [72, 76, 79, 84].forEach((n, i) => tone(NOTE(n), { at: i * 0.05, dur: 0.3, type: 'triangle', gain: 0.1 })); noise({ dur: 0.4, freq: 5000, gain: 0.06 }); },
  attack: () => noise({ dur: 0.22, freq: 600, sweep: 3000, gain: 0.28, q: 1.2 }),
  hit: () => { noise({ dur: 0.15, freq: 300, gain: 0.35, type: 'lowpass' }); tone(90, { dur: 0.15, glide: 50, type: 'square', gain: 0.12 }); },
  wellHit: () => { noise({ dur: 0.35, freq: 180, gain: 0.45, type: 'lowpass' }); tone(70, { dur: 0.4, glide: 35, gain: 0.35 }); },
  death: () => { noise({ dur: 0.5, freq: 1800, sweep: 200, gain: 0.3, q: 0.5 }); tone(220, { dur: 0.4, glide: 60, type: 'sawtooth', gain: 0.07 }); },
  heal: () => [64, 67, 71, 76].forEach((n, i) => tone(NOTE(n), { at: i * 0.06, dur: 0.35, gain: 0.08 })),
  shield: () => { tone(880, { dur: 0.3, type: 'triangle', gain: 0.08, glide: 1320 }); tone(1320, { at: 0.05, dur: 0.3, gain: 0.05 }); },
  buff: () => [60, 64, 67].forEach((n, i) => tone(NOTE(n + 12), { at: i * 0.04, dur: 0.2, type: 'square', gain: 0.04 })),
  stun: () => { tone(300, { dur: 0.3, type: 'sawtooth', gain: 0.06, glide: 120 }); noise({ dur: 0.2, freq: 800, gain: 0.1 }); },
  turn: () => { tone(NOTE(72), { dur: 0.5, gain: 0.1 }); tone(NOTE(79), { at: 0.08, dur: 0.6, gain: 0.08 }); },
  enemyTurn: () => { tone(NOTE(57), { dur: 0.5, type: 'sawtooth', gain: 0.05 }); tone(NOTE(52), { at: 0.1, dur: 0.6, type: 'sawtooth', gain: 0.05 }); },
  alarm: () => { for (let i = 0; i < 4; i++) tone(i % 2 ? 660 : 880, { at: i * 0.18, dur: 0.16, type: 'square', gain: 0.07 }); },
  error: () => tone(160, { dur: 0.18, type: 'square', gain: 0.06 }),
  power: () => { tone(NOTE(55), { dur: 0.4, type: 'sawtooth', gain: 0.08, glide: NOTE(67) }); noise({ dur: 0.3, freq: 1500, gain: 0.08 }); },
  victory: () => [60, 64, 67, 72, 76, 79, 84].forEach((n, i) => tone(NOTE(n), { at: i * 0.11, dur: 0.6, type: 'triangle', gain: 0.12 })),
  defeat: () => [67, 63, 60, 55, 48].forEach((n, i) => tone(NOTE(n), { at: i * 0.18, dur: 0.7, type: 'sawtooth', gain: 0.06 })),
  packShake: () => { for (let i = 0; i < 10; i++) noise({ at: i * 0.07, dur: 0.06, freq: 900 + i * 120, gain: 0.08 + i * 0.01 }); },
  reveal: (rarity) => {
    const tiers = { common: [72], uncommon: [72, 76], rare: [72, 76, 79], epic: [72, 76, 79, 83], legendary: [72, 76, 79, 84, 88], brilliant: [72, 76, 79, 84, 88, 91, 96] };
    (tiers[rarity] ?? [72]).forEach((n, i) => tone(NOTE(n), { at: i * 0.07, dur: 0.5, type: rarity === 'brilliant' ? 'sawtooth' : 'triangle', gain: 0.1 }));
    if (rarity === 'brilliant') { noise({ at: 0.1, dur: 1.4, freq: 120, gain: 0.5, type: 'lowpass' }); tone(55, { dur: 1.6, glide: 30, gain: 0.4 }); }
    if (rarity === 'legendary') noise({ at: 0.1, dur: 0.8, freq: 6000, gain: 0.08 });
  },
  achievement: () => [76, 79, 84, 88].forEach((n, i) => tone(NOTE(n), { at: i * 0.08, dur: 0.4, type: 'triangle', gain: 0.1 })),
  consent: () => { tone(NOTE(76), { dur: 0.15, gain: 0.1 }); tone(NOTE(83), { at: 0.1, dur: 0.25, gain: 0.1 }); },
};

// ------------------------------------------------------------------ music
// A slow generative loop in D minor pentatonic: pad + bass + sparse lead.
const SCALE = [62, 65, 67, 69, 72, 74, 77];
const CHORDS = [[50, 57, 62], [46, 53, 58], [48, 55, 60], [45, 52, 57]];

function musicTick() {
  const c = ensure();
  if (!c || !settings.musicOn) return;
  const bar = Math.floor(musicStep / 8) % CHORDS.length;
  const beat = musicStep % 8;
  if (beat === 0) CHORDS[bar].forEach((n) => tone(NOTE(n), { dur: 3.6, type: 'triangle', gain: 0.05, bus: 'music' }));
  if (beat % 2 === 0) tone(NOTE(CHORDS[bar][0] - 12), { dur: 0.4, type: 'sine', gain: 0.12, bus: 'music' });
  if (Math.random() < 0.35) tone(NOTE(SCALE[Math.floor(Math.random() * SCALE.length)]), { dur: 0.6, type: 'sine', gain: 0.035, bus: 'music' });
  musicStep++;
}

export const audio = {
  unlock() {
    if (unlocked) return;
    unlocked = true;
    ensure();
    this.syncMusic();
  },
  configure(s) {
    settings = { ...settings, ...s };
    applyVolumes();
    this.syncMusic();
  },
  syncMusic() {
    if (unlocked && settings.musicOn && !musicTimer) musicTimer = setInterval(musicTick, 450);
    if ((!settings.musicOn || !unlocked) && musicTimer) { clearInterval(musicTimer); musicTimer = null; }
  },
};
