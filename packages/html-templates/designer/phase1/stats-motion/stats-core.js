/* Stats · Motion set — shared runtime (copied from ../stats/stats-core.js; only the variant list and the editor changed).
 * Each variant here owns its motion, so the Comes-in / Order pickers are removed; Pace still sets the gap and the hold.
 *
 *
 * FAITHFUL TO THE REMOTION COMPONENTS (src/components/data): the variants copy the sizes, spacing, springs and timings of
 * StatCounter, MultiStat and BarChart (type scale, space(n)=8n, radius, 30 fps, 42-frame count-up, 18-frame entrances,
 * 12-frame exits, 8 / 5-frame staggers). The spring curves below are sampled from Remotion's own spring() with the same
 * configs as src/motion/motion.ts, so the easing is the real one, not an imitation.
 *
 * Each variant registers   StatsMotion.mount({ id, name, maxItems, duration(n, P), build(stage, data, U, o) })
 * build() creates the DOM once and returns update(frame): a pure function of the frame (30 fps), so the playhead can be
 * scrubbed, looped or rendered frame by frame.
 *
 * Three controls shape every variant:
 *   Motion — where each stat comes from (rise · left · right · top · bottom · pop · slam · fade)
 *   Order  — which stat goes first (left→right · right→left · centre-out · together)
 *   Pace   — Relaxed / Normal / Snappy: changes the GAP between stats and the HOLD afterwards.
 *            Entrances and the count-up keep their fixed lengths (same time-stretch rule as the components).
 */
