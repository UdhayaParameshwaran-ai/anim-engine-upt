/* Charts · Line — one smooth line chart, four motions (based on our LineGraph: smooth curve, soft area, dots, a marked point).
 *   morph   — Rise from Flat: the whole line lies on the baseline, then every point springs up to its value
 *   connect — Constellation: the points appear first as glowing dots, then each link snaps from dot to dot
 *   bars    — Bars to Line: the values arrive as columns, their tops join into a line and the columns melt away
 *   focus   — Focus Zoom: the line is laid down fast, then the camera pushes in on the peak with its change badge
 */
(function () {
  'use strict';
  const C = window.ChartKit;
  const { el, esc, lerp, clamp, win, expoOut, inOut, backOut, quartOut, fx, secs, fmt, svgEl, smooth } = C;
  const X0 = 220, X1 = 1700, TOP = 320, Y = 860, PH = Y - TOP;
  const dur = (extra = 0) => (n, P) => secs(0.6 + n * 0.2 * P.stagger + 1.6 + 3 * P.hold + extra);

  /** Shared layout: points, SVG (grid, area, line), dots, labels, value tags. */
  function chart(stage, data, withGrad = true) {
    const { d, max, hi } = C.data(data.items);
    const n = d.length;
    const pts = d.map((p) => ({ x: n > 1 ? X0 + (p.i * (X1 - X0)) / (n - 1) : 960, y: Y - (p.v / (max * 1.15)) * PH, p }));
    const world = el('div', 'cl-world'); stage.append(world);
    const s = C.svg(world, 'ck-svg'); C.grid(s, X0 - 40, X1 + 40, TOP, Y);
    if (withGrad) s.insertAdjacentHTML('afterbegin', '<defs><linearGradient id="clA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--primary);stop-opacity:.35"/><stop offset="1" style="stop-color:var(--primary);stop-opacity:0"/></linearGradient></defs>');
    const area = svgEl('path', { class: 'cl-area' }, s), line = svgEl('path', { class: 'cl-line' }, s), glow = svgEl('path', { class: 'cl-glow' }, s);
    s.insertBefore(glow, line);
    const dots = pts.map((q) => svgEl('circle', { class: 'cl-dot' + (q.p.i === hi ? ' hi' : ''), r: 11, cx: q.x, cy: q.y }, s));
    const labs = pts.map((q) => { const e = el('div', 'cl-lab', esc(q.p.label)); e.style.left = `${q.x}px`; world.append(e); return e; });
    const tags = pts.map((q) => { const e = el('div', 'cl-tag' + (q.p.i === hi ? ' hi' : '')); world.append(e); return e; });
    const draw = (ys) => {
      const P2 = pts.map((q, i) => ({ x: q.x, y: ys[i] }));
      const dl = smooth(P2); line.setAttribute('d', dl); glow.setAttribute('d', dl);
      area.setAttribute('d', `${dl} L ${P2[P2.length - 1].x} ${Y} L ${P2[0].x} ${Y} Z`);
      dots.forEach((c, i) => c.setAttribute('cy', ys[i].toFixed(1)));
      tags.forEach((e, i) => { e.style.left = `${pts[i].x}px`; e.style.top = `${(ys[i] - 70).toFixed(1)}px`; });
    };
    return { d, n, hi, pts, world, s, area, line, glow, dots, labs, tags, draw };
  }
  const tagVal = (e, q, k) => { e.textContent = fmt(q.p, q.p.v * clamp(k)); e.style.opacity = clamp(k * 2).toFixed(3); };

  const V = {};

  V.morph = {
    name: 'Rise from Flat', note: 'Rise from flat: the whole line lies on the baseline, then every point springs up to its value from left to right, the curve and area flexing with them.',
    duration: dur(),
    build(stage, data, o) {
      const head = C.U.head(stage, data), L = chart(stage, data);
      return (f) => {
        const t = f / 30; head(f);
        const intro = expoOut(win(t, 0.2, 0.5));
        L.line.style.opacity = L.glow.style.opacity = intro; L.area.style.opacity = intro;
        const ys = L.pts.map((q, i) => { const k = backOut(win(t, 0.6 + i * 0.16 * o.P.stagger, 0.9), 1.5); tagVal(L.tags[i], q, Math.min(1, k)); return lerp(Y, q.y, k); });
        L.draw(ys);
        L.dots.forEach((c, i) => { c.style.opacity = intro; });
        L.labs.forEach((e, i) => fx(e, expoOut(win(t, 0.3 + i * 0.06, 0.6)), 0, 14, 6));
      };
    },
  };

  V.connect = {
    name: 'Constellation', note: 'Constellation: the data points appear first as glowing dots with a ripple, then each link snaps from dot to dot and the area glows in underneath.',
    duration: dur(0.8),
    build(stage, data, o) {
      const head = C.U.head(stage, data), L = chart(stage, data);
      L.draw(L.pts.map((q) => q.y));
      L.line.style.display = L.glow.style.display = 'none';
      const segs = L.pts.slice(1).map((q, i) => { const a = L.pts[i]; const g = svgEl('path', { class: 'cl-seg', d: smooth([a, q].map((z) => ({ x: z.x, y: z.y }))), pathLength: 1 }, L.s); return g; });
      const rings = L.pts.map((q) => svgEl('circle', { class: 'cl-ring', cx: q.x, cy: q.y, r: 11 }, L.s));
      const dotAt = (i) => 0.5 + i * 0.12 * o.P.stagger, linkAt = (i) => dotAt(L.n - 1) + 0.5 + i * 0.22 * o.P.stagger;
      return (f) => {
        const t = f / 30; head(f);
        L.dots.forEach((c, i) => { const k = win(t, dotAt(i), 0.4); c.style.opacity = clamp(k * 3); c.setAttribute('r', (11 * backOut(k, 2.6)).toFixed(2)); tagVal(L.tags[i], L.pts[i], expoOut(k)); });
        rings.forEach((r, i) => { const q = win(t, dotAt(i), 0.8); r.style.opacity = q > 0 && q < 1 ? 1 - q : 0; r.setAttribute('r', (11 + 40 * expoOut(q)).toFixed(1)); });
        segs.forEach((g, i) => { const k = expoOut(win(t, linkAt(i), 0.35)); g.style.strokeDasharray = '1'; g.style.strokeDashoffset = String(1 - k); });
        L.area.style.opacity = expoOut(win(t, linkAt(L.n - 2) + 0.3, 0.8));
        L.labs.forEach((e, i) => fx(e, expoOut(win(t, dotAt(i) - 0.1, 0.6)), 0, 14, 6));
      };
    },
  };

  V.bars = {
    name: 'Bars to Line', note: 'Bars to line: the values arrive as columns, their tops join into a smooth line, then the columns melt away leaving the line and its area.',
    duration: dur(1.2),
    build(stage, data, o) {
      const head = C.U.head(stage, data), L = chart(stage, data);
      L.draw(L.pts.map((q) => q.y));
      const bw = Math.min(110, ((X1 - X0) / Math.max(1, L.n - 1)) * 0.5);
      const cols = L.pts.map((q) => { const b = el('div', 'cl-col' + (q.p.i === L.hi ? ' hi' : '')); b.style.cssText = `left:${q.x - bw / 2}px;top:${q.y}px;width:${bw}px;height:${Y - q.y}px`; L.world.insertBefore(b, L.world.firstChild); return b; });
      L.line.setAttribute('pathLength', 1); L.glow.setAttribute('pathLength', 1);
      const colAt = (i) => 0.5 + i * 0.14 * o.P.stagger, J = colAt(L.n - 1) + 0.8;
      return (f) => {
        const t = f / 30; head(f);
        cols.forEach((b, i) => { const k = backOut(win(t, colAt(i), 0.7), 1.4), m = inOut(win(t, J + 0.9, 0.9)); b.style.transform = `scaleY(${(k * (1 - m)).toFixed(4)})`; b.style.opacity = (1 - m * 0.4).toFixed(3); tagVal(L.tags[i], L.pts[i], Math.min(1, k)); });
        const j = inOut(win(t, J, 0.9));
        [L.line, L.glow].forEach((p) => { p.style.strokeDasharray = '1'; p.style.strokeDashoffset = String(1 - j); });
        L.dots.forEach((c, i) => { c.style.opacity = j > (i / Math.max(1, L.n - 1)) - 0.02 ? 1 : 0; });
        L.area.style.opacity = expoOut(win(t, J + 1.0, 0.8));
        L.labs.forEach((e, i) => fx(e, expoOut(win(t, colAt(i) - 0.15, 0.6)), 0, 14, 6));
      };
    },
  };

  V.focus = {
    name: 'Focus Zoom', note: 'Focus zoom: the line is laid down quickly, then the camera pushes in on the peak — the rest softens out of focus — and a badge shows how far it rose from the start.',
    duration: dur(1.6),
    build(stage, data, o) {
      const head = C.U.head(stage, data), L = chart(stage, data);
      L.draw(L.pts.map((q) => q.y));
      L.line.setAttribute('pathLength', 1); L.glow.setAttribute('pathLength', 1);
      const pk = L.pts[L.hi], first = L.pts[0].p.v, ch = first ? Math.round(((pk.p.v - first) / Math.abs(first)) * 100) : 0;
      const badge = el('div', 'cl-badge', `<b>${ch >= 0 ? '+' : '−'}${Math.abs(ch)}%</b><span>vs ${esc(L.pts[0].p.label)}</span>`); L.world.append(badge);
      Object.assign(badge.style, { left: `${pk.x + 40}px`, top: `${pk.y - 150}px` });
      const D = 0.4, Z = D + 1.2 + 0.5;
      return (f) => {
        const t = f / 30; head(f);
        const k = inOut(win(t, D, 1.2));
        [L.line, L.glow].forEach((p) => { p.style.strokeDasharray = '1'; p.style.strokeDashoffset = String(1 - k); });
        L.area.style.opacity = expoOut(win(t, D + 0.8, 0.6));
        L.dots.forEach((c, i) => { c.style.opacity = k >= i / Math.max(1, L.n - 1) - 0.01 ? 1 : 0; });
        L.tags.forEach((e, i) => tagVal(e, L.pts[i], expoOut(win(t, D + (i / Math.max(1, L.n - 1)) * 1.2, 0.4))));
        L.labs.forEach((e, i) => fx(e, expoOut(win(t, 0.2 + i * 0.05, 0.6)), 0, 14, 6));
        const z = inOut(win(t, Z, 1.1)), zoom = 1 + 0.7 * z;
        L.world.style.transformOrigin = `${pk.x}px ${pk.y}px`;
        L.world.style.transform = `translate(${((960 - pk.x) * z * 0.6).toFixed(1)}px, ${((560 - pk.y) * z * 0.6).toFixed(1)}px) scale(${zoom.toFixed(4)})`;
        L.dots.forEach((c, i) => { if (i !== L.hi) c.style.filter = z > 0.05 ? `blur(${(z * 3).toFixed(1)}px)` : ''; });
        L.tags.forEach((e, i) => { if (i !== L.hi) e.style.opacity = (parseFloat(e.style.opacity) * (1 - z * 0.8)).toFixed(3); });
        const b = win(t, Z + 0.9, 0.5); badge.style.opacity = clamp(b * 3); badge.style.transform = `scale(${(backOut(b, 2.2) / zoom).toFixed(3)})`;
      };
    },
  };

  const SET = {
    title: 'Charts · Line', item: 'Point', ph: ['Label (Jan)', 'Value (12k)'], storageKey: 'chart-line-v1',
    variants: [
      { id: 'morph', file: 'v1-rise-from-flat.html', name: 'Rise from Flat' },
      { id: 'connect', file: 'v2-constellation.html', name: 'Constellation' },
      { id: 'bars', file: 'v3-bars-to-line.html', name: 'Bars to Line' },
      { id: 'focus', file: 'v4-focus-zoom.html', name: 'Focus Zoom' },
    ],
    defaults: {
      pace: 'normal', motion: 'default', order: 'forward', kicker: 'Growth', heading: 'Active users per month',
      items: [
        { title: 'Jan', detail: '12k', icon: 'chart' }, { title: 'Feb', detail: '15k', icon: 'chart' }, { title: 'Mar', detail: '14k', icon: 'chart' },
        { title: 'Apr', detail: '22k', icon: 'chart' }, { title: 'May', detail: '27k', icon: 'chart' }, { title: 'Jun', detail: '36k', icon: 'chart' },
      ],
    },
  };
  window.LineFX = { variants: V, set: SET, mount: C.mount(V, SET) };
})();
