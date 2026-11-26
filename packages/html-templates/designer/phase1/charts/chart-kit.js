/* Charts — shared kit for every chart template (bar/, line/, donut/ …).
 * Reuses the process-steps shell (player, editor, themes) and its motion kit (curves, text treatments).
 * Items: title = label ("Jan"), detail = value ("$42k", "18%", "1,200") — prefix/suffix are kept for display.
 */
(function () {
  'use strict';
  const SM = window.StepsMotion, U = SM.U, K = window.StepsFX.kit;
  const NS = 'http://www.w3.org/2000/svg';

  const parse = (s) => {
    const m = /^\s*([^\d\-.]*)(-?[\d.,]+)\s*(.*)$/.exec(String(s ?? ''));
    if (!m) return { v: 0, pre: '', suf: '', dec: 0 };
    const raw = m[2].replace(/,/g, ''), dot = raw.indexOf('.');
    return { v: parseFloat(raw) || 0, pre: m[1], suf: m[3], dec: dot >= 0 ? Math.min(2, raw.length - dot - 1) : 0 };
  };
  const fmt = (p, v) => `${p.pre}${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: p.dec, maximumFractionDigits: p.dec })}${p.suf}`;
  /** Items → [{label, v, pre, suf, dec, i}] plus max and the index of the highlight (largest value). */
  const data = (items) => {
    const d = items.map((it, i) => ({ label: it.title, ...parse(it.detail), i }));
    const max = Math.max(1e-9, ...d.map((x) => x.v));
    const hi = d.reduce((b, x) => (x.v > d[b].v ? x.i : b), 0);
    return { d, max, hi };
  };
  const svgEl = (tag, attrs = {}, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.append(e); return e; };
  const svg = (stage, cls, w = 1920, h = 1080) => svgEl('svg', { width: w, height: h, viewBox: `0 0 ${w} ${h}`, class: cls }, stage);
  /** Smooth path through points (Catmull-Rom → cubic Bézier). */
  const smooth = (pts, k = 0.18) => pts.map((p, i) => {
    if (i === 0) return `M ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    const p0 = pts[i - 2] || pts[i - 1], p1 = pts[i - 1], p3 = pts[i + 1] || p;
    return ` C ${(p1.x + (p.x - p0.x) * k).toFixed(1)} ${(p1.y + (p.y - p0.y) * k).toFixed(1)} ${(p.x - (p3.x - p1.x) * k).toFixed(1)} ${(p.y - (p3.y - p1.y) * k).toFixed(1)} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  }).join('');
  /** Horizontal guide lines for a plot from y0 (top) to y1 (baseline). */
  const grid = (s, x0, x1, y0, y1, rows = 4) => { for (let r = 0; r <= rows; r++) { const y = y1 - ((y1 - y0) * r) / rows; svgEl('line', { x1: x0, x2: x1, y1: y, y2: y, class: r ? 'ck-grid' : 'ck-base' }, s); } };
  /** Duration in frames from seconds. */
  const secs = (s) => Math.round(s * 30);

  const mount = (V, SET) => (id) => SM.mount({ id, name: V[id].name, note: V[id].note, duration: V[id].duration, build: V[id].build, set: SET });

  window.ChartKit = Object.assign({}, K, { U, NS, parse, fmt, data, svgEl, svg, smooth, grid, secs, mount, lerp: U.lerp, clamp: U.clamp, el: U.el, esc: U.esc });
})();