(function () {
  'use strict';

  const F = 30;
  const SPR = {"smooth":[0,0.0446,0.1443,0.2642,0.3849,0.4963,0.594,0.6768,0.7452,0.8009,0.8454,0.8807,0.9084,0.93,0.9467,0.9596,0.9694,0.9769,0.9826,0.987,0.9902,0.9927,0.9946,0.9959,0.997,0.9978,0.9983,0.9988,0.9991,0.9993,0.9995,0.9996,0.9997,0.9998,0.9999,0.9999,0.9999,0.9999,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],"snappy":[0,0.1124,0.3305,0.5483,0.7235,0.8475,0.9268,0.9728,0.9965,1.0067,1.0094,1.0087,1.0067,1.0046,1.0029,1.0016,1.0008,1.0003,1.0001,0.9999,0.9999,0.9999,0.9999,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],"bouncy":[0,0.0852,0.2879,0.5365,0.7758,0.9708,1.1053,1.1779,1.1978,1.1795,1.1387,1.0894,1.0423,1.0042,0.9782,0.9644,0.9609,0.9648,0.973,0.9828,0.992,0.9995,1.0045,1.0071,1.0077,1.0069,1.0053,1.0033,1.0015,1,0.9991,0.9986,0.9985,0.9986,0.999,0.9994,0.9997,1,1.0002,1.0003,1.0003,1.0003,1.0002,1.0001,1.0001,1,1,0.9999,0.9999,0.9999,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]};

  const VARIANTS = [
    { id: 'tape', file: 'v1-tape-measure.html', name: 'Tape Measure' },
    { id: 'swarm', file: 'v2-unit-swarm.html', name: 'Unit Swarm' },
    { id: 'tubes', file: 'v3-liquid-tubes.html', name: 'Liquid Tubes' },
    { id: 'bubbles', file: 'v4-bubble-pack.html', name: 'Bubble Pack' },
    { id: 'scale', file: 'v5-scale-zoom.html', name: 'Scale Zoom' },
    { id: 'comet', file: 'v6-comet-trail.html', name: 'Comet Trail' },
    { id: 'odometer', file: 'v1-odometer.html', name: 'Odometer' },
  ];
  const STORAGE_KEY = 'stats-data-v2';
  const PACES = { relaxed: { stagger: 1.6, hold: 1.5 }, normal: { stagger: 1, hold: 1 }, snappy: { stagger: 0.6, hold: 0.7 } };
  const MOTIONS = [['rise', 'Rise (default)'], ['left', 'From left'], ['right', 'From right'], ['top', 'From top'], ['bottom', 'From bottom'], ['pop', 'Pop'], ['slam', 'Slam'], ['fade', 'Fade']];
  const ORDERS = [['forward', 'Left → right'], ['reverse', 'Right → left'], ['centre', 'Centre out'], ['together', 'All together']];

  // ── Themes (generated into themes.js / themes.css from src/theme/themes.ts) ──
  const THEMES = window.TIMELINE_THEMES || [];
  const THEME_KEY = 'timeline-motion-theme-v1';
  const pickTheme = (params) => {
    let saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (_) { /* storage unavailable */ }
    const want = params.get('theme') || saved || window.TIMELINE_DEFAULT_THEME;
    return THEMES.find((t) => t.id === want) || THEMES[0] || { id: '', label: '', backdrop: 'none', mode: 'light', swatch: [] };
  };
  const applyTheme = (th) => {
    const root = document.documentElement;
    if (th.id) root.dataset.theme = th.id;
    root.dataset.backdrop = th.backdrop;
  };
  const backdropHTML = (kind) =>
    kind === 'daylight' ? '<div class="bd"><div class="bd-grid"></div><div class="bd-tint t1"></div><div class="bd-tint t2"></div></div>'
    : kind === 'aurora' ? '<div class="bd"><div class="bd-glow g1"></div><div class="bd-glow g2"></div><div class="bd-glow g3"></div><div class="bd-dots"></div></div>'
    : '';
  const W = 1920, H = 1080;

  // ── Icons (line drawings) ──
  const ICONS = {
    chart: [['path', 'M3 3v18h18'], ['path', 'M7 15l4-4 3 3 5-6']],
    user: [['circle', 12, 8, 4], ['path', 'M4 21c0-4 4-6 8-6s8 2 8 6']],
    search: [['circle', 11, 11, 7], ['path', 'M21 21l-4.35-4.35']],
    send: [['path', 'M22 2L11 13'], ['path', 'M22 2l-7 20-4-9-9-4z']],
    star: [['polygon', '12 2 15.1 8.3 22 9.3 17 14.1 18.2 21 12 17.8 5.8 21 7 14.1 2 9.3 8.9 8.3']],
    heart: [['path', 'M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z']],
    clock: [['circle', 12, 12, 10], ['path', 'M12 6v6l4 2']],
    bulb: [['path', 'M9 18h6'], ['path', 'M10 21h4'], ['path', 'M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z']],
    shield: [['path', 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z']],
    flag: [['path', 'M4 22V4'], ['path', 'M4 4h13l-2 5 2 5H4']],
    check: [['path', 'M20 6L9 17l-5-5']],
    layers: [['path', 'M12 2L2 7l10 5 10-5-10-5z'], ['path', 'M2 17l10 5 10-5'], ['path', 'M2 12l10 5 10-5']],
    mail: [['rect', 2, 4, 20, 16, 2], ['path', 'M22 7l-10 6L2 7']],
  };
  const ICON_NAMES = Object.keys(ICONS);
  const shapeHTML = (sh) => {
    const a = 'pathLength="1" style="stroke-dasharray:1;stroke-dashoffset:0"';
    if (sh[0] === 'path') return `<path d="${sh[1]}" ${a}/>`;
    if (sh[0] === 'circle') return `<circle cx="${sh[1]}" cy="${sh[2]}" r="${sh[3]}" ${a}/>`;
    if (sh[0] === 'rect') return `<rect x="${sh[1]}" y="${sh[2]}" width="${sh[3]}" height="${sh[4]}" rx="${sh[5]}" ${a}/>`;
    return `<polygon points="${sh[1]}" ${a}/>`;
  };

  /** A spring sampled from Remotion, at a (fractional) frame. */
  const sp = (name, f) => {
    const a = SPR[name];
    if (f <= 0) return 0;
    if (f >= a.length - 1) return a[a.length - 1];
    const i = Math.floor(f), k = f - i;
    return a[i] + (a[i + 1] - a[i]) * k;
  };
  const cssNum = (name, fallback) => { const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)); return Number.isFinite(v) ? v : fallback; };

  const U = {
    W, H, F, ICON_NAMES,
    icon: (name, size = 56, sw = 2) =>
      `<svg class="ic" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${(ICONS[name] || ICONS.star).map(shapeHTML).join('')}</svg>`,
    draw: (svg, p) => { const o = String(1 - U.clamp(p)); svg.querySelectorAll('[pathLength]').forEach((e) => { e.style.strokeDashoffset = o; }); },
    accent: (i) => `var(--${['primary', 'secondary', 'tertiary', 'quaternary'][i % 4]})`,

    clamp: (v, a = 0, b = 1) => Math.min(b, Math.max(a, v)),
    lerp: (a, b, k) => a + (b - a) * k,
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; },
    radius: () => cssNum('--radius', 12),
    stroke: 4,
    space: (n) => n * 8,

    // ── Motion (frames @ 30 fps; same helpers as src/motion/motion.ts) ──
    sp,
    /** Spring progress that starts at `start`. */
    prog: (f, start, name = 'smooth') => sp(name, f - start),
    lin: (f, start, dur) => U.clamp((f - start) / Math.max(1, dur)),
    ease: (f, start, dur) => { const t = U.lin(f, start, dur); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; },
    /** Count-up progress: ease-out cubic over 42 frames. */
    count: (f, start, dur = 42) => 1 - Math.pow(1 - U.lin(f, start, dur), 3),
    /** Exit progress: eased over 12 frames from `exitFrame`; 0 while holding. */
    exit: (f, exitFrame) => (exitFrame == null ? 0 : U.ease(f, exitFrame, 12)),
    /** Which spring a motion uses (slam is crisp, the rest smooth). */
    springOf: (motion) => (motion === 'slam' ? 'snappy' : 'smooth'),

    /** Entrance for `motion` at enter progress p and exit progress x: {o, t}. `dist` = travel for the directional ones. */
    enter(motion, p, x = 0, dist = 120) {
      const out = 1 - x, sh = x * 12;
      switch (motion) {
        case 'fade': return { o: p * out, t: '' };
        case 'left': return { o: p * out, t: `translateX(${-(1 - p) * dist}px) translateY(${sh}px)` };
        case 'right': return { o: p * out, t: `translateX(${(1 - p) * dist}px) translateY(${sh}px)` };
        case 'top': return { o: p * out, t: `translateY(${-(1 - p) * dist + sh}px)` };
        case 'bottom': return { o: p * out, t: `translateY(${(1 - p) * dist + sh}px)` };
        case 'pop': return { o: Math.min(1, p * 2) * out, t: `scale(${0.6 + 0.4 * p - x * 0.05})` };
        case 'slam': return { o: Math.min(1, p * 3) * out, t: `scale(${1.6 - 0.6 * p})` };
        default: return { o: p * out, t: `translateY(${(1 - p) * 40 + sh}px)` };   // rise: what the components do
      }
    },
    put(el, motion, p, x, dist) { const e = U.enter(motion, p, x, dist); el.style.opacity = U.clamp(e.o); el.style.transform = e.t; },
    /** Position of item i in the entrance order. */
    rank(i, n, order) {
      if (order === 'reverse') return n - 1 - i;
      if (order === 'together') return 0;
      if (order === 'centre') { const c = (n - 1) / 2; return [...Array(n).keys()].sort((a, b) => Math.abs(a - c) - Math.abs(b - c) || a - b).indexOf(i); }
      return i;
    },

    // ── Numbers ──
    parse(v) {
      const raw = String(v ?? '0').replace(/,/g, '').trim();
      const x = parseFloat(raw), dot = raw.indexOf('.');
      return { v: Number.isFinite(x) ? x : 0, dec: dot >= 0 ? Math.min(2, raw.length - dot - 1) : 0 };
    },
    fmt(v, dec, signed = false) {
      const abs = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
      const zero = Number(abs.replace(/,/g, '')) === 0;
      if (v < 0 && !zero) return '−' + abs;
      return signed && !zero ? '+' + abs : abs;
    },
    /** Counting number (StableNumber): the final value sits invisibly underneath so the box never changes width. */
    counter(it, opt = {}) {
      const { v, dec } = U.parse(it.value);
      const from = opt.from ?? 0;
      const root = U.el('span', 'cn ' + (opt.cls || ''),
        `${it.prefix ? `<span class="cn-pre">${U.esc(it.prefix)}</span>` : ''}<span class="cn-num"><i>${U.fmt(v, dec)}</i><b>${U.fmt(from, dec)}</b></span>${it.suffix ? `<span class="cn-suf">${U.esc(it.suffix)}</span>` : ''}`);
      const live = root.querySelector('b');
      return { el: root, v, dec, set: (p) => { live.textContent = U.fmt(from + (v - from) * U.clamp(p, 0, 1.2), dec); } };
    },

    /** Scene heading, same layout as the Story Studio scene header: kicker + headline at the top left. */
    head(stage, data) {
      const h = U.el('div', 'hd', `<div class="hd-k">${U.esc(data.kicker)}</div><div class="hd-h">${U.esc(data.heading)}</div>`);
      stage.append(h);
      return (f) => { const p = 1 - Math.pow(1 - U.lin(f, 2, 18), 3); h.style.opacity = p; h.style.transform = `translateY(${(1 - p) * 14}px)`; };
    },

    /** DeltaBadge: ▲ +12% / ▼ −4% pill that pops (bouncy) then counts. `d` = {value, suffix, label, goodWhen}. */
    delta(d, size = 'md') {
      const { v, dec } = U.parse(d.value);
      const dir = v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
      const good = d.goodWhen || 'up';
      const color = dir === 'flat' ? 'var(--text-muted)' : dir === good ? 'var(--positive)' : 'var(--negative)';
      const fs = size === 'lg' ? 40 : 24, tri = fs * 0.62;
      const root = U.el('div', 'db');
      root.style.setProperty('--dc', color);
      root.innerHTML = `<div class="db-pill" style="font-size:${fs}px;gap:${fs * 0.35}px;padding:${fs * 0.28}px ${fs * 0.55}px">${dir === 'flat' ? '' : `<svg width="${tri}" height="${tri}" viewBox="0 0 10 10" style="${dir === 'down' ? 'transform:rotate(180deg)' : ''}"><polygon points="5,1 9.5,9 0.5,9" fill="currentColor"/></svg>`}<span><span class="db-n">0</span>${U.esc(d.suffix || '%')}</span></div>${d.label ? `<span class="db-l" style="font-size:${Math.max(20, fs * 0.8)}px">${U.esc(d.label)}</span>` : ''}`;
      const pill = root.querySelector('.db-pill'), n = root.querySelector('.db-n'), l = root.querySelector('.db-l');
      return {
        el: root,
        update(f, start, x = 0) {
          const e = U.prog(f, start, 'bouncy'), c = U.count(f, start + 4, 24);
          root.style.opacity = 1 - x; root.style.transform = `translateY(${x * 12}px)`;
          pill.style.opacity = Math.min(1, e * 2); pill.style.transform = `scale(${0.4 + 0.6 * e})`;
          n.textContent = U.fmt(v * c, dec, true);
          if (l) { const li = U.prog(f, start + 6); l.style.opacity = li; l.style.transform = `translateX(${(1 - li) * -12}px)`; }
        },
      };
    },
  };

  /** Reads an item's change figure, if any. */
  U.deltaOf = (it) => (String(it.delta ?? '').trim() === '' ? null : { value: it.delta, suffix: it.deltaSuffix || '%', label: it.deltaLabel || '', goodWhen: it.goodWhen || 'up' });

  const DEFAULT_DATA = {
    pace: 'normal', motion: 'rise', order: 'forward',
    kicker: 'Growth',
    heading: 'Active users, quarter by quarter',
    items: [
      { label: 'Q1 2025', value: '12', prefix: '', suffix: 'k', delta: '', deltaLabel: '', icon: 'user', highlight: false },
      { label: 'Q2 2025', value: '21', prefix: '', suffix: 'k', delta: '75', deltaLabel: 'vs Q1', icon: 'user', highlight: false },
      { label: 'Q3 2025', value: '33', prefix: '', suffix: 'k', delta: '57', deltaLabel: 'vs Q2', icon: 'user', highlight: false },
      { label: 'Q4 2025', value: '48', prefix: '', suffix: 'k', delta: '45', deltaLabel: 'vs Q3', icon: 'user', highlight: true },
    ],
  };

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) { const d = JSON.parse(raw); if (d && Array.isArray(d.items)) return Object.assign({ pace: 'normal', motion: 'rise', order: 'forward' }, d); }
    } catch (_) { /* storage unavailable — fall back to defaults */ }
    return structuredClone(DEFAULT_DATA);
  }
  function save(data) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (_) { /* quota / private mode */ }
  }

  // ── Mount ────────────────────────────────────────────────────────────────
  function mount(variant) {
    const params = new URLSearchParams(location.search);
    const embed = params.has('embed');
    if (embed) document.body.classList.add('embed');
    let theme = pickTheme(params);
    applyTheme(theme);

    let data = load();
    if (PACES[params.get('pace')]) data.pace = params.get('pace');
    if (MOTIONS.some((m) => m[0] === params.get('motion'))) data.motion = params.get('motion');
    if (ORDERS.some((o) => o[0] === params.get('order'))) data.order = params.get('order');
    let t = Number(params.get('t')) || 0;
    let playing = !params.has('paused');
    let duration = 1;
    let update = () => {};
    const max = variant.maxItems || 6;

    const icons = {
      play: '<svg viewBox="0 0 16 16"><path d="M4 2.5v11l9-5.5z"/></svg>',
      pause: '<svg viewBox="0 0 16 16"><path d="M3.5 2h3v12h-3zM9.5 2h3v12h-3z"/></svg>',
      replay: '<svg viewBox="0 0 16 16"><path d="M8 3V0L4 4l4 4V5a4 4 0 1 1-4 4H2a6 6 0 1 0 6-6z"/></svg>',
    };
    const opts = (list) => list.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');

    document.body.insertAdjacentHTML('afterbegin', `
      <header class="app-bar">
        <a class="back" href="index.html">← All variants</a>
        <h1>Stats · ${U.esc(variant.name)}</h1>
        <nav class="variants">${VARIANTS.map((v) => `<a href="${v.file}" class="${v.id === variant.id ? 'on' : ''}">${v.name}</a>`).join('')}</nav>
        <nav class="themes" aria-label="Theme">${THEMES.map((th) => `<button data-theme-id="${th.id}" class="${th.id === theme.id ? 'on' : ''}" title="${U.esc(th.label)}"><i style="background:linear-gradient(135deg, ${th.swatch[1]} 50%, ${th.swatch[0]} 50%)"></i>${U.esc(th.label)}</button>`).join('')}</nav>
      </header>
      <main class="app">
        <section class="preview">
          <div class="viewport"><div class="bd-host"></div><div class="stage"></div></div>
          <div class="controls">
            <button class="play" aria-label="Play or pause">${icons.pause}</button>
            <button class="replay" aria-label="Replay from start">${icons.replay}</button>
            <input class="scrub" type="range" min="0" max="1000" value="0" aria-label="Playhead">
            <span class="time">0.0s / 0.0s</span>
          </div>
          <p class="hint">${U.esc(variant.note || '')} Space = play/pause · ←/→ = step 1 frame (Shift = 10) · Edit the stats on the right; changes are shared by all variants.</p>
        </section>
        <aside class="editor noimg">
          <h2>Motion</h2>
          
          <div class="field"><label>Pace · gap between stats and hold</label>
            <div class="seg" role="group" aria-label="Pace"><button data-pace="relaxed">Relaxed</button><button data-pace="normal">Normal</button><button data-pace="snappy">Snappy</button></div>
          </div>
          <h2>Heading</h2>
          <div class="field"><label>Kicker</label><input data-k="kicker"></div>
          <div class="field"><label>Heading</label><input data-k="heading"></div>
          <h2>Stats <span class="cap">(this variant shows up to ${max})</span></h2>
          <div class="items"></div>
          <div class="row">
            <button class="btn primary add">+ Add stat</button>
            <button class="btn export">Export JSON</button>
            <label class="btn">Import<input class="import" type="file" accept="application/json" hidden></label>
            <button class="btn reset">Reset</button>
          </div>
        </aside>
      </main>`);

    const $ = (s) => document.querySelector(s);
    const viewport = $('.viewport'), bdHost = $('.bd-host'), stage = $('.stage'), scrub = $('.scrub'), timeEl = $('.time'), playBtn = $('.play');

    const fit = () => {
      const r = viewport.getBoundingClientRect();
      const s = Math.min(r.width / W, r.height / H);
      stage.style.transform = `translate(${(r.width - W * s) / 2}px, ${(r.height - H * s) / 2}px) scale(${s})`;
      viewport.style.setProperty('--s', s.toFixed(4));
    };
    new ResizeObserver(fit).observe(viewport);

    function rebuild() {
      bdHost.innerHTML = backdropHTML(theme.backdrop);
      stage.innerHTML = '';
      const P = PACES[data.pace] || PACES.normal;
      const items = data.items.slice(0, max);
      duration = variant.duration(Math.max(1, items.length), P) / F;
      if (items.length) update = variant.build(stage, Object.assign({}, data, { items }), U, { motion: data.motion, order: data.order, P });
      else { stage.innerHTML = '<div style="position:absolute;inset:0;display:grid;place-items:center;color:var(--text-muted);font-size:40px">Add a stat to start</div>'; update = () => {}; }
      t = Math.min(t, duration);
      document.querySelectorAll('.seg [data-pace]').forEach((b) => b.classList.toggle('on', b.dataset.pace === data.pace));
      document.querySelectorAll('select[data-o]').forEach((s) => { s.value = data[s.dataset.o]; });
      render();
    }
    function render() {
      const d = (key, ph, amp) => viewport.style.setProperty(key, (Math.sin(t * 0.35 + ph) * amp).toFixed(1));
      d('--d1x', 0, 26); d('--d1y', 1.2, 20); d('--d2x', 1.7, 26); d('--d2y', 2.9, 20); d('--d3x', 3.4, 26); d('--d3y', 4.6, 20);
      update(t * F);
      scrub.value = String(Math.round((t / duration) * 1000));
      timeEl.textContent = `${t.toFixed(1)}s / ${duration.toFixed(1)}s`;
      playBtn.innerHTML = playing ? icons.pause : icons.play;
    }

    let last = performance.now();
    function tick(now) {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (playing) {
        t += dt;
        if (t >= duration) { if (embed) t = 0; else { t = duration; playing = false; } }
        render();
      }
      requestAnimationFrame(tick);
    }

    const togglePlay = () => { if (!playing && t >= duration) t = 0; playing = !playing; render(); };
    playBtn.onclick = togglePlay;
    $('.replay').onclick = () => { t = 0; playing = true; render(); };
    scrub.oninput = () => { t = (Number(scrub.value) / 1000) * duration; playing = false; render(); };
    document.addEventListener('keydown', (e) => {
      if (e.target.closest('input, textarea, select')) return;
      const step = (e.shiftKey ? 10 : 1) / F;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      if (e.code === 'ArrowRight') { t = Math.min(duration, t + step); playing = false; render(); }
      if (e.code === 'ArrowLeft') { t = Math.max(0, t - step); playing = false; render(); }
    });

    // ── Editor ────────────────────────────────────────────────────────────
    let pending = 0;
    const changed = (structural) => {
      save(data);
      if (structural) renderEditor();
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => { t = 0; playing = true; rebuild(); });   // restart so an edit is seen from the top
    };

    document.querySelectorAll('.editor .field input[data-k]').forEach((inp) => {
      inp.value = data[inp.dataset.k] ?? '';
      inp.oninput = () => { data[inp.dataset.k] = inp.value; changed(false); };
    });
    document.querySelectorAll('.seg [data-pace]').forEach((b) => { b.onclick = () => { data.pace = b.dataset.pace; changed(false); }; });
    document.querySelectorAll('select[data-o]').forEach((s) => { s.onchange = () => { data[s.dataset.o] = s.value; changed(false); }; });

    function renderEditor() {
      const list = $('.items');
      list.innerHTML = '';
      data.items.forEach((it, i) => {
        const card = U.el('div', 'item' + (i >= max ? ' off' : ''));
        card.innerHTML = `
          <div class="item-head">
            <span class="num">Stat ${String(i + 1).padStart(2, '0')}${i >= max ? ' · not shown here' : ''}</span>
            <span class="tools">
              <button data-a="up" title="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
              <button data-a="down" title="Move down" ${i === data.items.length - 1 ? 'disabled' : ''}>↓</button>
              <button data-a="del" title="Remove">✕</button>
            </span>
          </div>
          <input data-f="label" placeholder="Label (Q1 2025)" value="${U.esc(it.label)}">
          <div class="trio">
            <input data-f="prefix" placeholder="Prefix ($)" value="${U.esc(it.prefix)}">
            <input data-f="value" placeholder="Number" inputmode="decimal" value="${U.esc(it.value)}">
            <input data-f="suffix" placeholder="Suffix (%)" value="${U.esc(it.suffix)}">
          </div>
          <div class="duo">
            <input data-f="delta" placeholder="Change % (optional, e.g. 12 or -4)" inputmode="decimal" value="${U.esc(it.delta)}">
            <input data-f="deltaLabel" placeholder="Change label (vs 2024)" value="${U.esc(it.deltaLabel)}">
          </div>
          <div class="duo">
            <select data-f="icon" title="Icon">${U.ICON_NAMES.map((n) => `<option value="${n}" ${(it.icon || 'star') === n ? 'selected' : ''}>icon: ${n}</option>`).join('')}</select>
            <label class="chk"><input type="checkbox" data-f="highlight" ${it.highlight ? 'checked' : ''}> Highlight</label>
          </div>`;
        card.querySelectorAll('[data-f]').forEach((f) => {
          const ev = f.type === 'checkbox' || f.tagName === 'SELECT' ? 'onchange' : 'oninput';
          f[ev] = () => { it[f.dataset.f] = f.type === 'checkbox' ? f.checked : f.value; changed(false); };
        });
        card.querySelectorAll('[data-a]').forEach((b) => {
          b.onclick = () => {
            const a = b.dataset.a;
            if (a === 'del') data.items.splice(i, 1);
            if (a === 'up') [data.items[i - 1], data.items[i]] = [data.items[i], data.items[i - 1]];
            if (a === 'down') [data.items[i + 1], data.items[i]] = [data.items[i], data.items[i + 1]];
            changed(true);
          };
        });
        list.appendChild(card);
      });
      $('.add').disabled = data.items.length >= 8;
    }

    $('.add').onclick = () => {
      if (data.items.length >= 8) return;
      data.items.push({ label: 'New stat', value: '10', prefix: '', suffix: '%', delta: '', deltaLabel: '', icon: 'star', highlight: false });
      changed(true);
    };
    $('.reset').onclick = () => {
      data = structuredClone(DEFAULT_DATA);
      document.querySelectorAll('.editor .field input[data-k]').forEach((inp) => (inp.value = data[inp.dataset.k]));
      changed(true);
    };
    $('.export').onclick = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      a.download = 'stats.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    $('.import').onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const d = JSON.parse(await file.text());
        if (!Array.isArray(d.items)) throw new Error('missing items');
        data = Object.assign({ pace: 'normal', motion: 'rise', order: 'forward' }, d);
        document.querySelectorAll('.editor .field input[data-k]').forEach((inp) => (inp.value = data[inp.dataset.k] ?? ''));
        changed(true);
      } catch (err) { alert('Could not read that JSON: ' + err.message); }
    };

    document.querySelectorAll('.themes button').forEach((b) => {
      b.onclick = () => {
        const th = THEMES.find((x) => x.id === b.dataset.themeId);
        if (!th) return;
        theme = th;
        applyTheme(th);
        try { localStorage.setItem(THEME_KEY, th.id); } catch (_) { /* storage unavailable */ }
        document.querySelectorAll('.themes button').forEach((x) => x.classList.toggle('on', x === b));
        rebuild();
      };
    });

    renderEditor();
    fit();
    rebuild();
    requestAnimationFrame(tick);
  }

  window.StatsMotion = { mount, U, VARIANTS, DEFAULT_DATA, PACES, MOTIONS, ORDERS };
})();
