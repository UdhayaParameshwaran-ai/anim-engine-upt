/* Process Steps · Motion set — shared runtime (copied from ../process-steps/steps-core.js). Changes: the variant list,
 * the Comes-in / Order pickers removed (each variant owns its motion), and mount() accepts a variant's own build() + duration().
 *
 *
 * FAITHFUL TO THE REMOTION COMPONENT (src/components/diagrams/ProcessSteps.tsx): the six layouts (chevrons, row, zigzag, staircase,
 * arch, list) copy its geometry, type sizes, stroke and timings (steps 14 frames apart, circle pop on the "bouncy" spring, labels
 * rise on "snappy", arrows draw in the gap before the next step). Spring curves are sampled from Remotion's own spring() with the
 * same configs as src/motion/motion.ts, so the easing is the real one.
 *
 * The component's "active step" highlight (active / activeAt) is not in this preview.
 *
 * Each variant page calls  StepsMotion.mount({ id, name, layout, note })  and the core builds that layout.
 * build() makes the DOM once and returns update(frame): a pure function of the frame (30 fps), so the playhead can be
 * scrubbed, looped or rendered frame by frame.
 *
 * Three controls shape every variant:
 *   Comes in — layout default · rise · from left / right / top / bottom · pop · slam · fade  (the component's `entrance`)
 *   Order    — first→last · last→first · centre out · all together                          (the component's `order`)
 *   Pace     — Relaxed / Normal / Snappy: changes the GAP between steps and the HOLD afterwards.
 *              Entrances keep their fixed lengths (the time-stretch rule).
 */
