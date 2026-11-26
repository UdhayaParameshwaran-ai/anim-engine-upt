/* Titles & Openers — shared runtime.
 *
 * Fourteen VARIATIONS = fourteen different ways a title scene opens (six fuller scenes, then the calm set of eight). They share the same content, so the difference you see is the motion:
 *   kicker · title · subtitle · byline · brand · icon
 * Wrap a word in *asterisks* to give it the accent colour/gradient.
 *
 * Pace (Relaxed / Normal / Snappy) stretches or tightens the intro, the hold and the play-out. "Play out" adds the exit
 * animation so the title leaves cleanly into the next scene. Colours, fonts and radii come from the active theme.
 *
 * Each variant page calls  Titles.mount(id).  build() makes the DOM once and returns update(seconds): a pure function of
 * time, so the playhead can be scrubbed, looped or rendered frame by frame.
 */
(function () {
  'use strict';

  const F = 30;
  const W = 1920, H = 1080;
  const STORAGE_KEY = 'titles-data-v1';

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

  // ── Maths ────────────────────────────────────────────────────────────────
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const expoOut = (k) => (k >= 1 ? 1 : 1 - Math.pow(2, -10 * k));
  const inOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
  const backOut = (k, s = 1.9) => { const c3 = s + 1; return 1 + c3 * Math.pow(k - 1, 3) + s * Math.pow(k - 1, 2); };
  const bounceOut = (x) => {
    const n1 = 7.5625, d1 = 2.75;
    if (x < 1 / d1) return n1 * x * x;
    if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
    if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
    return n1 * (x -= 2.625 / d1) * x + 0.984375;
  };
  /** Progress of a window: 0 before `a`, 1 after `a + d`. */
  const win = (t, a, d) => clamp((t - a) / Math.max(0.001, d));

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
  const iconSVG = (name, size, sw = 2, draw = 1) =>
    `<svg class="ic" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${(ICONS[name] || ICONS.star).map((sh) => shapeHTML(sh)).join('')}</svg>`;

  const PACES = { relaxed: 1.35, normal: 1, snappy: 0.72 };
  const BGS = [['auto', 'Variant default'], ['base', 'Base'], ['tint', 'Tint'], ['deep', 'Deep']];

  const VARIANTS = [
    { id: 'rise', file: 'v1-rise.html', name: 'Rise', bg: 'base', intro: 2.6,
      note: 'Rise: the kicker pops, the title words slide up from behind an invisible edge one after another, an accent rule draws under them, then the subtitle and byline settle in. The clean default opener.' },
    { id: 'curtain', file: 'v2-curtain.html', name: 'Curtain', bg: 'base', intro: 3.0,
      note: 'Curtain: two panels part to reveal the title behind them while its letters draw together from wide spacing. The panels close again on play-out. A theatrical opener.' },
    { id: 'logo', file: 'v3-logo.html', name: 'Logo reveal', bg: 'base', intro: 3.4,
      note: 'Logo reveal: a ring draws itself, the disc pops, the icon strokes in under a light sweep, then the name unfolds beside it. The title becomes a small line above and the subtitle a tagline below.' },
    { id: 'shine', file: 'v4-shine.html', name: 'Shine', bg: 'deep', intro: 2.8,
      note: 'Shine: the title resolves from a soft, oversized blur while a band of light sweeps across it, twice, with a slow glow pulse behind. Premium and calm.' },
    { id: 'card', file: 'v5-card.html', name: 'Card', bg: 'base', intro: 2.6,
      note: 'Card: a title card tilts up in 3D with an icon disc and a progress line that fills across the hold. Reads as a chapter or episode card; on play-out it tips away.' },
    { id: 'cinema', file: 'v6-cinema.html', name: 'Cinema', bg: 'deep', intro: 3.4,
      note: 'Cinema: letterbox bars slide in, the title tracks together very slowly under a slow push-in, a thin rule opens and the subtitle fades beneath. Quiet, filmic.' },
    { id: 'beam', file: 'v7-beam.html', name: 'Beam', bg: 'base', intro: 2.8, calm: true,
      note: 'Beam: a soft band of light travels across and the title is left sharp behind it, as if the light were writing it. One element, one motion.' },
    { id: 'weight', file: 'v8-weight.html', name: 'Weight wave', bg: 'base', intro: 3.0, calm: true,
      note: 'Weight wave: the letters start as hairlines and swell to full weight in a wave from left to right. Pure typography, nothing else moves.' },
    { id: 'elastic', file: 'v9-elastic.html', name: 'Elastic', bg: 'tint', intro: 2.6, calm: true,
      note: 'Elastic: letters snap in from tall and thin, springing out from the centre of the title, and settle with a tiny wobble.' },
    { id: 'depth', file: 'v10-depth.html', name: 'Depth', bg: 'deep', intro: 3.2, calm: true,
      note: 'Depth: each word arrives from far behind the screen, out of focus, and comes to rest; the words before it ease back so the frame has depth.' },
    { id: 'reel', file: 'v11-reel.html', name: 'Reel', bg: 'base', intro: 3.0, calm: true,
      note: 'Reel: every letter is a small mechanical reel that spins through other characters and slows to land on the right one, left to right.' },
    { id: 'liquid', file: 'v12-liquid.html', name: 'Liquid', bg: 'tint', intro: 3.0, calm: true,
      note: 'Liquid: the title forms out of a rippling distortion that calms into crisp letters, as if surfacing through water.' },
    { id: 'spot', file: 'v13-spot.html', name: 'Spotlight', bg: 'deep', intro: 3.0, calm: true,
      note: 'Spotlight: a pool of light travels along the dark title and leaves it lit behind it, then opens up over the whole line.' },
    { id: 'converge', file: 'v14-converge.html', name: 'Convergence', bg: 'base', intro: 3.0, calm: true,
      note: 'Convergence: three colour layers drift apart and slide together into one sharp title, like a print coming into register.' },
  ];

  const DEFAULT_DATA = {
    pace: 'normal', bg: 'auto', playout: true,
    kicker: 'Episode 01 · Biology',
    title: 'How vaccines *teach* your body',
    subtitle: 'A two-minute guide to how immunity is trained',
    byline: 'Dr. A. Rao · 2026',
    brand: 'Tandemloop',
    icon: 'shield',
  };

  /** "How vaccines *teach* your body" → [{t:'How',acc:false}, …]. */
  function parseWords(text) {
    let on = false;
    return String(text || '').trim().split(/\s+/).filter(Boolean).map((tok) => {
      const m = /^(\*)?(.*?)(\*)?([.,;:!?]*)$/.exec(tok);
      if (m[1]) on = true;
      const out = { t: (m[2] + m[4]) || tok.replace(/\*/g, ''), acc: on };
      if (m[3]) on = false;
      return out;
    });
  }
  const titleSize = (text) => {
    const n = String(text || '').replace(/\*/g, '').length;
    return n <= 16 ? 156 : n <= 28 ? 132 : n <= 44 ? 112 : 92;
  };
  const wordsHTML = (words, mask) => words.map((w) => `<span class="w${mask ? ' mask' : ''}"><span class="wi${w.acc ? ' acc' : ''}">${esc(w.t)}</span></span>`).join(' ');
  const charsHTML = (words) => words.map((w) => `<span class="w nb">${Array.from(w.t).map((c) => `<span class="ch${w.acc ? ' acc' : ''}">${esc(c)}</span>`).join('')}</span>`).join(' ');
  const kickerHTML = (d) => (d.kicker ? `<div class="tt-kicker">${d.icon ? `<span class="tt-ki">${iconSVG(d.icon, 28, 2.2)}</span>` : ''}<span>${esc(d.kicker)}</span></div>` : '');

  // ── The eight openers ───────────────────────────────────────────────────
  function build(stage, data, V) {
    const P = PACES[data.pace] || 1;
    const bg = data.bg !== 'auto' ? data.bg : V.bg;
    const words = parseWords(data.title);
    const fs = titleSize(data.title);
    const tIn = V.intro * P;
    const hold = 2.0 * P;
    const out = 0.8 * Math.max(0.8, P);
    const tOut = tIn + hold;
    const duration = tOut + (data.playout ? out : 0.4) + 0.3;
    const sceneEl = el('div', `sc sc-${bg}`);
    const bgEl = el('div', 'sc-bg');
    const root = el('div', 'tt-root');
    sceneEl.append(bgEl, root);
    stage.append(sceneEl);
    stage.style.setProperty('--ts', `${fs}px`);
    const xo = (t) => (data.playout ? inOut(win(t, tOut, out)) : 0);          // play-out progress
    const alive = (t) => 1 - xo(t);
    const drift = (t) => clamp(t / (duration + 2));                              // slow ambient push-in so the frame is never still

    // shared bits
    const sub = data.subtitle ? `<div class="tt-sub">${esc(data.subtitle)}</div>` : '';
    const by = data.byline ? `<div class="tt-by"><i></i>${esc(data.byline)}</div>` : '';

    const apply = (e, o) => { Object.assign(e.style, o); };

    // ── 1 · Rise ──
    if (V.id === 'rise') {
      const c = el('div', 'tt-c left');
      c.innerHTML = `${kickerHTML(data)}<div class="tt-title">${wordsHTML(words, true)}</div><i class="tt-rule"></i>${sub}${by}<div class="tt-ring"></div>`;
      root.append(c);
      const k = c.querySelector('.tt-kicker'), wis = [...c.querySelectorAll('.wi')], rule = c.querySelector('.tt-rule');
      const s = c.querySelector('.tt-sub'), b = c.querySelector('.tt-by'), ring = c.querySelector('.tt-ring');
      return { duration, update(t) {
        const a = alive(t), x = xo(t);
        root.style.transform = `scale(${(1 + 0.03 * drift(t)).toFixed(4)})`;
        if (k) { const p = backOut(win(t, 0.15 * P, 0.55 * P), 1.6); apply(k, { opacity: clamp(p * 2) * a, transform: `translateY(${(1 - p) * 20 - x * 24}px) scale(${0.85 + 0.15 * p})` }); }
        wis.forEach((w, i) => { const e = expoOut(win(t, (0.4 + i * 0.09) * P, 0.8 * P)); const e2 = expoOut(win(t, tOut + i * 0.05, 0.6)); w.style.transform = `translateY(${(1 - e) * 112 - (data.playout ? e2 * 112 : 0)}%) rotate(${(1 - e) * 4}deg)`; });
        rule.style.transform = `scaleX(${expoOut(win(t, (0.7 + words.length * 0.09) * P, 0.7 * P)) * a})`;
        if (s) { const p = expoOut(win(t, (1.2 + words.length * 0.08) * P, 0.8 * P)); apply(s, { opacity: p * a, transform: `translateY(${(1 - p) * 24 - x * 20}px)`, filter: p < 1 ? `blur(${(1 - p) * 6}px)` : '' }); }
        if (b) { const p = expoOut(win(t, (1.6 + words.length * 0.08) * P, 0.7 * P)); apply(b, { opacity: p * a, transform: `translateY(${(1 - p) * 16 - x * 16}px)` }); }
        ring.style.transform = `translate(${(1 - expoOut(win(t, 0.2, 1.6))) * 120}px, 0) rotate(${t * 4}deg) scale(${0.9 + 0.1 * expoOut(win(t, 0.2, 1.6))})`; ring.style.opacity = (expoOut(win(t, 0.2, 1.2)) * a * 0.9).toFixed(3);
      } };
    }

    // ── 3 · Curtain ──
    if (V.id === 'curtain') {
      const c = el('div', 'tt-c mid');
      c.innerHTML = `${kickerHTML(data)}<div class="tt-title wide">${charsHTML(words)}</div>${sub}`;
      root.append(c);
      const pl = el('div', 'cu cu-l'), pr = el('div', 'cu cu-r');
      sceneEl.append(pl, pr);
      const k = c.querySelector('.tt-kicker'), s = c.querySelector('.tt-sub'), chs = [...c.querySelectorAll('.ch')], ti = c.querySelector('.tt-title');
      return { duration, update(t) {
        const a = alive(t);
        root.style.transform = `scale(${(1.04 - 0.04 * expoOut(win(t, 0.3, 2.2)) + 0.02 * drift(t)).toFixed(4)})`;
        const open = expoOut(win(t, 0.35 * P, 1.3 * P)), close = data.playout ? expoOut(win(t, tOut + 0.05, 0.75)) : 0;
        const m = open * (1 - close);
        pl.style.transform = `translateX(${(-m * 101).toFixed(2)}%)`; pr.style.transform = `translateX(${(m * 101).toFixed(2)}%)`;
        const sp = expoOut(win(t, 0.55 * P, 1.7 * P));
        ti.style.letterSpacing = `${(0.3 * (1 - sp) - 0.02).toFixed(3)}em`;
        chs.forEach((ch, i) => { const p = expoOut(win(t, (0.7 + i * 0.012) * P, 0.9 * P)); ch.style.opacity = p.toFixed(3); ch.style.filter = p < 0.97 ? `blur(${((1 - p) * 8).toFixed(1)}px)` : ''; });
        if (k) { const p = expoOut(win(t, 1.4 * P, 0.7 * P)); apply(k, { opacity: p, transform: `translateY(${(1 - p) * 16}px)` }); }
        if (s) { const p = expoOut(win(t, 1.8 * P, 0.8 * P)); apply(s, { opacity: p, transform: `translateY(${(1 - p) * 20}px)` }); }
        void a;
      } };
    }

    // ── 4 · Logo reveal ──
    if (V.id === 'logo') {
      const c = el('div', 'tt-c mid');
      const R = 118;
      c.innerHTML = `<div class="lg-small">${esc(data.kicker || '')}</div>
        <div class="lg-row"><div class="lg-mark"><svg viewBox="0 0 240 240" width="240" height="240"><circle class="lg-ring" cx="120" cy="120" r="${R}" pathLength="1"/></svg><div class="lg-disc"><div class="lg-glyph">${iconSVG(data.icon, 104, 2)}</div><i class="lg-sweep"></i></div></div>
          <div class="lg-name"><span>${esc(data.brand || data.title)}</span></div></div>
        <div class="lg-tag">${esc(data.subtitle || '')}</div>`;
      root.append(c);
      const small = c.querySelector('.lg-small'), ring = c.querySelector('.lg-ring'), disc = c.querySelector('.lg-disc'), sweep = c.querySelector('.lg-sweep');
      const name = c.querySelector('.lg-name'), nameIn = name.firstChild, tag = c.querySelector('.lg-tag'), row = c.querySelector('.lg-row');
      const glyph = [...c.querySelectorAll('.lg-glyph path, .lg-glyph circle, .lg-glyph rect, .lg-glyph polygon')];
      let nw = 0;
      return { duration, update(t) {
        const a = alive(t), x = xo(t);
        if (!nw) nw = nameIn.offsetWidth + 24;
        root.style.transform = `scale(${(1 + 0.03 * drift(t)).toFixed(4)})`;
        ring.style.strokeDasharray = '1'; ring.style.strokeDashoffset = (1 - expoOut(win(t, 0.15 * P, 0.9 * P))).toFixed(4);
        const dp = backOut(win(t, 0.55 * P, 0.7 * P), 2.0);
        disc.style.transform = `scale(${(0.4 + 0.6 * dp).toFixed(4)})`; disc.style.opacity = clamp(dp * 2).toFixed(3);
        glyph.forEach((g) => { g.style.strokeDashoffset = (1 - expoOut(win(t, 0.8 * P, 0.9 * P))).toFixed(4); });
        sweep.style.transform = `translateX(${(-120 + 280 * inOut(win(t, 1.5 * P, 0.8 * P))).toFixed(1)}%) skewX(-20deg)`;
        const np = expoOut(win(t, 1.45 * P, 1.0 * P));
        name.style.width = `${(nw * np).toFixed(1)}px`; name.style.opacity = clamp(np * 3).toFixed(3);
        row.style.transform = `translateX(${(0).toFixed(1)}px)`;
        if (small.textContent) { const p = expoOut(win(t, 1.9 * P, 0.7 * P)); apply(small, { opacity: p, transform: `translateY(${(1 - p) * -14}px)` }); }
        const tp = expoOut(win(t, 2.2 * P, 0.8 * P)); apply(tag, { opacity: tp, transform: `translateY(${(1 - tp) * 18}px)` });
        c.style.opacity = a.toFixed(3); c.style.transform = `translateY(${-x * 30}px) scale(${1 - x * 0.04})`;
        c.style.filter = x > 0.05 ? `blur(${(x * 8).toFixed(1)}px)` : '';
      } };
    }

    // ── 5 · Shine ──
    if (V.id === 'shine') {
      const c = el('div', 'tt-c mid');
      c.innerHTML = `${kickerHTML(data)}<div class="tt-title shine"><span>${esc(data.title.replace(/\*/g, ''))}</span></div>${sub}<div class="sh-glow"></div>`;
      root.append(c);
      const k = c.querySelector('.tt-kicker'), ti = c.querySelector('.tt-title'), tsp = ti.firstChild, s = c.querySelector('.tt-sub'), glow = c.querySelector('.sh-glow');
      return { duration, update(t) {
        const a = alive(t), x = xo(t);
        root.style.transform = `scale(${(1 + 0.03 * drift(t)).toFixed(4)})`;
        const p = expoOut(win(t, 0.3 * P, 1.5 * P));
        ti.style.opacity = (p * a).toFixed(3);
        ti.style.transform = `scale(${(1.12 - 0.12 * p - x * 0.05).toFixed(4)})`;
        const bl = (1 - p) * 22 + x * 10; ti.style.filter = bl > 0.4 ? `blur(${bl.toFixed(1)}px)` : '';
        const sw1 = inOut(win(t, 1.5 * P, 1.1)), sw2 = inOut(win(t, tIn + 0.5 * P, 1.1));
        const sweep = sw1 > 0 && sw1 < 1 ? sw1 : sw2;
        tsp.style.backgroundPosition = `${(130 - 160 * sweep).toFixed(1)}% 0, 0 0`;
        if (k) { const q = expoOut(win(t, 0.1 * P, 0.7 * P)); apply(k, { opacity: q * a, transform: `translateY(${(1 - q) * -16}px)` }); }
        if (s) { const q = expoOut(win(t, 1.3 * P, 0.9 * P)); apply(s, { opacity: q * a, transform: `translateY(${(1 - q) * 18}px)`, filter: q < 1 ? `blur(${(1 - q) * 5}px)` : '' }); }
        glow.style.opacity = ((0.55 + 0.25 * Math.sin(t * 2)) * p * a).toFixed(3);
      } };
    }

    // ── 7 · Card ──
    if (V.id === 'card') {
      const c = el('div', 'tt-c mid');
      c.innerHTML = `<div class="cd-blob b1"></div><div class="cd-blob b2"></div>
        <div class="cd"><div class="cd-icon">${iconSVG(data.icon, 52, 2)}<i></i></div>${data.kicker ? `<div class="tt-kicker plain">${esc(data.kicker)}</div>` : ''}<div class="tt-title card">${wordsHTML(words, false)}</div>${sub}${by}<div class="cd-prog"><i></i></div></div>`;
      root.append(c);
      const card = c.querySelector('.cd'), pulse = c.querySelector('.cd-icon i'), prog = c.querySelector('.cd-prog i'), b1 = c.querySelector('.b1'), b2 = c.querySelector('.b2');
      const bits = [...c.querySelectorAll('.tt-kicker, .tt-title, .tt-sub, .tt-by')];
      return { duration, update(t) {
        const a = alive(t), x = xo(t);
        const p = backOut(win(t, 0.25 * P, 0.9 * P), 1.5), e = expoOut(win(t, 0.25 * P, 0.9 * P));
        card.style.opacity = (clamp(e * 2.5) * a).toFixed(3);
        card.style.transform = `perspective(1400px) rotateX(${((1 - p) * -38 + x * 30).toFixed(2)}deg) translateY(${((1 - e) * 140 - x * 40).toFixed(1)}px) scale(${(0.9 + 0.1 * p - x * 0.06).toFixed(4)})`;
        bits.forEach((b, i) => { const q = expoOut(win(t, (0.7 + i * 0.16) * P, 0.7 * P)); b.style.opacity = q.toFixed(3); b.style.transform = `translateY(${(1 - q) * 16}px)`; });
        const pp = win(t, 0.4 * P, 1.0); pulse.style.opacity = ((1 - pp) * 0.8).toFixed(3); pulse.style.transform = `scale(${(0.6 + 1.1 * expoOut(pp)).toFixed(3)})`;
        prog.style.transform = `scaleX(${win(t, 1.0 * P, Math.max(0.5, tOut - 1.0 * P)).toFixed(4)})`;
        b1.style.transform = `translate(${(Math.sin(t * 0.7) * 40).toFixed(1)}px, ${(Math.cos(t * 0.6) * 30).toFixed(1)}px)`; b2.style.transform = `translate(${(Math.cos(t * 0.5) * 50).toFixed(1)}px, ${(Math.sin(t * 0.8) * 30).toFixed(1)}px)`;
        b1.style.opacity = (e * a).toFixed(3); b2.style.opacity = (e * a).toFixed(3);
      } };
    }

    // ── 8 · Cinema ──
    if (V.id === 'cinema') {
      const c = el('div', 'tt-c mid');
      c.innerHTML = `<div class="tt-title cine">${charsHTML(words)}</div><i class="cn-rule"></i>${sub}`;
      root.append(c);
      const tb = el('div', 'cn-bar top'), bb = el('div', 'cn-bar bot'), leak = el('div', 'cn-leak');
      sceneEl.append(leak, tb, bb);
      if (data.byline || data.kicker) bb.innerHTML = `<span>${esc(data.kicker || '')}</span><span>${esc(data.byline || '')}</span>`;
      const ti = c.querySelector('.tt-title'), chs = [...c.querySelectorAll('.ch')], rule = c.querySelector('.cn-rule'), s = c.querySelector('.tt-sub');
      return { duration, update(t) {
        const a = alive(t), x = xo(t);
        root.style.transform = `scale(${(1 + 0.07 * clamp(t / (duration)) ).toFixed(4)})`;
        const bp = expoOut(win(t, 0.1 * P, 1.1 * P)) * (1 - x);
        tb.style.transform = `translateY(${((bp - 1) * 100).toFixed(2)}%)`; bb.style.transform = `translateY(${((1 - bp) * 100).toFixed(2)}%)`;
        ti.style.letterSpacing = `${(0.52 - 0.34 * expoOut(win(t, 0.5 * P, 2.6 * P))).toFixed(3)}em`;
        chs.forEach((ch, i) => { const p = expoOut(win(t, (0.7 + i * 0.03) * P, 1.4 * P)); ch.style.opacity = (p * a).toFixed(3); ch.style.filter = p < 0.97 ? `blur(${((1 - p) * 10).toFixed(1)}px)` : ''; });
        rule.style.transform = `scaleX(${(expoOut(win(t, 2.0 * P, 0.9 * P)) * a).toFixed(3)})`;
        if (s) { const p = expoOut(win(t, 2.4 * P, 0.9 * P)); apply(s, { opacity: p * a, transform: `translateY(${(1 - p) * 12}px)` }); }
        leak.style.transform = `translateX(${(-60 + 160 * inOut(win(t, 0.4, tOut))).toFixed(1)}%)`; leak.style.opacity = (0.8 * a).toFixed(3);
      } };
    }

    // ── The calm set: one focal point (the title) and one quiet subtitle. ──
    if (V.calm) {
      const plain = String(data.title || '').replace(/\*/g, '');
      const mk = (cls, inner) => { const c = el('div', 'tt-c mid'); c.innerHTML = `<div class="tt-title ${cls}">${inner}</div>${sub}`; root.append(c); return c; };
      const subFx = (c, t, at) => { const e = c.querySelector('.tt-sub'); if (!e) return; const p = expoOut(win(t, at * P, 0.9 * P)); apply(e, { opacity: p * alive(t), transform: `translateY(${(1 - p) * 16}px)`, filter: p < 1 ? `blur(${(1 - p) * 5}px)` : '' }); };
      const calmOut = (c, t) => { const x = xo(t); c.style.opacity = (1 - x).toFixed(3); c.style.transform = `translateY(${(-x * 26).toFixed(1)}px)`; c.style.filter = x > 0.05 ? `blur(${(x * 10).toFixed(1)}px)` : ''; };
      const camera = (t) => { root.style.transform = `scale(${(1 + 0.035 * drift(t)).toFixed(4)})`; };

      if (V.id === 'beam') {
        const c = mk('beam', `<span class="bm-t">${wordsHTML(words, false)}</span><i class="bm-band"></i>`);
        const ti = c.querySelector('.tt-title'), tt = c.querySelector('.bm-t'), band = c.querySelector('.bm-band');
        return { duration, update(t) {
          camera(t); calmOut(c, t);
          const p = inOut(win(t, 0.4 * P, 2.0 * P));
          const front = p * 118 - 9;                                       // % of the title width, the light runs a little ahead of the text
          ti.style.webkitMaskImage = ti.style.maskImage = `linear-gradient(90deg, #000 ${(front - 9).toFixed(2)}%, transparent ${front.toFixed(2)}%)`;
          tt.style.transform = `translateX(${((1 - p) * -26).toFixed(1)}px)`;
          band.style.left = `${(front).toFixed(2)}%`; band.style.opacity = (Math.sin(clamp(p) * Math.PI) * 0.95).toFixed(3);
          subFx(c, t, 2.1);
        } };
      }

      if (V.id === 'weight') {
        const c = mk('weight', charsHTML(words));
        const chs = [...c.querySelectorAll('.ch')]; let fixed = false;
        return { duration, update(t) {
          camera(t); calmOut(c, t);
          if (!fixed) { chs.forEach((ch) => { ch.style.fontWeight = '800'; ch.style.width = ''; }); chs.forEach((ch) => { ch.style.width = `${ch.offsetWidth}px`; }); fixed = true; }
          chs.forEach((ch, i) => {
            const s2 = inOut(win(t, (0.3 + i * 0.05) * P, 1.2 * P));
            ch.style.fontWeight = String(Math.round(100 + 700 * s2));
            ch.style.opacity = clamp(s2 * 3.2).toFixed(3);
            ch.style.transform = `translateY(${((1 - s2) * 18).toFixed(1)}px)`;
          });
          subFx(c, t, 0.4 + chs.length * 0.05 + 0.9);
        } };
      }

      if (V.id === 'elastic') {
        const c = mk('elastic', charsHTML(words));
        const chs = [...c.querySelectorAll('.ch')], n = chs.length;
        return { duration, update(t) {
          camera(t); calmOut(c, t);
          chs.forEach((ch, i) => {
            const rank = Math.abs(i - (n - 1) / 2);
            const k = win(t, (0.35 + rank * 0.055) * P, 1.3 * P);
            const f = k <= 0 ? 0 : 1 - Math.exp(-6.5 * k) * Math.cos(15 * k);           // springs past 1 and settles
            ch.style.opacity = clamp(k * 7).toFixed(3);
            ch.style.transformOrigin = '50% 100%';
            ch.style.transform = `scale(${(1 - (1 - f) * 0.55).toFixed(4)}, ${(1 + (1 - f) * 1.3).toFixed(4)})`;
          });
          subFx(c, t, 0.35 + n * 0.03 + 1.0);
        } };
      }

      if (V.id === 'depth') {
        const c = mk('depth', wordsHTML(words, false));
        const wis = [...c.querySelectorAll('.wi')];
        return { duration, update(t) {
          camera(t); calmOut(c, t);
          wis.forEach((w, i) => {
            const k = win(t, (0.3 + i * 0.32) * P, 1.5 * P), e = expoOut(k);
            const back = i + 1 < wis.length ? inOut(win(t, (0.3 + (i + 1) * 0.32) * P, 1.2 * P)) : 0;
            w.style.opacity = (clamp(k * 3) * (1 - 0.18 * back)).toFixed(3);
            w.style.transform = `perspective(900px) translateZ(0) rotateY(${((1 - e) * -28).toFixed(2)}deg) scale(${((0.1 + 0.9 * e) * (1 - 0.03 * back)).toFixed(4)})`;
            const bl = (1 - e) * 18 + back * 1.2; w.style.filter = bl > 0.3 ? `blur(${bl.toFixed(1)}px)` : '';
          });
          subFx(c, t, 0.3 + wis.length * 0.32 + 1.0);
        } };
      }

      if (V.id === 'reel') {
        const n = 8;
        const HASHCH = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';
        const wh = words.map((w, wi) => `<span class="w nb">${Array.from(w.t).map((ch, ci) => {
          const strip = Array.from({ length: n }, (_, j) => { const r = Math.floor(Math.abs(Math.sin((wi * 31 + ci * 7 + j) * 12.9898) * 43758.5453) % HASHCH.length); const g = HASHCH[r]; return `<span>${/[a-z]/.test(ch) ? g.toLowerCase() : g}</span>`; }).join('');
          return `<span class="rl${w.acc ? ' acc' : ''}"><span class="rl-s">${strip}<span>${esc(ch)}</span></span></span>`;
        }).join('')}</span>`).join(' ');
        const c = mk('reel', wh);
        const rls = [...c.querySelectorAll('.rl')]; let fixed = false;
        return { duration, update(t) {
          camera(t); calmOut(c, t);
          if (!fixed) {
            const sc2 = stage.getBoundingClientRect().width / W || 1;
            rls.forEach((r) => { const real = r.querySelector('.rl-s').lastChild, rg = document.createRange(); rg.selectNodeContents(real); r.style.width = `${(rg.getBoundingClientRect().width / sc2 + 1).toFixed(1)}px`; });
            fixed = true;
          }
          rls.forEach((r, i) => {
            const k = win(t, (0.3 + i * 0.05) * P, 1.5 * P), e = expoOut(k);
            r.firstChild.style.transform = `translateY(${(-e * n * 1.12).toFixed(4)}em)`;
            r.style.opacity = clamp(k * 6).toFixed(3);
            const bl = (1 - e) * 2.2; r.firstChild.style.filter = bl > 0.25 ? `blur(${bl.toFixed(1)}px)` : '';
          });
          subFx(c, t, 0.3 + rls.length * 0.05 + 1.1);
        } };
      }

      if (V.id === 'liquid') {
        const ns = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.style.cssText = 'position:absolute';
        svg.innerHTML = '<defs><filter id="liq" x="-10%" y="-30%" width="120%" height="160%"><feTurbulence type="fractalNoise" baseFrequency="0.008 0.02" numOctaves="2" seed="4" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="0" xChannelSelector="R" yChannelSelector="G"/></filter></defs>';
        stage.append(svg);
        const turb = svg.querySelector('feTurbulence'), disp = svg.querySelector('feDisplacementMap');
        const c = mk('liquid', wordsHTML(words, false));
        const ti = c.querySelector('.tt-title');
        return { duration, update(t) {
          camera(t); calmOut(c, t);
          const k = win(t, 0.3 * P, 2.4 * P), e = 1 - Math.pow(1 - k, 2.2);
          const amt = Math.pow(1 - e, 1.3) * 90 + (data.playout ? xo(t) * 40 : 0);
          disp.setAttribute('scale', amt.toFixed(1));
          turb.setAttribute('baseFrequency', `${(0.0035 + (1 - e) * 0.003 + Math.sin(t * 0.8) * 0.0005).toFixed(5)} ${(0.009 + (1 - e) * 0.006).toFixed(5)}`);
          ti.style.opacity = clamp(k * 3.5).toFixed(3);
          ti.style.filter = amt > 0.6 ? `url(#liq) blur(${((1 - e) * 5).toFixed(1)}px)` : '';
          subFx(c, t, 2.0);
        } };
      }

      if (V.id === 'spot') {
        const c = mk('spot', `<span class="sp-dim">${wordsHTML(words, false)}</span><span class="sp-lit">${wordsHTML(words, false)}</span>`);
        const lit = c.querySelector('.sp-lit'), ti = c.querySelector('.tt-title');
        let width = 0;
        return { duration, update(t) {
          camera(t); calmOut(c, t);
          if (!width) width = ti.offsetWidth;
          const p = inOut(win(t, 0.5 * P, 1.9 * P)), x = -300 + (width + 600) * p;
          const open = expoOut(win(t, 0.5 * P + 1.7 * P, 0.9 * P));
          const r = 320 + open * width * 0.8;
          const m = `radial-gradient(circle ${r.toFixed(0)}px at ${x.toFixed(0)}px 50%, #000 0%, #000 55%, transparent 100%), linear-gradient(90deg, #000 ${Math.max(0, x - 120).toFixed(0)}px, transparent ${Math.max(1, x).toFixed(0)}px)`;
          lit.style.webkitMaskImage = lit.style.maskImage = m;
          subFx(c, t, 2.4);
        } };
      }

      if (V.id === 'converge') {
        const c = mk('converge', `<span class="cv-main">${wordsHTML(words, false)}</span><span class="cv cv-a">${wordsHTML(words, false)}</span><span class="cv cv-b">${wordsHTML(words, false)}</span><span class="cv cv-c">${wordsHTML(words, false)}</span>`);
        const main = c.querySelector('.cv-main'), cvs = [...c.querySelectorAll('.cv')];
        const off = [[-1, 0], [0, 0.55], [1, 0]];
        return { duration, update(t) {
          camera(t); calmOut(c, t);
          const k = expoOut(win(t, 0.35 * P, 1.8 * P));
          const show = clamp(win(t, 0.3 * P, 0.5)) * (1 - inOut(win(t, 1.6 * P, 0.7)));
          cvs.forEach((e, i) => {
            e.style.transform = `translate(${(off[i][0] * (1 - k) * 110).toFixed(1)}px, ${(off[i][1] * (1 - k) * 90 * (i === 1 ? 1 : 0)).toFixed(1)}px) scale(${(1 + (1 - k) * 0.05 * (i - 1)).toFixed(4)})`;
            e.style.opacity = (0.78 * show).toFixed(3);
            const bl = (1 - k) * 9; e.style.filter = bl > 0.3 ? `blur(${bl.toFixed(1)}px)` : '';
          });
          main.style.opacity = inOut(win(t, 1.0 * P, 0.8)).toFixed(3);
          subFx(c, t, 2.1);
        } };
      }
    }
    return { duration, update() {} };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) { const d = JSON.parse(raw); if (d && typeof d.title === 'string') return Object.assign({}, DEFAULT_DATA, d); }
    } catch (_) { /* storage unavailable — fall back to defaults */ }
    return structuredClone(DEFAULT_DATA);
  }
  function save(data) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (_) { /* quota / private mode */ }
  }

  // ── Mount ────────────────────────────────────────────────────────────────
  function mount(variantId) {
    const variant = VARIANTS.find((v) => v.id === variantId) || VARIANTS[0];
    const params = new URLSearchParams(location.search);
    const embed = params.has('embed');
    if (embed) document.body.classList.add('embed');
    let theme = pickTheme(params);
    applyTheme(theme);

    let data = load();
    if (PACES[params.get('pace')]) data.pace = params.get('pace');
    if (BGS.some((b) => b[0] === params.get('bg'))) data.bg = params.get('bg');
    let t = Number(params.get('t')) || 0;
    let playing = !params.has('paused');
    let duration = 1;
    let update = () => {};

    const icons = {
      play: '<svg viewBox="0 0 16 16"><path d="M4 2.5v11l9-5.5z"/></svg>',
      pause: '<svg viewBox="0 0 16 16"><path d="M3.5 2h3v12h-3zM9.5 2h3v12h-3z"/></svg>',
      replay: '<svg viewBox="0 0 16 16"><path d="M8 3V0L4 4l4 4V5a4 4 0 1 1-4 4H2a6 6 0 1 0 6-6z"/></svg>',
    };
    document.body.insertAdjacentHTML('afterbegin', `
      <header class="app-bar">
        <a class="back" href="index.html">← All variants</a>
        <h1>Titles & Openers · ${esc(variant.name)}</h1>
        <nav class="variants">${VARIANTS.map((v) => `<a href="${v.file}" class="${v.id === variant.id ? 'on' : ''}">${v.name}</a>`).join('')}</nav>
        <nav class="themes" aria-label="Theme">${THEMES.map((th) => `<button data-theme-id="${th.id}" class="${th.id === theme.id ? 'on' : ''}" title="${esc(th.label)}"><i style="background:linear-gradient(135deg, ${th.swatch[1]} 50%, ${th.swatch[0]} 50%)"></i>${esc(th.label)}</button>`).join('')}</nav>
      </header>
      <main class="app">
        <section class="preview">
          <div class="viewport"><div class="stage"></div></div>
          <div class="controls">
            <button class="play" aria-label="Play or pause">${icons.pause}</button>
            <button class="replay" aria-label="Replay from start">${icons.replay}</button>
            <input class="scrub" type="range" min="0" max="1000" value="0" aria-label="Playhead">
            <span class="time">0.0s / 0.0s</span>
          </div>
          <p class="hint">${esc(variant.note)} Space = play/pause · ←/→ = step 1 frame (Shift = 10).</p>
        </section>
        <aside class="editor noimg">
          <h2>Motion</h2>
          <div class="field"><label>Pace · intro, hold and play-out</label>
            <div class="seg" role="group" aria-label="Pace"><button data-pace="relaxed">Relaxed</button><button data-pace="normal">Normal</button><button data-pace="snappy">Snappy</button></div>
          </div>
          <div class="duo">
            <div class="field"><label>Background</label><select data-o="bg">${BGS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>
            <label class="chk" style="margin-top:18px"><input type="checkbox" data-o="playout"> Play out</label>
          </div>
          <h2>Content <span class="cap">(*word* = accent colour)</span></h2>
          <div class="field"><label>Kicker</label><input data-k="kicker"></div>
          <div class="field"><label>Title</label><textarea rows="2" data-k="title"></textarea></div>
          <div class="field"><label>Subtitle</label><input data-k="subtitle"></div>
          <div class="field"><label>Byline</label><input data-k="byline"></div>
          <div class="field"><label>Brand (used by Logo reveal)</label><input data-k="brand"></div>
          <div class="field"><label>Icon</label><select data-k="icon">${ICON_NAMES.map((n) => `<option value="${n}">${n}</option>`).join('')}</select></div>
          <div class="row"><button class="btn export">Export JSON</button><label class="btn">Import<input class="import" type="file" accept="application/json" hidden></label><button class="btn reset">Reset</button></div>
        </aside>
      </main>`);

    const $ = (s) => document.querySelector(s);
    const viewport = $('.viewport'), stage = $('.stage'), scrub = $('.scrub'), timeEl = $('.time'), playBtn = $('.play');
    const fit = () => {
      const r = viewport.getBoundingClientRect();
      const s = Math.min(r.width / W, r.height / H);
      stage.style.transform = `translate(${(r.width - W * s) / 2}px, ${(r.height - H * s) / 2}px) scale(${s})`;
    };
    new ResizeObserver(fit).observe(viewport);

    function rebuild() {
      stage.innerHTML = '';
      const b = build(stage, data, variant);
      duration = b.duration; update = b.update;
      t = Math.min(t, duration);
      document.querySelectorAll('.seg [data-pace]').forEach((x) => x.classList.toggle('on', x.dataset.pace === data.pace));
      document.querySelectorAll('[data-k]').forEach((i) => { if (i.value !== String(data[i.dataset.k] ?? '')) i.value = data[i.dataset.k] ?? ''; });
      document.querySelectorAll('select[data-o]').forEach((i) => { i.value = data[i.dataset.o]; });
      $('input[data-o=playout]').checked = !!data.playout;
      render();
    }
    function render() {
      update(t);
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

    let pending = 0;
    const changed = () => { save(data); cancelAnimationFrame(pending); pending = requestAnimationFrame(() => { t = 0; playing = true; rebuild(); }); };
    document.querySelectorAll('[data-k]').forEach((i) => { i.oninput = () => { data[i.dataset.k] = i.value; changed(); }; });
    document.querySelectorAll('select[data-o]').forEach((i) => { i.onchange = () => { data[i.dataset.o] = i.value; changed(); }; });
    $('input[data-o=playout]').onchange = (e) => { data.playout = e.target.checked; changed(); };
    document.querySelectorAll('.seg [data-pace]').forEach((b) => { b.onclick = () => { data.pace = b.dataset.pace; changed(); }; });
    $('.reset').onclick = () => { data = structuredClone(DEFAULT_DATA); changed(); };
    $('.export').onclick = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      a.download = 'titles.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    $('.import').onchange = async (e) => {
      const file = e.target.files[0]; if (!file) return;
      try { const d = JSON.parse(await file.text()); if (typeof d.title !== 'string') throw new Error('missing title'); data = Object.assign({}, DEFAULT_DATA, d); changed(); } catch (err) { alert('Could not read that JSON: ' + err.message); }
    };
    document.querySelectorAll('.themes button').forEach((b) => {
      b.onclick = () => {
        const th = THEMES.find((x) => x.id === b.dataset.themeId); if (!th) return;
        theme = th; applyTheme(th);
        try { localStorage.setItem(THEME_KEY, th.id); } catch (_) { /* storage unavailable */ }
        document.querySelectorAll('.themes button').forEach((x) => x.classList.toggle('on', x === b));
        rebuild();
      };
    });
    fit(); rebuild(); requestAnimationFrame(tick);
  }

  window.Titles = { mount, VARIANTS, DEFAULT_DATA };
})();
