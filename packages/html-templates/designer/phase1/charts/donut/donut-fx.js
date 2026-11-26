/* Charts · Donut — one donut, four modern motions (based on our DonutRing: shares of one whole, centre value, legend).
 * Look: slim arcs with rounded ends and gaps, accent colours, soft glow on whatever is in focus.
 *   focus    — Focus Ring: arcs draw in with a glowing tip, then each slice in turn thickens and glows while the others
 *              dim, and the centre number switches to that slice (matches narration that walks through the shares)
 *   rings    — Activity Rings: one concentric ring per category, each filling to its share with a glowing rounded head
 *   bend     — Bar to Ring: the shares appear as one 100% bar, which bends and closes into the ring
 *   ticks    — Radial Ticks: the ring is 120 fine ticks that light up around the circle in each slice's colour
 */
(function () {
  'use strict';
  const C = window.ChartKit;
  const { el, esc, lerp, clamp, win, expoOut, inOut, backOut, quartOut, fx, secs, fmt, svgEl } = C;
  const COLORS = ['var(--primary)', 'var(--secondary)', 'var(--tertiary)', 'var(--quaternary)', 'var(--positive)', 'var(--muted)'];
  const TAU = Math.PI * 2, rad = (deg) => (deg * Math.PI) / 180;
  const dur = (extra = 0) => (n, P) => secs(0.8 + 1.6 + n * (0.6 + 1.2 * P.hold) * P.stagger + 1.4 + extra);

  /** Shares, start angle (fraction of the circle) and colour per item; index of the largest. */
  function shares(items) {
    const { d, hi } = C.data(items);
    const total = Math.max(1e-9, d.reduce((s, p) => s + Math.max(0, p.v), 0));
    let acc = 0;
    return { hi, slices: d.map((p) => { const share = Math.max(0, p.v) / total, a0 = acc; acc += share; return { p, share, a0, color: COLORS[p.i % COLORS.length] }; }) };
  }
  /** Rounded-cap arc on a circle: covers `frac` of the slice, leaving `gap` px between neighbours. */
  function arcSet(c, R, sw, sl, frac, rotDeg = -90, gap = 14) {
    const CIRC = TAU * R, full = sl.share * CIRC, len = Math.max(0.01, full * frac - gap - sw);
    c.setAttribute('stroke-dasharray', `${len.toFixed(2)} ${(CIRC * 2).toFixed(1)}`);
    const off = ((gap + sw) / 2 / R) * (180 / Math.PI);
    c.setAttribute('transform', `rotate(${(rotDeg + sl.a0 * 360 + off).toFixed(3)} ${c.getAttribute('cx')} ${c.getAttribute('cy')})`);
    c.style.opacity = full * frac > gap + sw * 0.6 ? 1 : 0;
  }
  const legend = (stage, slices, x = 1180, cy = 600) => slices.map((sl, i) => {
    const r = el('div', 'cd-leg', `<i style="background:${sl.color}"></i><span>${esc(sl.p.label)}</span><b>${esc(fmt(sl.p, sl.p.v))}</b>`);
    r.style.left = `${x}px`; r.style.top = `${cy - (slices.length * 76) / 2 + i * 76}px`; stage.append(r); return r;
  });
  const centre = (stage, cx, cy) => {
    const e = el('div', 'cd-center', '<b></b><span></span>'); e.style.left = `${cx - 200}px`; e.style.top = `${cy - 100}px`; stage.append(e);
    return { e, show(sl, k, x = 0) { e.firstChild.textContent = fmt(sl.p, sl.p.v * clamp(k)); e.lastChild.textContent = sl.p.label; fx(e, clamp(k * 1.5), x, 18, 10); } };
  };

  const V = {};

  // 1 · FOCUS RING
  V.focus = {
    name: 'Focus Ring', note: 'Focus ring: slim rounded arcs draw in with a glowing tip; then each slice in turn thickens and glows while the others dim, and the centre number switches to that slice.',
    duration: dur(),
    build(stage, data, o) {
      const head = C.U.head(stage, data), { hi, slices } = shares(data.items);
      const CX = 700, CY = 600, R = 250, SW = 46, n = slices.length;
      const s = C.svg(stage, 'ck-svg');
      svgEl('circle', { cx: CX, cy: CY, r: R, class: 'cd-track2' }, s);
      slices.forEach((sl) => { sl.c = svgEl('circle', { cx: CX, cy: CY, r: R, class: 'cd-arc' }, s); sl.c.style.stroke = sl.color; });
      const tip = svgEl('circle', { r: 14, class: 'cd-tip' }, s);
      const leg = legend(stage, slices), mid = centre(stage, CX, CY);
      const D0 = 0.4, DD = 1.4, B = (0.6 + 1.2 * o.P.hold) * o.P.stagger, F = (i) => D0 + DD + 0.4 + i * B, END = F(n);
      return (f) => {
        const t = f / 30; head(f);
        const g = inOut(win(t, D0, DD));
        slices.forEach((sl, i) => arcSet(sl.c, R, SW, sl, clamp((g - sl.a0) / Math.max(1e-6, sl.share))));
        const ang = rad(-90 + g * 360);
        tip.setAttribute('cx', (CX + Math.cos(ang) * R).toFixed(1)); tip.setAttribute('cy', (CY + Math.sin(ang) * R).toFixed(1));
        tip.style.opacity = g > 0.01 && g < 0.99 ? 1 : 0;
        let k = -1; slices.forEach((_, i) => { if (t >= F(i)) k = i; });
        const resolve = win(t, END, 0.6);
        slices.forEach((sl, i) => {
          const on = k === i && resolve < 1 ? backOut(win(t, F(i), 0.5), 1.8) * (1 - resolve) : 0;
          sl.c.style.strokeWidth = `${(SW + 30 * on).toFixed(1)}px`;
          sl.c.style.filter = on > 0.1 ? `drop-shadow(0 0 ${(18 * on).toFixed(1)}px ${sl.color})` : '';
          const dim = k >= 0 && k !== i ? lerp(0.28, 1, resolve) : 1;
          sl.c.style.opacity = (parseFloat(sl.c.style.opacity) * dim).toFixed(3);
          leg[i].classList.toggle('on', k === i && resolve < 1);
          fx(leg[i], expoOut(win(t, D0 + sl.a0 * DD + 0.2, 0.6)), 0, 0, 6);
          leg[i].style.opacity = (parseFloat(leg[i].style.opacity) * (k >= 0 && k !== i && resolve < 1 ? 0.45 : 1)).toFixed(3);
        });
        if (resolve > 0 || k < 0) mid.show(slices[hi], quartOut(k < 0 ? win(t, D0 + DD - 0.2, 0.6) : resolve));
        else mid.show(slices[k], expoOut(win(t, F(k), 0.5)), i_out(t, F, k, n));
      };
      function i_out(t, Ff, kk, nn) { return kk < nn - 1 ? inOut(win(t, Ff(kk + 1) - 0.25, 0.25)) : 0; }
    },
  };

  // 2 · ACTIVITY RINGS
  V.rings = {
    name: 'Activity Rings', note: 'Activity rings: every category gets its own concentric ring that fills to its share with a glowing rounded head; the values sit at the start of each ring.',
    duration: dur(-1),
    build(stage, data, o) {
      const head = C.U.head(stage, data), { slices } = shares(data.items);
      const CX = 1060, CY = 600, SW = 44, STEP = 58, n = Math.min(5, slices.length), R0 = 120 + n * STEP;
      const s = C.svg(stage, 'ck-svg');
      const rings = slices.slice(0, n).map((sl, i) => {
        const r = R0 - i * STEP;
        const tr = svgEl('circle', { cx: CX, cy: CY, r, class: 'cd-rtrack' }, s); tr.style.stroke = sl.color;
        const c = svgEl('circle', { cx: CX, cy: CY, r, class: 'cd-ring', transform: `rotate(-90 ${CX} ${CY})` }, s); c.style.stroke = sl.color;
        const head2 = svgEl('circle', { r: SW / 2, class: 'cd-rhead' }, s); head2.style.fill = sl.color;
        const lab = el('div', 'cd-rlab', `<span>${esc(sl.p.label)}</span><b>${esc(fmt(sl.p, sl.p.v))}</b>`);
        lab.style.left = `${CX - 40}px`; lab.style.top = `${CY - r}px`; stage.append(lab);
        return { sl, r, tr, c, head: head2, lab };
      });
      return (f) => {
        const t = f / 30; head(f);
        rings.forEach((g, i) => {
          const a = 0.5 + i * 0.3 * o.P.stagger, k = quartOut(win(t, a, 1.5)), CIRC = TAU * g.r, frac = g.sl.share * k;
          g.tr.style.opacity = expoOut(win(t, a - 0.3, 0.5)).toFixed(3);
          g.c.setAttribute('stroke-dasharray', `${(Math.max(0.01, CIRC * frac)).toFixed(2)} ${(CIRC * 2).toFixed(1)}`);
          g.c.style.opacity = frac > 0.002 ? 1 : 0;
          const ang = rad(-90 + frac * 360);
          g.head.setAttribute('cx', (CX + Math.cos(ang) * g.r).toFixed(1)); g.head.setAttribute('cy', (CY + Math.sin(ang) * g.r).toFixed(1));
          g.head.style.opacity = frac > 0.002 ? 1 : 0;
          fx(g.lab, expoOut(win(t, a + 0.2, 0.6)), 0, 0, 6);
          g.lab.style.transform = `translate(-100%, -50%) translateX(${((1 - expoOut(win(t, a + 0.2, 0.6))) * -20).toFixed(1)}px)`;
        });
      };
    },
  };

  // 3 · BAR TO RING
  V.bend = {
    name: 'Bar to Ring', note: 'Bar to ring: the shares appear as one 100% bar with their labels, then the bar bends and closes into the ring — the same whole, reshaped — and the largest share takes the centre.',
    duration: dur(0.6),
    build(stage, data, o) {
      const head = C.U.head(stage, data), { hi, slices } = shares(data.items);
      const CX = 960, CY = 560, R = 220, SW = 46, L = TAU * R, Y0 = CY + R, GAP = 16, NP = 48;
      const s = C.svg(stage, 'ck-svg');
      slices.forEach((sl) => { sl.path = svgEl('path', { class: 'cd-bend' }, s); sl.path.style.stroke = sl.color; });
      const labs = slices.map((sl) => { const e = el('div', 'cd-blab', `<b>${esc(fmt(sl.p, sl.p.v))}</b><span>${esc(sl.p.label)}</span>`); stage.append(e); return e; });
      const chips = el('div', 'cd-chips', slices.map((sl) => `<span><i style="background:${sl.color}"></i>${esc(sl.p.label)} <b>${esc(fmt(sl.p, sl.p.v))}</b></span>`).join('')); stage.append(chips);
      const mid = centre(stage, CX, CY);
      const pt = (sPos, b) => {                                              // strip position → point, bent by b (0 flat, 1 circle)
        const u = sPos - L / 2;
        if (b < 1e-3) return { x: CX + u, y: Y0 };
        const k = b / R;
        return { x: CX + Math.sin(u * k) / k, y: Y0 - (1 - Math.cos(u * k)) / k };
      };
      const n = slices.length, GROW = 0.4 + n * 0.12, BEND = GROW + 0.9 + 0.8 * o.P.hold;
      return (f) => {
        const t = f / 30; head(f);
        const b = inOut(win(t, BEND, 1.5));
        slices.forEach((sl, i) => {
          const g = quartOut(win(t, 0.4 + i * 0.12, 0.7));
          const s0 = sl.a0 * L + GAP / 2 + SW / 2, s1 = s0 + Math.max(0.5, (sl.share * L - GAP - SW) * g);
          let d = '';
          for (let j = 0; j <= NP; j++) { const q = pt(lerp(s0, s1, j / NP), b); d += `${j ? ' L' : 'M'} ${q.x.toFixed(1)} ${q.y.toFixed(1)}`; }
          sl.path.setAttribute('d', d); sl.path.style.opacity = g > 0 ? 1 : 0;
          const m = pt(sl.a0 * L + (sl.share * L) / 2, 0);
          Object.assign(labs[i].style, { left: `${m.x}px`, top: `${Y0 - 118}px` });
          fx(labs[i], expoOut(win(t, 0.6 + i * 0.12, 0.6)) * (1 - inOut(win(t, BEND, 0.4))), 0, 14, 6);
        });
        mid.show(slices[hi], quartOut(win(t, BEND + 1.3, 0.8)));
        fx(chips, expoOut(win(t, BEND + 1.5, 0.7)), 0, 20, 8);
      };
    },
  };

  // 4 · RADIAL TICKS
  V.ticks = {
    name: 'Radial Ticks', note: 'Radial ticks: the ring is 120 fine ticks; a soft beam of light sweeps round and lights them in each slice’s colour, then the largest slice’s ticks extend and glow.',
    duration: dur(-1),
    build(stage, data, o) {
      const head = C.U.head(stage, data), { hi, slices } = shares(data.items);
      const CX = 700, CY = 600, R1 = 215, R2 = 290, NT = 120;
      const s = C.svg(stage, 'ck-svg');
      s.insertAdjacentHTML('afterbegin', `<defs><radialGradient id="cdBeam"><stop offset="0" style="stop-color:var(--primary);stop-opacity:.35"/><stop offset="1" style="stop-color:var(--primary);stop-opacity:0"/></radialGradient></defs>`);
      const beam = svgEl('path', { fill: 'url(#cdBeam)' }, s);
      const ticks = Array.from({ length: NT }, (_, j) => {
        const f = (j + 0.5) / NT, sl = slices.find((x) => f >= x.a0 && f < x.a0 + x.share) || slices[slices.length - 1];
        const a = rad(-90 + f * 360), ln = svgEl('line', { class: 'cd-tick' }, s);
        return { ln, a, sl, f, gap: slices.some((x) => Math.abs(f - x.a0) < 0.5 / NT) };
      });
      const leg = legend(stage, slices), mid = centre(stage, CX, CY);
      const S0 = 0.5, SD = 2.0, LIT = S0 + SD;
      return (f) => {
        const t = f / 30; head(f);
        const g = inOut(win(t, S0, SD)), hl = expoOut(win(t, LIT + 0.2, 0.6));
        const ba = rad(-90 + g * 360), bw = 0.35;
        beam.setAttribute('d', `M ${CX} ${CY} L ${CX + Math.cos(ba - bw) * 330} ${CY + Math.sin(ba - bw) * 330} A 330 330 0 0 1 ${CX + Math.cos(ba) * 330} ${CY + Math.sin(ba) * 330} Z`);
        beam.style.opacity = g > 0.01 && g < 0.99 ? 1 : 0;
        ticks.forEach((tk) => {
          const lit = clamp((g - tk.f) * 30), isHi = tk.sl.p.i === hi;
          const r2 = R2 + (isHi ? 26 * hl : 0) + 12 * Math.max(0, 1 - Math.abs(g - tk.f) * 25);
          tk.ln.setAttribute('x1', (CX + Math.cos(tk.a) * R1).toFixed(1)); tk.ln.setAttribute('y1', (CY + Math.sin(tk.a) * R1).toFixed(1));
          tk.ln.setAttribute('x2', (CX + Math.cos(tk.a) * r2).toFixed(1)); tk.ln.setAttribute('y2', (CY + Math.sin(tk.a) * r2).toFixed(1));
          tk.ln.style.stroke = lit > 0 && !tk.gap ? tk.sl.color : '';
          tk.ln.style.opacity = tk.gap ? 0.15 : (0.18 + 0.82 * lit) * (hl > 0 && !isHi ? 1 - 0.4 * hl : 1);
          tk.ln.style.filter = isHi && hl > 0 ? `drop-shadow(0 0 ${(8 * hl).toFixed(1)}px ${tk.sl.color})` : '';
        });
        leg.forEach((r, i) => fx(r, expoOut(win(t, S0 + slices[i].a0 * SD + 0.2, 0.6)), 0, 0, 6));
        mid.show(slices[hi], quartOut(win(t, LIT, 0.8)));
      };
    },
  };

  const SET = {
    title: 'Charts · Donut', item: 'Slice', ph: ['Label (Search)', 'Value (42%)'], storageKey: 'chart-donut-v1',
    variants: [
      { id: 'focus', file: 'v1-focus-ring.html', name: 'Focus Ring' },
      { id: 'rings', file: 'v2-activity-rings.html', name: 'Activity Rings' },
      { id: 'bend', file: 'v3-bar-to-ring.html', name: 'Bar to Ring' },
      { id: 'ticks', file: 'v4-radial-ticks.html', name: 'Radial Ticks' },
    ],
    defaults: {
      pace: 'normal', motion: 'default', order: 'forward', kicker: 'Traffic', heading: 'Where our visitors come from',
      items: [
        { title: 'Search', detail: '42%', icon: 'search' }, { title: 'Social', detail: '26%', icon: 'heart' },
        { title: 'Direct', detail: '18%', icon: 'send' }, { title: 'Email', detail: '14%', icon: 'mail' },
      ],
    },
  };
  window.DonutFX = { variants: V, set: SET, mount: C.mount(V, SET) };
})();