(function () {
  'use strict';

  const F = 30;
  const SPR = {"smooth":[0,0.0446,0.1443,0.2642,0.3849,0.4963,0.594,0.6768,0.7452,0.8009,0.8454,0.8807,0.9084,0.93,0.9467,0.9596,0.9694,0.9769,0.9826,0.987,0.9902,0.9927,0.9946,0.9959,0.997,0.9978,0.9983,0.9988,0.9991,0.9993,0.9995,0.9996,0.9997,0.9998,0.9999,0.9999,0.9999,0.9999,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],"snappy":[0,0.1124,0.3305,0.5483,0.7235,0.8475,0.9268,0.9728,0.9965,1.0067,1.0094,1.0087,1.0067,1.0046,1.0029,1.0016,1.0008,1.0003,1.0001,0.9999,0.9999,0.9999,0.9999,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],"bouncy":[0,0.0852,0.2879,0.5365,0.7758,0.9708,1.1053,1.1779,1.1978,1.1795,1.1387,1.0894,1.0423,1.0042,0.9782,0.9644,0.9609,0.9648,0.973,0.9828,0.992,0.9995,1.0045,1.0071,1.0077,1.0069,1.0053,1.0033,1.0015,1,0.9991,0.9986,0.9985,0.9986,0.999,0.9994,0.9997,1,1.0002,1.0003,1.0003,1.0003,1.0002,1.0001,1.0001,1,1,0.9999,0.9999,0.9999,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]};

  let VARIANTS = [
    { id: 'morph', file: 'v1-morph-relay.html', name: 'Morph Relay' },
    { id: 'deck', file: 'v2-card-deck.html', name: 'Card Deck' },
    { id: 'accordion', file: 'v3-accordion-focus.html', name: 'Accordion Focus' },
    { id: 'orbit', file: 'v4-orbit.html', name: 'Orbit' },
    { id: 'stack', file: 'v5-block-stack.html', name: 'Block Stack' },
    { id: 'domino', file: 'v6-domino-chain.html', name: 'Domino Chain' },
    { id: 'path', file: 'v1-path-walker.html', name: 'Path Walker' },
    { id: 'dolly', file: 'v6-dolly-pan.html', name: 'Dolly Pan' },
    { id: 'rail', file: 'v3-number-rail.html', name: 'Number Rail' },
  ];
  let STORAGE_KEY = 'process-steps-data-v1';
  const PACES = { relaxed: { stagger: 1.6, hold: 1.5 }, normal: { stagger: 1, hold: 1 }, snappy: { stagger: 0.6, hold: 0.7 } };
  const MOTIONS = [['default', 'Layout default'], ['rise', 'Rise'], ['left', 'From left'], ['right', 'From right'], ['top', 'From top'], ['bottom', 'From bottom'], ['pop', 'Pop'], ['slam', 'Slam'], ['fade', 'Fade']];
  const ORDERS = [['forward', 'First → last'], ['reverse', 'Last → first'], ['centre', 'Centre out'], ['together', 'All together']];

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

  const DISTANCE = 160;   // DIRECTION_DISTANCE in src/motion/motion.ts

  const U = {
    W, H, F, ICON_NAMES,
    icon: (name, size = 24, sw = 2) =>
      `<svg class="ic" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${(ICONS[name] || ICONS.star).map(shapeHTML).join('')}</svg>`,
    clamp: (v, a = 0, b = 1) => Math.min(b, Math.max(a, v)),
    lerp: (a, b, k) => a + (b - a) * k,
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; },
    stroke: 4,
    space: (n) => n * 8,
    sp,
    prog: (f, start, name = 'smooth') => sp(name, f - start),
    lin: (f, start, dur) => U.clamp((f - start) / Math.max(1, dur)),
    /** Which spring a motion uses (slam is crisp, the rest smooth). */
    springOf: (motion) => (motion === 'slam' ? 'snappy' : 'smooth'),
    /** Position of item i in the entrance order (same as staggerRank in motion.ts). */
    rank(i, n, order) {
      if (order === 'reverse') return n - 1 - i;
      if (order === 'together') return 0;
      if (order === 'centre') { const c = (n - 1) / 2; return [...Array(n).keys()].sort((a, b) => Math.abs(a - c) - Math.abs(b - c) || a - b).indexOf(i); }
      return i;
    },
    /** Pop (bouncy) and rise (snappy), as popAt / riseAt in diagrams/shared.tsx. */
    pop: (f, at) => ({ scale: 0.6 + 0.4 * sp('bouncy', f - at), opacity: U.lin(f, at, 5) }),
    rise: (f, at) => ({ shift: 1 - sp('snappy', f - at), opacity: U.lin(f, at, 8) }),
    /** The extra move on top of the layout's own entrance (identity for 'default'): {x, y, s, o}. */
    lift(motion, f, at) {
      if (motion === 'default') return { x: 0, y: 0, s: 1, o: 1 };
      const p = sp(U.springOf(motion), f - at), q = 1 - p;
      switch (motion) {
        case 'left': return { x: -q * DISTANCE, y: 0, s: 1, o: p };
        case 'right': return { x: q * DISTANCE, y: 0, s: 1, o: p };
        case 'top': return { x: 0, y: -q * DISTANCE, s: 1, o: p };
        case 'bottom': return { x: 0, y: q * DISTANCE, s: 1, o: p };
        case 'pop': return { x: 0, y: 0, s: 0.6 + 0.4 * p, o: Math.min(1, p * 2) };
        case 'slam': return { x: 0, y: 0, s: 1.6 - 0.6 * p, o: Math.min(1, p * 3) };
        case 'rise': return { x: 0, y: q * 40, s: 1, o: p };
        default: return { x: 0, y: 0, s: 1, o: p };
      }
    },
    /** CSS transform for a lift, with an optional leading transform. */
    css: (l, extra = '') => `${extra} translate(${l.x}px, ${l.y}px) scale(${l.s})`.trim(),

    /** Scene heading, same layout as the Story Studio scene header: kicker + headline at the top left. */
    head(stage, data) {
      const h = U.el('div', 'hd', `<div class="hd-k">${U.esc(data.kicker)}</div><div class="hd-h">${U.esc(data.heading)}</div>`);
      stage.append(h);
      return (f) => { const p = 1 - Math.pow(1 - U.lin(f, 2, 18), 3); h.style.opacity = p; h.style.transform = `translateY(${(1 - p) * 14}px)`; };
    },
  };

  const START = 10;                       // startFrame used by the Studio previews
  const stagger = (P) => Math.max(1, Math.round(14 * P.stagger));

  /** Timing shared by every layout. */
  function timing(n, o) {
    const gap = stagger(o.P);
    const stepAt = (i) => START + 4 + U.rank(i, n, o.order) * (o.order === 'together' ? 0 : gap);
    const late = o.order !== 'forward' || o.motion !== 'default';     // arrows draw as the later step arrives
    const arrowAt = (i) => (late ? Math.max(stepAt(i), stepAt(i + 1)) : stepAt(i)) + 5;
    const arrowLen = Math.max(gap - 5, 8);
    return { stepAt, arrowAt, arrowLen, gap };
  }
  const durationOf = (n, P, order) => START + 4 + (order === 'together' ? 0 : Math.max(0, n - 1) * stagger(P)) + 36 + Math.round(70 * P.hold);

  const titleHTML = (s, size) => `<div class="sp-title" style="font-size:${size}px">${U.esc(s.title)}</div>`;
  const detailHTML = (s, size) => (s.detail ? `<div class="sp-detail" style="font-size:${size}px">${U.esc(s.detail)}</div>` : '');
  const arrowHead = (x, y, a, len) => {
    const bx = x - Math.cos(a) * len, by = y - Math.sin(a) * len, px = -Math.sin(a) * len * 0.55, py = Math.cos(a) * len * 0.55;
    return `${x},${y} ${bx + px},${by + py} ${bx - px},${by - py}`;
  };

  // ── Layout: chevron pipeline ─────────────────────────────────────────────
  function buildChevrons(stage, data, o) {
    const steps = data.items, n = steps.length, T = timing(n, o);
    const w = 1728, h = 520;
    const hasDetail = steps.some((s) => s.detail);
    const labelH = 24 * 1.25 * 2 + (hasDetail ? 20 * 1.25 * 2 + 4 : 0), labelGap = 16;
    const gap = 12, bandH = Math.min(144, h * 0.4), notch = bandH * 0.3;
    const cw = (w + (n - 1) * (notch - gap)) / n;
    const top = Math.max(0, (h - bandH - labelGap - (hasDetail ? labelH / 2 : 0)) / 2);

    const head = U.head(stage, data);
    const place = U.el('div', 'place'); place.style.cssText = `left:96px;top:320px;width:${w}px;height:${h}px`;
    const polys = steps.map((_, i) => {
      const x = i * (cw - notch + gap);
      const left = i === 0 ? `${x},${top} ` : `${x},${top} ${x + notch},${top + bandH / 2} `;
      return `<polygon points="${left}${x},${top + bandH} ${x + cw - notch},${top + bandH} ${x + cw},${top + bandH / 2} ${x + cw - notch},${top}" fill="var(--surface)" stroke="var(--border)" stroke-width="${U.stroke}" stroke-linejoin="round"/>`;
    }).join('');
    place.innerHTML = `<svg width="${w}" height="${h}" style="position:absolute;left:0;top:0;overflow:visible">${polys}</svg>` + steps.map((s, i) => {
      const x = i * (cw - notch + gap);
      const inner = x + (i === 0 ? 16 : notch + 8), innerW = x + cw - notch - inner;
      return `<div class="sp-step"><div class="sp-band" style="left:${inner}px;top:${top}px;width:${innerW}px;height:${bandH}px">
          <div class="sp-idx">${s.icon ? U.icon(s.icon, 24) : ''}${String(i + 1).padStart(2, '0')}</div>${titleHTML(s, 24)}</div>
        ${s.detail ? `<div class="sp-det" style="left:${x + (i === 0 ? 0 : notch / 2)}px;top:${top + bandH + labelGap}px;width:${cw - notch - 16}px">${detailHTML(s, 20)}</div>` : ''}</div>`;
    }).join('');
    stage.append(place);
    const polyEls = [...place.querySelectorAll('polygon')], stepEls = [...place.querySelectorAll('.sp-step')];
    polyEls.forEach((p) => { p.style.transformBox = 'fill-box'; p.style.transformOrigin = 'center'; });

    return function update(f) {
      head(f);
      steps.forEach((_, i) => {
        const at = T.stepAt(i), r = U.rise(f, at), l = U.lift(o.motion, f, at);
        polyEls[i].style.opacity = r.opacity * l.o;
        polyEls[i].style.transform = U.css(l, `translateX(${-r.shift * 40}px)`);
        stepEls[i].style.opacity = r.opacity * l.o;
        stepEls[i].style.transform = U.css(l, `translateX(${-r.shift * 40}px)`);
      });
    };
  }

  // ── Layout: circle nodes with arrows (row · zigzag · staircase · arch) ───
  function buildCircles(layout, stage, data, o) {
    const steps = data.items, n = steps.length, T = timing(n, o);
    const w = 1728, h = 560, slot = w / n;
    const hasDetail = steps.some((s) => s.detail);
    const labelH = 24 * 1.25 * 2 + (hasDetail ? 20 * 1.25 * 2 + 4 : 0), labelGap = 16;
    const R = U.clamp(slot * 0.2, 36, 56), labelW = Math.min(slot - 24, 320);
    const cyTop = R + U.stroke, cyBottom = h - labelH - labelGap - R, cyMid = (cyTop + cyBottom) / 2, span = Math.max(0, cyBottom - cyTop);
    const tOf = (i) => (n === 1 ? 0.5 : i / (n - 1));
    const yOf = (i) => {
      if (layout === 'zigzag') { const amp = Math.min(span / 2, 112); return cyMid + (i % 2 === 0 ? -amp : amp); }
      if (layout === 'staircase') { const rise = Math.min(span, 416); return cyMid + rise / 2 - rise * tOf(i); }
      if (layout === 'arch') { const rise = Math.min(span, 288); return cyMid + rise / 2 - rise * Math.sin(Math.PI * tOf(i)); }
      return cyMid;
    };
    const xOf = (i) => slot * (i + 0.5);

    const head = U.head(stage, data);
    const place = U.el('div', 'place'); place.style.cssText = `left:96px;top:300px;width:${w}px;height:${h}px`;

    let svg = '';
    for (let i = 0; i < n - 1; i++) {
      const [x1, y1, x2, y2] = [xOf(i), yOf(i), xOf(i + 1), yOf(i + 1)];
      const dist = Math.hypot(x2 - x1, y2 - y1), bulge = layout === 'arch' ? dist * 0.12 : 0;
      const nx = (y2 - y1) / dist, ny = -(x2 - x1) / dist;
      const qx = (x1 + x2) / 2 + nx * bulge, qy = (y1 + y2) / 2 + ny * bulge;
      const a1 = Math.atan2(qy - y1, qx - x1), a2 = Math.atan2(y2 - qy, x2 - qx), headLen = U.stroke * 4;
      const sx = x1 + Math.cos(a1) * (R + 12), sy = y1 + Math.sin(a1) * (R + 12);
      const tipX = x2 - Math.cos(a2) * (R + 12), tipY = y2 - Math.sin(a2) * (R + 12);
      const ex = tipX - Math.cos(a2) * headLen * 0.7, ey = tipY - Math.sin(a2) * headLen * 0.7;
      svg += `<g class="arr"><path d="M ${sx} ${sy} Q ${qx} ${qy} ${ex} ${ey}" fill="none" stroke="var(--muted)" stroke-width="${U.stroke}" stroke-linecap="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/><polygon points="${arrowHead(tipX, tipY, a2, headLen)}" fill="var(--muted)" opacity="0"/></g>`;
    }
    steps.forEach((_, i) => { svg += `<circle class="nd" cx="${xOf(i)}" cy="${yOf(i)}" r="${R}" fill="var(--surface)" stroke="var(--primary)" stroke-width="${U.stroke}"/>`; });
    place.innerHTML = `<svg width="${w}" height="${h}" style="position:absolute;left:0;top:0;overflow:visible">${svg}</svg>` + steps.map((s, i) => {
      const x = xOf(i), y = yOf(i), fs = Math.round(U.lerp(32, 40, (R - 36) / 20));
      return `<div class="sp-num" style="left:${x - R}px;top:${y - R}px;width:${R * 2}px;height:${R * 2}px;font-size:${fs}px">${s.icon ? U.icon(s.icon, R * 0.9, 2) : i + 1}</div>
        <div class="sp-lab" style="left:${x - labelW / 2}px;top:${y + R + labelGap}px;width:${labelW}px">
          <div class="sp-title">${s.icon ? `<span class="sp-n">${i + 1}. </span>` : ''}${U.esc(s.title)}</div>${s.detail ? `<div class="sp-detail" style="margin-top:4px">${U.esc(s.detail)}</div>` : ''}</div>`;
    }).join('');
    stage.append(place);
    const arrows = [...place.querySelectorAll('.arr')], nodes = [...place.querySelectorAll('.nd')], nums = [...place.querySelectorAll('.sp-num')], labs = [...place.querySelectorAll('.sp-lab')];
    nodes.forEach((c) => { c.style.transformBox = 'fill-box'; c.style.transformOrigin = 'center'; });

    return function update(f) {
      head(f);
      arrows.forEach((g, i) => {
        const p = U.lin(f, T.arrowAt(i), T.arrowLen);
        g.querySelector('path').style.strokeDashoffset = 1 - p;
        g.querySelector('polygon').setAttribute('opacity', U.lin(f, T.arrowAt(i) + T.arrowLen - 3, 3));
      });
      steps.forEach((_, i) => {
        const at = T.stepAt(i), pop = U.pop(f, at), lab = U.rise(f, at + 4), l = U.lift(o.motion, f, at);
        nodes[i].setAttribute('r', R * pop.scale);
        nodes[i].style.opacity = pop.opacity * l.o;
        nodes[i].style.transform = U.css(l);
        nums[i].style.opacity = pop.opacity * l.o;
        nums[i].style.transform = U.css(l, `scale(${pop.scale})`);
        labs[i].style.opacity = lab.opacity * l.o;
        labs[i].style.transform = U.css(l, `translateY(${lab.shift * 16}px)`);
      });
    };
  }

  // ── Layout: vertical list ────────────────────────────────────────────────
  function buildList(stage, data, o) {
    const steps = data.items, n = steps.length, T = timing(n, o);
    const w = 1728, h = 640;
    const rowH = Math.min(h / n, 160), R = U.clamp(rowH * 0.3, 28, 44), top0 = (h - rowH * n) / 2;
    const cx = R + U.stroke, textX = cx + R + 24;
    const cyOf = (i) => top0 + rowH * (i + 0.5);

    const head = U.head(stage, data);
    const place = U.el('div', 'place'); place.style.cssText = `left:96px;top:290px;width:${w}px;height:${h}px`;
    let svg = '';
    for (let i = 0; i < n - 1; i++) {
      svg += `<path class="ln" d="M ${cx} ${cyOf(i) + R + 8} L ${cx} ${cyOf(i + 1) - R - 8}" fill="none" stroke="var(--muted)" stroke-width="${U.stroke}" stroke-linecap="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/>`;
    }
    steps.forEach((_, i) => { svg += `<circle class="nd" cx="${cx}" cy="${cyOf(i)}" r="${R}" fill="var(--surface)" stroke="var(--primary)" stroke-width="${U.stroke}"/>`; });
    place.innerHTML = `<svg width="${w}" height="${h}" style="position:absolute;left:0;top:0;overflow:visible">${svg}</svg>` + steps.map((s, i) =>
      `<div class="sp-num" style="left:${cx - R}px;top:${cyOf(i) - R}px;width:${R * 2}px;height:${R * 2}px;font-size:32px">${s.icon ? U.icon(s.icon, R * 0.9, 2) : i + 1}</div>
       <div class="sp-row" style="left:${textX}px;top:${cyOf(i) - rowH / 2}px;width:${w - textX}px;height:${rowH}px">${titleHTML(s, 32)}${detailHTML(s, 24)}</div>`).join('');
    stage.append(place);
    const lines = [...place.querySelectorAll('.ln')], nodes = [...place.querySelectorAll('.nd')], nums = [...place.querySelectorAll('.sp-num')], rows = [...place.querySelectorAll('.sp-row')];
    nodes.forEach((c) => { c.style.transformBox = 'fill-box'; c.style.transformOrigin = 'center'; });

    return function update(f) {
      head(f);
      lines.forEach((p, i) => { p.style.strokeDashoffset = 1 - U.lin(f, T.arrowAt(i), T.arrowLen); });
      steps.forEach((_, i) => {
        const at = T.stepAt(i), pop = U.pop(f, at), row = U.rise(f, at + 4), l = U.lift(o.motion, f, at);
        nodes[i].setAttribute('r', R * pop.scale);
        nodes[i].style.opacity = pop.opacity * l.o;
        nodes[i].style.transform = U.css(l);
        nums[i].style.opacity = pop.opacity * l.o;
        nums[i].style.transform = U.css(l, `scale(${pop.scale})`);
        rows[i].style.opacity = row.opacity * l.o;
        rows[i].style.transform = U.css(l, `translateX(${-row.shift * 40}px)`);
      });
    };
  }

  const BUILD = {
    chevrons: (stage, data, o) => buildChevrons(stage, data, o),
    list: (stage, data, o) => buildList(stage, data, o),
  };
  ['row', 'zigzag', 'staircase', 'arch'].forEach((l) => { BUILD[l] = (stage, data, o) => buildCircles(l, stage, data, o); });

  let DEFAULT_DATA = {
    pace: 'normal', motion: 'default', order: 'forward',
    kicker: 'How it works',
    heading: 'From injection to protection',
    items: [
      { title: 'Inject', detail: 'A harmless piece of the virus enters the arm', icon: 'send' },
      { title: 'Detect', detail: 'Immune cells spot the unfamiliar shape', icon: 'search' },
      { title: 'Respond', detail: 'B cells make antibodies that fit it', icon: 'shield' },
      { title: 'Remember', detail: 'Memory cells keep the recipe for years', icon: 'clock' },
      { title: 'Protect', detail: 'A real infection is stopped fast', icon: 'check' },
    ],
  };

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) { const d = JSON.parse(raw); if (d && Array.isArray(d.items)) return Object.assign({ pace: 'normal', motion: 'default', order: 'forward' }, d); }
    } catch (_) { /* storage unavailable — fall back to defaults */ }
    return structuredClone(DEFAULT_DATA);
  }
  function save(data) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (_) { /* quota / private mode */ }
  }

  // ── Mount ────────────────────────────────────────────────────────────────
  function mount(variant) {
    // Other template sets can reuse this shell: variant.set = { variants, storageKey, defaults, title, item, ph:[title, detail] }.
    const SET = variant.set || {};
    if (SET.variants) VARIANTS = SET.variants;
    if (SET.storageKey) STORAGE_KEY = SET.storageKey;
    if (SET.defaults) DEFAULT_DATA = SET.defaults;
    const TITLE = SET.title || 'Process Steps', WORD = SET.item || 'Step', PH = SET.ph || ['Step title', 'Detail (optional)'];
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
    const max = 6;

    const icons = {
      play: '<svg viewBox="0 0 16 16"><path d="M4 2.5v11l9-5.5z"/></svg>',
      pause: '<svg viewBox="0 0 16 16"><path d="M3.5 2h3v12h-3zM9.5 2h3v12h-3z"/></svg>',
      replay: '<svg viewBox="0 0 16 16"><path d="M8 3V0L4 4l4 4V5a4 4 0 1 1-4 4H2a6 6 0 1 0 6-6z"/></svg>',
    };
    const opts = (list) => list.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');

    document.body.insertAdjacentHTML('afterbegin', `
      <header class="app-bar">
        <a class="back" href="index.html">← All variants</a>
        <h1>${U.esc(TITLE)} · ${U.esc(variant.name)}</h1>
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
          <p class="hint">${U.esc(variant.note || '')} Space = play/pause · ←/→ = step 1 frame (Shift = 10) · Edit the steps on the right; changes are shared by all variants.</p>
        </section>
        <aside class="editor noimg">
          <h2>Motion</h2>
                    <div class="field"><label>Pace · gap between steps and hold</label>
            <div class="seg" role="group" aria-label="Pace"><button data-pace="relaxed">Relaxed</button><button data-pace="normal">Normal</button><button data-pace="snappy">Snappy</button></div>
          </div>
          <h2>Heading</h2>
          <div class="field"><label>Kicker</label><input data-k="kicker"></div>
          <div class="field"><label>Heading</label><input data-k="heading"></div>
          <h2>Steps <span class="cap">(3–6 steps work best; up to ${max})</span></h2>
          <div class="items"></div>
          <div class="row">
            <button class="btn primary add">+ Add step</button>
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
      duration = (variant.duration ? variant.duration(Math.max(1, items.length), P) : durationOf(Math.max(1, items.length), P, data.order)) / F;
      if (items.length) update = (variant.build || BUILD[variant.layout])(stage, Object.assign({}, data, { items }), { motion: data.motion, order: data.order, P });
      else { stage.innerHTML = '<div style="position:absolute;inset:0;display:grid;place-items:center;color:var(--text-muted);font-size:40px">Add a step to start</div>'; update = () => {}; }
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
            <span class="num">${U.esc(WORD)} ${String(i + 1).padStart(2, '0')}${i >= max ? ' · not shown' : ''}</span>
            <span class="tools">
              <button data-a="up" title="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
              <button data-a="down" title="Move down" ${i === data.items.length - 1 ? 'disabled' : ''}>↓</button>
              <button data-a="del" title="Remove">✕</button>
            </span>
          </div>
          <input data-f="title" placeholder="${U.esc(PH[0])}" value="${U.esc(it.title)}">
          <input data-f="detail" placeholder="${U.esc(PH[1])}" value="${U.esc(it.detail)}">
          <div class="duo">
            <select data-f="icon" title="Icon"><option value="">number only</option>${U.ICON_NAMES.map((n) => `<option value="${n}" ${it.icon === n ? 'selected' : ''}>icon: ${n}</option>`).join('')}</select>
          </div>`;
        card.querySelectorAll('[data-f]').forEach((f) => {
          const ev = f.tagName === 'SELECT' ? 'onchange' : 'oninput';
          f[ev] = () => { it[f.dataset.f] = f.value; changed(false); };
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
      $('.add').disabled = data.items.length >= max;
    }

    $('.add').onclick = () => {
      if (data.items.length >= max) return;
      data.items.push({ title: 'New step', detail: '', icon: 'star' });
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
      a.download = 'process-steps.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    $('.import').onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const d = JSON.parse(await file.text());
        if (!Array.isArray(d.items)) throw new Error('missing items');
        data = Object.assign({ pace: 'normal', motion: 'default', order: 'forward' }, d);
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

  window.StepsMotion = { mount, U, VARIANTS, DEFAULT_DATA, PACES, MOTIONS, ORDERS };
})();
