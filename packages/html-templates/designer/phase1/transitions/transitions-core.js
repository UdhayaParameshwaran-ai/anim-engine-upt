/* Scene Transitions — shared runtime.
 *
 * Ten VARIATIONS = ten different ways one scene gives way to the next (wipe, push, zoom, iris, slats, split, defocus,
 * cube, panel, ripple). Every variation plays the same two scenes, so the difference you see is the transition itself:
 *
 *   Scene A  →  [ transition ]  →  Scene B
 *
 * Each scene has a title, a subtitle and its own tint (base / tint / deep, all from the theme). While the transition
 * runs, the content inside each scene moves at its own speed (parallax), so the change has depth instead of being a
 * flat cut. When the new scene lands, its title words rise into place.
 *
 * Controls: Pace (Relaxed / Normal / Snappy), Direction (for the directional transitions), the two scenes' text and
 * tints. Colours, fonts and radii come from the active theme.
 *
 * Each variant page calls  Transitions.mount(id).  build() makes the DOM once and returns update(seconds): a pure
 * function of time, so the playhead can be scrubbed, looped or rendered frame by frame.
 */
(function () {
  'use strict';

  const F = 30;
  const W = 1920, H = 1080;
  const STORAGE_KEY = 'transitions-data-v1';

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
  const win = (t, a, d) => clamp((t - a) / Math.max(0.001, d));
  /** A smooth S that is gentler at both ends than inOut, for transitions that should feel buttery. */
  const silk = (k) => k * k * k * (k * (k * 6 - 15) + 10);

  const PACES = { relaxed: 1.35, normal: 1, snappy: 0.75 };
  const TINTS = [['base', 'Base'], ['tint', 'Tint'], ['deep', 'Deep']];
  const DIRS = [['left', 'Towards the left'], ['right', 'Towards the right'], ['up', 'Upwards'], ['down', 'Downwards']];

  const VARIANTS = [
    { id: 'wipe', file: 'v1-wipe.html', name: 'Wipe', dur: 1.2, dir: true,
      note: 'Wipe: the new scene is uncovered by a soft-edged line with a thin light leading it. The old content slides away a little under a slight blur while the new content slides in the other way.' },
    { id: 'push', file: 'v2-push.html', name: 'Push', dur: 1.3, dir: true,
      note: 'Push: the new scene pushes the old one out. The old one moves less than the new one and dims and shrinks as it goes, so the two scenes sit at different depths.' },
    { id: 'zoom', file: 'v3-zoom.html', name: 'Zoom through', dur: 1.5, dir: false,
      note: 'Zoom through: the camera flies into the old scene until it dissolves into blur, and the new scene grows out of the distance into focus.' },
    { id: 'iris', file: 'v4-iris.html', name: 'Iris', dur: 1.3, dir: false,
      note: 'Iris: a circle opens from the centre and the new scene fills it, with a thin ring on its edge. The old scene eases back as it is covered.' },
    { id: 'slats', file: 'v5-slats.html', name: 'Slats', dur: 1.5, dir: true,
      note: 'Slats: the new scene arrives in eight strips that open one after another, alternating up and down, in the direction you choose.' },
    { id: 'split', file: 'v6-split.html', name: 'Split', dur: 1.3, dir: true,
      note: 'Split: the old scene parts down the middle like doors, the halves sliding apart to uncover the new scene, which settles in from slightly larger.' },
    { id: 'defocus', file: 'v7-defocus.html', name: 'Defocus', dur: 1.5, dir: false,
      note: 'Defocus: the old scene drifts out of focus and fades while the new one pulls into focus, with a soft bloom in the middle. Calm and cinematic.' },
    { id: 'cube', file: 'v8-cube.html', name: 'Cube', dur: 1.4, dir: true,
      note: 'Cube: the two scenes are faces of a cube that turns in 3D; the new face swings to the front.' },
    { id: 'panel', file: 'v9-panel.html', name: 'Panel', dur: 1.5, dir: true,
      note: 'Panel: a block of theme colour sweeps across and fully covers the frame; the scene changes behind it, and the block sweeps on and away. The classic brand transition.' },
    { id: 'ripple', file: 'v10-ripple.html', name: 'Ripple', dur: 1.7, dir: false,
      note: 'Ripple: the old scene dissolves into the new one through a wave of distortion that swells at the middle of the change and calms again.' },
  ];

  const DEFAULT_DATA = {
    pace: 'normal', dir: 'left', hold: 1.0,
    a: { title: 'The problem', subtitle: 'Germs get past your first defences', tint: 'base' },
    b: { title: 'The *solution*', subtitle: 'A vaccine trains the response in advance', tint: 'deep' },
  };

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
  const wordsHTML = (words) => words.map((w) => `<span class="w"><span class="wi${w.acc ? ' acc' : ''}">${esc(w.t)}</span></span>`).join(' ');

  // ── Build ────────────────────────────────────────────────────────────────
  function build(stage, data, V) {
    const P = PACES[data.pace] || 1;
    const dir = V.dir ? data.dir : 'left';
    const dur = V.dur * P;
    const tT = 1.5 * P;                                          // when the transition starts
    const tEnd = tT + dur;
    const hold = Math.max(0.6, data.hold) * 1.4 * P;
    const duration = tEnd + hold + 0.4;
    const vx = dir === 'left' ? -1 : dir === 'right' ? 1 : 0;   // direction the scenes travel (content moves this way)
    const vy = dir === 'up' ? -1 : dir === 'down' ? 1 : 0;
    const set = (e, o) => { Object.assign(e.style, o); };

    /** One scene: background + content. `risers` are the title words that settle in. */
    const scene = (d, num) => {
      const sc = el('div', `sc sc-${d.tint}`);
      const bg = el('div', 'sc-bg');
      const c = el('div', 'tr-c');
      const words = parseWords(d.title);
      c.innerHTML = `<div class="tr-num">${num}</div><div class="tr-t">${wordsHTML(words)}</div>${d.subtitle ? `<div class="tr-s">${esc(d.subtitle)}</div>` : ''}`;
      sc.append(bg, c);
      return { el: sc, c, wis: [...c.querySelectorAll('.wi')], sub: c.querySelector('.tr-s'), num: c.querySelector('.tr-num') };
    };
    /** Titles rise into a scene one word after another, starting at `at`. */
    const settle = (sc, t, at) => {
      sc.wis.forEach((w, i) => { const e = expoOut(win(t, at + i * 0.09 * P, 0.85 * P)); w.style.transform = `translateY(${((1 - e) * 112).toFixed(1)}%)`; });
      if (sc.sub) { const e = expoOut(win(t, at + 0.45 * P, 0.8 * P)); sc.sub.style.opacity = e.toFixed(3); sc.sub.style.transform = `translateY(${((1 - e) * 18).toFixed(1)}px)`; }
      const n = expoOut(win(t, at - 0.1, 1.2 * P)); sc.num.style.opacity = (0.1 * n).toFixed(3);
    };
    /** Slow drift on a scene's content so nothing is ever still. */
    const drift = (sc, t, extraX = 0, extraY = 0, sx = 1) => { const k = clamp(t / 8); sc.c.style.transform = `translate(${(extraX - 10 * k).toFixed(1)}px, ${(extraY - 4 * k).toFixed(1)}px) scale(${((1 + 0.025 * k) * sx).toFixed(4)})`; };
    const blurOf = (e, px) => { e.style.filter = px > 0.3 ? `blur(${px.toFixed(1)}px)` : ''; };

    const A = scene(data.a, '01'), B = scene(data.b, '02');
    const q = (t) => win(t, tT, dur);                              // 0 → 1 across the transition

    // ── 1 · Wipe ──
    if (V.id === 'wipe') {
      stage.append(A.el, B.el);
      const bar = el('i', 'tr-edge'); stage.append(bar);
      const horiz = vx !== 0;
      return { duration, update(t) {
        const p = q(t), e = silk(p);
        const rev = 1 - e;
        // B is uncovered from the side the scenes are travelling towards
        B.el.style.clipPath = e >= 1 ? 'none' : horiz
          ? (vx < 0 ? `inset(0 0 0 ${rev * 100}%)` : `inset(0 ${rev * 100}% 0 0)`)
          : (vy < 0 ? `inset(${rev * 100}% 0 0 0)` : `inset(0 0 ${rev * 100}% 0)`);
        const on = p > 0 && p < 1;
        bar.style.opacity = on ? (Math.sin(p * Math.PI) * 1).toFixed(3) : '0';
        const st = bar.style;
        st.left = st.right = st.top = st.bottom = st.width = st.height = 'auto';
        if (horiz) { st.top = '0'; st.bottom = '0'; st.width = '10px'; st.left = vx < 0 ? `calc(${rev * 100}% - 5px)` : `calc(${e * 100}% - 5px)`; }
        else { st.left = '0'; st.right = '0'; st.height = '10px'; st.top = vy < 0 ? `calc(${rev * 100}% - 5px)` : `calc(${e * 100}% - 5px)`; }
        drift(A, t, vx * e * 70, vy * e * 70); blurOf(A.c, e * 5);
        drift(B, t, -vx * rev * 120, -vy * rev * 120);
        settle(A, t, 0.1); settle(B, t, tT + dur * 0.55);
      } };
    }

    // ── 2 · Push ──
    if (V.id === 'push') {
      stage.append(A.el, B.el);
      return { duration, update(t) {
        const p = q(t), e = expoOut(p) * 0.35 + silk(p) * 0.65;
        const rev = 1 - e;
        set(B.el, { transform: `translate(${(-vx * rev * 100).toFixed(2)}%, ${(-vy * rev * 100).toFixed(2)}%)`, boxShadow: p > 0 && p < 1 ? `${(vx * 90).toFixed(0)}px ${(vy * 90).toFixed(0)}px 160px rgba(0,0,0,.28)` : 'none' });
        set(A.el, { transform: `translate(${(vx * e * 36).toFixed(2)}%, ${(vy * e * 36).toFixed(2)}%) scale(${(1 - 0.06 * e).toFixed(4)})`, opacity: (1 - 0.55 * e).toFixed(3) });
        blurOf(A.el, e * 5);
        drift(A, t); drift(B, t, vx * rev * -60, vy * rev * -60);
        settle(A, t, 0.1); settle(B, t, tT + dur * 0.5);
      } };
    }

    // ── 3 · Zoom through ──
    if (V.id === 'zoom') {
      stage.append(B.el, A.el);
      return { duration, update(t) {
        const pa = silk(win(t, tT, dur * 0.72)), pb = silk(win(t, tT + dur * 0.28, dur * 0.72));
        set(A.el, { transform: `scale(${(1 + 3.2 * pa * pa).toFixed(4)})`, opacity: (1 - win(pa, 0.45, 0.55)).toFixed(3) });
        blurOf(A.el, pa * 22);
        set(B.el, { transform: `scale(${(0.8 + 0.2 * pb).toFixed(4)})`, opacity: clamp(pb * 2).toFixed(3) });
        blurOf(B.el, (1 - pb) * 16);
        drift(A, t); drift(B, t);
        settle(A, t, 0.1); settle(B, t, tT + dur * 0.6);
      } };
    }

    // ── 4 · Iris ──
    if (V.id === 'iris') {
      stage.append(A.el, B.el);
      const ring = el('i', 'tr-ring'); stage.append(ring);
      return { duration, update(t) {
        const p = q(t), e = silk(p) * 0.55 + expoOut(p) * 0.45;
        const r = e * 1300;
        B.el.style.clipPath = e >= 1 ? 'none' : `circle(${r.toFixed(1)}px at 50% 50%)`;
        set(ring, { width: `${(r * 2).toFixed(1)}px`, height: `${(r * 2).toFixed(1)}px`, opacity: (p > 0 && p < 0.97 ? 1 - win(p, 0.5, 0.5) : 0).toFixed(3) });
        set(A.el, { transform: `scale(${(1 - 0.07 * e).toFixed(4)})` }); blurOf(A.el, e * 4);
        drift(A, t); drift(B, t, 0, 0, 0.9 + 0.1 * e);
        settle(A, t, 0.1); settle(B, t, tT + dur * 0.5);
      } };
    }

    // ── 5 · Slats ──
    if (V.id === 'slats') {
      const N = 8;
      const horiz = vx !== 0;
      stage.append(A.el);
      const slats = Array.from({ length: N }, () => scene(data.b, '02'));
      slats.forEach((s) => stage.append(s.el));
      return { duration, update(t) {
        drift(A, t); settle(A, t, 0.1); blurOf(A.c, 0);
        slats.forEach((s, i) => {
          const order = (horiz ? vx < 0 : vy < 0) ? N - 1 - i : i;                 // first slat is the one the motion starts from
          const e = silk(win(t, tT + order * (dur * 0.07), dur * 0.52)), rev = (1 - e) * 100;
          const a0 = (i * 100) / N, a1 = 100 - ((i + 1) * 100) / N, up = i % 2 === 0;
          s.el.style.clipPath = e >= 1 && i === 0 ? 'none' : horiz
            ? (up ? `inset(${rev}% ${a1}% 0 ${a0}%)` : `inset(0 ${a1}% ${rev}% ${a0}%)`)
            : (up ? `inset(${a0}% ${rev}% ${a1}% 0)` : `inset(${a0}% 0 ${a1}% ${rev}%)`);
          s.el.style.visibility = e > 0 ? 'visible' : 'hidden';
          drift(s, t); settle(s, t, tT + dur * 0.6);
        });
      } };
    }

    // ── 6 · Split ──
    if (V.id === 'split') {
      stage.append(B.el);
      const A1 = scene(data.a, '01'), A2 = scene(data.a, '01');
      stage.append(A1.el, A2.el);
      const seam = el('i', 'tr-seam'); stage.append(seam);
      const hz = vy === 0;
      return { duration, update(t) {
        const p = q(t), e = silk(p);
        const m = e * 52;
        A1.el.style.clipPath = hz ? 'inset(0 50% 0 0)' : 'inset(0 0 50% 0)';
        A2.el.style.clipPath = hz ? 'inset(0 0 0 50%)' : 'inset(50% 0 0 0)';
        A1.el.style.transform = hz ? `translateX(${(-m).toFixed(2)}%)` : `translateY(${(-m).toFixed(2)}%)`;
        A2.el.style.transform = hz ? `translateX(${m.toFixed(2)}%)` : `translateY(${m.toFixed(2)}%)`;
        A1.el.style.visibility = A2.el.style.visibility = e >= 1 ? 'hidden' : 'visible';
        set(B.el, { transform: `scale(${(1.1 - 0.1 * e).toFixed(4)})` });
        set(seam, { opacity: (Math.sin(clamp(p) * Math.PI) * 0.9).toFixed(3), left: hz ? '50%' : '0', top: hz ? '0' : '50%', width: hz ? '3px' : '100%', height: hz ? '100%' : '3px', transform: hz ? 'translateX(-1.5px)' : 'translateY(-1.5px)' });
        [A1, A2].forEach((s) => { drift(s, t); settle(s, t, 0.1); });
        drift(B, t); settle(B, t, tT + dur * 0.55);
      } };
    }

    // ── 7 · Defocus ──
    if (V.id === 'defocus') {
      stage.append(B.el, A.el);
      return { duration, update(t) {
        const pa = silk(win(t, tT + dur * 0.1, dur * 0.7)), pb = silk(win(t, tT, dur * 0.8));
        const bloom = 1 + 0.22 * Math.sin(clamp(win(t, tT, dur)) * Math.PI);
        set(A.el, { opacity: (1 - pa).toFixed(3), transform: `scale(${(1 + 0.06 * pa).toFixed(4)})`, filter: `blur(${(pa * 24).toFixed(1)}px) brightness(${bloom.toFixed(3)})` });
        set(B.el, { opacity: pb.toFixed(3), transform: `scale(${(0.94 + 0.06 * pb).toFixed(4)})`, filter: `blur(${((1 - pb) * 24).toFixed(1)}px) brightness(${bloom.toFixed(3)})` });
        if (pa <= 0) A.el.style.filter = ''; if (pb >= 1) B.el.style.filter = '';
        drift(A, t); drift(B, t);
        settle(A, t, 0.1); settle(B, t, tT + dur * 0.5);
      } };
    }

    // ── 8 · Cube ──
    if (V.id === 'cube') {
      const persp = el('div', 'tr-persp'), cube = el('div', 'tr-cube');
      persp.append(cube); stage.append(persp);
      cube.append(A.el, B.el);
      const axisY = vx !== 0;
      const Z = axisY ? W / 2 : H / 2;
      const dirSign = axisY ? (vx < 0 ? -1 : 1) : (vy < 0 ? 1 : -1);             // sign of the cube's turn
      const face = axisY ? (vx < 0 ? 'rotateY(90deg)' : 'rotateY(-90deg)') : (vy < 0 ? 'rotateX(-90deg)' : 'rotateX(90deg)');
      A.el.style.transform = `translateZ(${Z}px)`;
      B.el.style.transform = `${face} translateZ(${Z}px)`;
      [A.el, B.el].forEach((e) => { e.style.backfaceVisibility = 'hidden'; });
      return { duration, update(t) {
        const e = silk(q(t));
        const ang = dirSign * 90 * e;
        cube.style.transform = `translateZ(${-Z}px) ${axisY ? 'rotateY' : 'rotateX'}(${ang.toFixed(3)}deg)`;
        const dim = 1 - 0.3 * Math.sin(clamp(q(t)) * Math.PI);
        A.el.style.filter = B.el.style.filter = dim < 0.995 ? `brightness(${dim.toFixed(3)})` : '';
        drift(A, t); drift(B, t);
        settle(A, t, 0.1); settle(B, t, tT + dur * 0.55);
      } };
    }

    // ── 9 · Panel ──
    if (V.id === 'panel') {
      stage.append(A.el, B.el);
      const panel = el('div', 'tr-panel'), sheen = el('i', 'tr-sheen'); panel.append(sheen); stage.append(panel);
      const horiz = vx !== 0, fwd = horiz ? vx < 0 : vy < 0;
      return { duration, update(t) {
        const p1 = silk(win(t, tT, dur * 0.52)), p2 = silk(win(t, tT + dur * 0.48, dur * 0.52));
        B.el.style.visibility = p1 >= 1 ? 'visible' : 'hidden';
        A.el.style.visibility = p1 >= 1 ? 'hidden' : 'visible';
        const cover = (p) => horiz ? (fwd ? `inset(0 0 0 ${(1 - p) * 100}%)` : `inset(0 ${(1 - p) * 100}% 0 0)`) : (fwd ? `inset(${(1 - p) * 100}% 0 0 0)` : `inset(0 0 ${(1 - p) * 100}% 0)`);
        const leave = (p) => horiz ? (fwd ? `inset(0 ${p * 100}% 0 0)` : `inset(0 0 0 ${p * 100}%)`) : (fwd ? `inset(0 0 ${p * 100}% 0)` : `inset(${p * 100}% 0 0 0)`);
        panel.style.clipPath = t < tT ? 'inset(0 0 0 100%)' : p1 < 1 ? cover(p1) : p2 < 1 ? leave(p2) : 'inset(0 0 0 100%)';
        sheen.style.transform = `translateX(${((horiz ? 1 : 0) * (-120 + 240 * (p1 < 1 ? p1 : p2))).toFixed(1)}%) translateY(${((horiz ? 0 : 1) * (-120 + 240 * (p1 < 1 ? p1 : p2))).toFixed(1)}%)`;
        drift(A, t); drift(B, t);
        settle(A, t, 0.1); settle(B, t, tT + dur * 0.72);
      } };
    }

    // ── 10 · Ripple ──
    if (V.id === 'ripple') {
      const ns = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.style.cssText = 'position:absolute';
      svg.innerHTML = '<defs><filter id="rip" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.004 0.01" numOctaves="2" seed="7" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="0" xChannelSelector="R" yChannelSelector="G"/></filter></defs>';
      stage.append(svg);
      const turb = svg.querySelector('feTurbulence'), disp = svg.querySelector('feDisplacementMap');
      const wrap = el('div', 'tr-wrap'); wrap.append(A.el, B.el); stage.append(wrap);
      return { duration, update(t) {
        const p = q(t), e = silk(p), s = Math.sin(clamp(p) * Math.PI);
        set(B.el, { opacity: silk(win(p, 0.2, 0.6)).toFixed(3) });
        disp.setAttribute('scale', (s * 48).toFixed(1));
        turb.setAttribute('baseFrequency', `${(0.003 + s * 0.0018).toFixed(5)} ${(0.008 + s * 0.004).toFixed(5)}`);
        wrap.style.filter = s > 0.01 ? 'url(#rip)' : '';
        wrap.style.transform = `scale(${(1 + 0.05 * s).toFixed(4)})`;
        void e;
        drift(A, t); drift(B, t);
        settle(A, t, 0.1); settle(B, t, tT + dur * 0.6);
      } };
    }
    return { duration, update() {} };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) { const d = JSON.parse(raw); if (d && d.a && d.b) return Object.assign({}, DEFAULT_DATA, d); }
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
    if (DIRS.some((d) => d[0] === params.get('dir'))) data.dir = params.get('dir');
    let t = Number(params.get('t')) || 0;
    let playing = !params.has('paused');
    let duration = 1;
    let update = () => {};

    const icons = {
      play: '<svg viewBox="0 0 16 16"><path d="M4 2.5v11l9-5.5z"/></svg>',
      pause: '<svg viewBox="0 0 16 16"><path d="M3.5 2h3v12h-3zM9.5 2h3v12h-3z"/></svg>',
      replay: '<svg viewBox="0 0 16 16"><path d="M8 3V0L4 4l4 4V5a4 4 0 1 1-4 4H2a6 6 0 1 0 6-6z"/></svg>',
    };
    const tintOpts = TINTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
    const sceneFields = (k, label) => `
          <h2>${label}</h2>
          <div class="field"><label>Title (*word* = accent colour)</label><input data-s="${k}.title"></div>
          <div class="field"><label>Subtitle</label><input data-s="${k}.subtitle"></div>
          <div class="field"><label>Tint</label><select data-s="${k}.tint">${tintOpts}</select></div>`;
    document.body.insertAdjacentHTML('afterbegin', `
      <header class="app-bar">
        <a class="back" href="index.html">← All variants</a>
        <h1>Scene Transitions · ${esc(variant.name)}</h1>
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
          <div class="field"><label>Pace · length of the change and the holds</label>
            <div class="seg" role="group" aria-label="Pace"><button data-pace="relaxed">Relaxed</button><button data-pace="normal">Normal</button><button data-pace="snappy">Snappy</button></div>
          </div>
          <div class="field dirf"><label>Direction ${variant.dir ? '' : '(this transition has none)'}</label><select data-o="dir" ${variant.dir ? '' : 'disabled'}>${DIRS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>
          ${sceneFields('a', 'Scene A')}
          ${sceneFields('b', 'Scene B')}
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

    const getS = (path) => path.split('.').reduce((o, k) => o[k], data);
    const setS = (path, v) => { const ks = path.split('.'); const last = ks.pop(); ks.reduce((o, k) => o[k], data)[last] = v; };
    function rebuild() {
      stage.innerHTML = '';
      const b = build(stage, data, variant);
      duration = b.duration; update = b.update;
      t = Math.min(t, duration);
      document.querySelectorAll('.seg [data-pace]').forEach((x) => x.classList.toggle('on', x.dataset.pace === data.pace));
      document.querySelectorAll('[data-s]').forEach((i) => { const v = String(getS(i.dataset.s) ?? ''); if (i.value !== v) i.value = v; });
      $('select[data-o=dir]').value = data.dir;
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
    document.querySelectorAll('[data-s]').forEach((i) => { const h = () => { setS(i.dataset.s, i.value); changed(); }; i.oninput = h; i.onchange = h; });
    $('select[data-o=dir]').onchange = (e) => { data.dir = e.target.value; changed(); };
    document.querySelectorAll('.seg [data-pace]').forEach((b) => { b.onclick = () => { data.pace = b.dataset.pace; changed(); }; });
    $('.reset').onclick = () => { data = structuredClone(DEFAULT_DATA); changed(); };
    $('.export').onclick = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      a.download = 'transitions.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    $('.import').onchange = async (e) => {
      const file = e.target.files[0]; if (!file) return;
      try { const d = JSON.parse(await file.text()); if (!d.a || !d.b) throw new Error('missing scenes'); data = Object.assign({}, DEFAULT_DATA, d); changed(); } catch (err) { alert('Could not read that JSON: ' + err.message); }
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

  window.Transitions = { mount, VARIANTS, DEFAULT_DATA };
})();
