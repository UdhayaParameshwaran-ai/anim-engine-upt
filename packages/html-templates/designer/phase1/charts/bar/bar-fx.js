/* Charts · Bar — one bar chart, five motions (based on our BarChart: rounded-top bars, the largest in the primary colour).
 *   grow  — Spring Rise: bars spring up one after another, overshoot and settle; values count with them
 *   race  — Sort Race: bars appear in input order, then slide into ranked order; the winner gets a #1 badge
 *   sweep — Scan Sweep: a glowing scan line crosses the chart and each bar shoots up as it passes
 *   led   — LED Segments: every bar is a column of segments that light up from the bottom like a level meter
 *   wipe  — Glow Wipe: horizontal bars are revealed by a bright leading edge, the value counting at the tip
 */
(function () {
  'use strict';
  const C = window.ChartKit;
  const { el, esc, lerp, clamp, win, expoOut, inOut, backOut, quartOut, fx, secs, fmt } = C;
  const X0 = 200, X1 = 1720, TOP = 300, Y = 880, PH = Y - TOP;
  const dur = (extra = 0) => (n, P) => secs(0.6 + n * 0.2 * P.stagger + 1.4 + 3 * P.hold + extra);

  /** Vertical bar layout + DOM shared by grow / race / sweep / led. */
  function columns(stage, data, opts = {}) {
    const { d, max, hi } = C.data(data.items);
    const n = d.length, slot = (X1 - X0) / n, bw = Math.min(150, slot * 0.56);
    const g = C.svg(stage, 'ck-svg'); C.grid(g, X0 - 20, X1 + 20, TOP, Y);
    const bars = d.map((p) => {
      const h = (p.v / (max * 1.12)) * PH;
      const b = el('div', 'cb-bar' + (p.i === hi ? ' hi' : ''));
      b.style.cssText = `left:${-bw / 2}px;top:${Y - h}px;width:${bw}px;height:${h}px`;
      const val = el('div', 'cb-val' + (p.i === hi ? ' hi' : '')), lab = el('div', 'cb-lab', esc(p.label));
      val.style.top = `${Y - h - 64}px`;
      const col = el('div', 'cb-col'); col.append(b, val, lab); stage.append(col);
      if (opts.segments) { const nS = Math.max(1, Math.round(h / 34)); b.classList.add('seg'); b.innerHTML = Array.from({ length: nS }, () => '<i></i>').join(''); }
      return { p, h, b, val, lab, col, segs: [...b.children], xAt: (i) => X0 + slot * (i + 0.5) };
    });
    return { bars, n, hi, max, slot, bw };
  }
  const place = (bar, x) => { bar.col.style.transform = `translateX(${x.toFixed(1)}px)`; };
  const showVal = (bar, k) => { bar.val.textContent = fmt(bar.p, bar.p.v * clamp(k)); bar.val.style.opacity = clamp(k * 2).toFixed(3); };
  const showLab = (bar, t, at) => fx(bar.lab, expoOut(win(t, at, 0.6)), 0, 16, 6);

  const V = {};

  V.grow = {
    name: 'Spring Rise', note: 'Spring rise: the bars spring up one after another, overshoot slightly and settle, with each value counting up as its bar grows. The largest bar glows.',
    duration: dur(),
    build(stage, data, o) {
      const head = C.U.head(stage, data), L = columns(stage, data);
      return (f) => {
        const t = f / 30; head(f);
        L.bars.forEach((b, i) => {
          place(b, b.xAt(i));
          const a = 0.5 + i * 0.2 * o.P.stagger, k = win(t, a, 0.9), s = backOut(k, 1.6);
          b.b.style.transform = `scaleY(${s.toFixed(4)}) scaleX(${(1 + 0.08 * Math.max(0, s - 1) * 6).toFixed(4)})`;
          showVal(b, quartOut(k)); showLab(b, t, a - 0.2);
          b.val.style.transform = `translateY(${((1 - Math.min(1, s)) * b.h).toFixed(1)}px)`;
        });
      };
    },
  };

  V.race = {
    name: 'Sort Race', note: 'Sort race: the bars rise in their original order, pause, then slide past each other into ranked order, highest first. The winner gets a #1 badge.',
    duration: dur(2.2),
    build(stage, data, o) {
      const head = C.U.head(stage, data), L = columns(stage, data);
      const rank = [...L.bars].sort((a, b) => b.p.v - a.p.v).map((b) => b.p.i);
      const badge = el('div', 'cb-badge', '#1'); stage.append(badge);
      const T = 0.6 + L.n * 0.12 + 0.9;                                  // when the sort starts
      return (f) => {
        const t = f / 30; head(f);
        L.bars.forEach((b, i) => {
          const a = 0.5 + i * 0.12, k = expoOut(win(t, a, 0.7));
          const m = inOut(win(t, T + rank.indexOf(i) * 0.05, 1.1)), lift = Math.sin(Math.PI * m);
          place(b, lerp(b.xAt(i), b.xAt(rank.indexOf(i)), m));
          b.b.style.transform = `scaleY(${k.toFixed(4)})`;
          b.col.style.zIndex = String(10 + Math.round(b.p.v));
          b.col.style.marginTop = `${(-lift * 18).toFixed(1)}px`;
          showVal(b, k); showLab(b, t, a - 0.2);
        });
        const top = L.bars[rank[0]];
        Object.assign(badge.style, { left: `${top.xAt(0) - 36}px`, top: `${Y - top.h - 140}px` });
        const q = win(t, T + 1.3, 0.45); badge.style.opacity = clamp(q * 3); badge.style.transform = `scale(${backOut(q, 2.6).toFixed(3)})`;
      };
    },
  };

  V.sweep = {
    name: 'Scan Sweep', note: 'Scan sweep: a glowing scan line crosses the chart from left to right, and each bar shoots up the moment the line passes it.',
    duration: dur(0.6),
    build(stage, data, o) {
      const head = C.U.head(stage, data), L = columns(stage, data);
      const scan = el('div', 'cb-scan'); stage.append(scan);
      const S0 = 0.5, SD = 1.2 + L.n * 0.15 * o.P.stagger;
      const xAtT = (t) => lerp(X0 - 60, X1 + 60, inOut(win(t, S0, SD)));
      const pass = (x) => { for (let q = 0; q <= 1; q += 0.005) { if (lerp(X0 - 60, X1 + 60, inOut(q)) >= x) return S0 + q * SD; } return S0 + SD; };
      const at = L.bars.map((b, i) => pass(b.xAt(i)));
      return (f) => {
        const t = f / 30; head(f);
        const sx = xAtT(t), on = win(t, S0 - 0.2, 0.2) * (1 - win(t, S0 + SD, 0.4));
        scan.style.transform = `translateX(${sx.toFixed(1)}px)`; scan.style.opacity = on.toFixed(3);
        L.bars.forEach((b, i) => {
          place(b, b.xAt(i));
          const k = win(t, at[i], 0.45), s = backOut(k, 2.2);
          b.b.style.transform = `scaleY(${s.toFixed(4)})`;
          b.b.style.boxShadow = k > 0 && k < 1 ? `0 0 ${(40 * (1 - k)).toFixed(1)}px color-mix(in srgb, var(--primary) 70%, transparent)` : '';
          showVal(b, expoOut(k)); showLab(b, t, at[i] - 0.15);
          b.val.style.transform = `translateY(${((1 - Math.min(1, s)) * b.h).toFixed(1)}px)`;
        });
      };
    },
  };

  V.led = {
    name: 'LED Segments', note: 'LED segments: every bar is a column of segments that light up from the bottom like a level meter, the top segment flashing as it lands.',
    duration: dur(0.4),
    build(stage, data, o) {
      const head = C.U.head(stage, data), L = columns(stage, data, { segments: true });
      return (f) => {
        const t = f / 30; head(f);
        L.bars.forEach((b, i) => {
          place(b, b.xAt(i));
          const a = 0.5 + i * 0.16 * o.P.stagger, nS = b.segs.length, step = Math.min(0.06, 1.1 / nS);
          let lit = 0;
          b.segs.forEach((s, j) => {                                         // segments are top→bottom in the DOM
            const idx = nS - 1 - j, k = win(t, a + idx * step, 0.12);
            s.style.opacity = (0.12 + 0.88 * k).toFixed(3);
            s.classList.toggle('flash', k > 0 && k < 1);
            if (k >= 1) lit = Math.max(lit, idx + 1);
          });
          b.b.style.opacity = expoOut(win(t, 0.2, 0.5)).toFixed(3);
          showVal(b, lit / nS); b.val.style.opacity = lit === nS ? 1 : 0; showLab(b, t, a - 0.2);
          b.val.style.transform = `translateY(${((1 - lit / nS) * b.h).toFixed(1)}px)`;
        });
      };
    },
  };

  V.wipe = {
    name: 'Glow Wipe', note: 'Glow wipe: horizontal bars are revealed left to right by a bright leading edge, with the value counting at the tip; the largest finishes with a soft glow.',
    duration: dur(),
    build(stage, data, o) {
      const head = C.U.head(stage, data);
      const { d, max, hi } = C.data(data.items);
      const n = d.length, LX = 460, RX = 1640, RH = Math.min(96, 560 / n), y0 = 590 - (n * RH) / 2;
      const rows = d.map((p) => {
        const w = (p.v / (max * 1.05)) * (RX - LX), y = y0 + p.i * RH;
        const lab = el('div', 'cw-lab', esc(p.label)); lab.style.top = `${y}px`;
        const tr = el('div', 'cw-track'); tr.style.cssText = `left:${LX}px;top:${y + RH * 0.18}px;width:${RX - LX}px;height:${RH * 0.64}px`;
        const bar = el('div', 'cw-bar' + (p.i === hi ? ' hi' : '')); bar.style.cssText = `left:${LX}px;top:${y + RH * 0.18}px;width:${w}px;height:${RH * 0.64}px`;
        const edge = el('i', 'cw-edge'); bar.append(edge);
        const val = el('div', 'cw-val' + (p.i === hi ? ' hi' : '')); val.style.top = `${y}px`;
        stage.append(lab, tr, bar, val);
        return { p, w, lab, bar, edge, val, tr };
      });
      return (f) => {
        const t = f / 30; head(f);
        rows.forEach((r, i) => {
          const a = 0.5 + i * 0.18 * o.P.stagger, k = quartOut(win(t, a, 1.1));
          fx(r.lab, expoOut(win(t, a - 0.25, 0.6)), 0, 0, 6); fx(r.tr, expoOut(win(t, a - 0.3, 0.5)), 0, 0, 0);
          r.bar.style.clipPath = `inset(0 ${((1 - k) * 100).toFixed(2)}% 0 0 round 999px)`;
          r.edge.style.left = `${(k * r.w - 40).toFixed(1)}px`; r.edge.style.opacity = (k > 0 && k < 1 ? 1 : 0).toFixed(2);
          r.val.style.left = `${(LX + k * r.w + 22).toFixed(1)}px`;
          r.val.textContent = fmt(r.p, r.p.v * k); r.val.style.opacity = clamp(k * 3).toFixed(3);
        });
      };
    },
  };

  const SET = {
    title: 'Charts · Bar', item: 'Bar', ph: ['Label (Jan)', 'Value ($42k, 18%)'], storageKey: 'chart-bar-v1',
    variants: [
      { id: 'grow', file: 'v1-spring-rise.html', name: 'Spring Rise' },
      { id: 'race', file: 'v2-sort-race.html', name: 'Sort Race' },
      { id: 'sweep', file: 'v3-scan-sweep.html', name: 'Scan Sweep' },
      { id: 'led', file: 'v4-led-segments.html', name: 'LED Segments' },
      { id: 'wipe', file: 'v5-glow-wipe.html', name: 'Glow Wipe' },
    ],
    defaults: {
      pace: 'normal', motion: 'default', order: 'forward', kicker: 'Revenue', heading: 'Monthly revenue, first half of 2026',
      items: [
        { title: 'Jan', detail: '$42k', icon: 'chart' }, { title: 'Feb', detail: '$55k', icon: 'chart' }, { title: 'Mar', detail: '$48k', icon: 'chart' },
        { title: 'Apr', detail: '$71k', icon: 'chart' }, { title: 'May', detail: '$64k', icon: 'chart' }, { title: 'Jun', detail: '$88k', icon: 'chart' },
      ],
    },
  };
  window.BarFX = { variants: V, set: SET, mount: C.mount(V, SET) };
})();
