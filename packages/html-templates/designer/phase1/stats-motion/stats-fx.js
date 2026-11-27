/* Stats · Motion set — six stat scenes, each with its own motion idea.
 *
 * Shared rules (from the motion research):
 *   · Rule of one   — one thing has the primary motion at a time; the rest dims, blurs or drifts.
 *   · Blur-rise     — text arrives out of blur (10px) + 24px rise on an expo-out, never a plain fade.
 *   · Hold life     — nothing freezes: slow camera drift / ambient motion during every hold.
 *   · Eye-trace     — the next thing appears where the eye already is (the motion ends where the next begins).
 *   · Recede exits  — exits are faster than entrances and blur away instead of cutting.
 *
 * Variants:  tape · swarm · tubes · bubbles · scale · comet · odometer   (see ../MOTION-LEDGER.md — every signature motion is used once)
 * Each page calls  StatsFX.mount('<id>')  → StatsMotion.mount() (stats-core.js) with a build() that returns update(frame).
 * update() is a pure function of the frame (30 fps), so scrubbing, looping and frame-by-frame rendering all work.
 */
(function () {
  'use strict';

  const SM = window.StatsMotion;
  const U = SM.U;
  const { clamp, lerp, esc, el } = U;
  const FPS = 30;

  // ── Curves ────────────────────────────────────────────────────────────────
  const expoOut = (k) => (k >= 1 ? 1 : 1 - Math.pow(2, -10 * k));
  const quartOut = (k) => 1 - Math.pow(1 - clamp(k), 4);
  const inOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
  const backOut = (k, s = 1.7) => { const c3 = s + 1; return 1 + c3 * Math.pow(k - 1, 3) + s * Math.pow(k - 1, 2); };
  const win = (t, a, d) => clamp((t - a) / Math.max(0.001, d));
  const rnd = (i) => { const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };

  // ── Beat clock: every variant gives each stat one beat (gap + hold, both set by Pace) ──
  const beat = (P) => 1.0 * P.stagger + 1.7 * P.hold;
  const T0 = 0.6;
  const durOf = (n, P, tail = 1.4) => Math.round((T0 + n * beat(P) + tail) * FPS);

  const parsed = (it) => U.parse(it.value);
  /** Context text (axis titles, scales, keys) placed once; faded in with the heading. */
  const ctxEl = (root, cls, html, css) => { const e = el('div', 'ctx ' + cls, html); if (css) e.style.cssText = css; root.append(e); return e; };
  const vmaxOf = (items) => Math.max(1e-9, ...items.map((it) => Math.abs(parsed(it).v)));
  const fmtVal = (it, v) => U.fmt(v, parsed(it).dec);
  const numHTML = (it, v) => `${it.prefix ? `<span class="fx-aff">${esc(it.prefix)}</span>` : ''}<span class="fx-n">${fmtVal(it, v)}</span>${it.suffix ? `<span class="fx-aff">${esc(it.suffix)}</span>` : ''}`;

  /** Blur-rise in, recede out. k = enter 0..1, x = exit 0..1. */
  const fx = (e, k, x = 0, dy = 24, bl = 10, sc = 0) => {
    e.style.opacity = clamp(k * (1 - x)).toFixed(3);
    e.style.transform = `translateY(${((1 - k) * dy - x * dy).toFixed(1)}px) scale(${(1 - (1 - k) * sc - x * sc).toFixed(4)})`;
    const b = (1 - k) * bl + x * bl;
    e.style.filter = b > 0.3 ? `blur(${b.toFixed(1)}px)` : '';
  };
  /* Text treatments. The signature motion of each variant is unique; the supporting text also gets its own
   * treatment chosen to echo that motion, so no two variants in a set share one:
   *   blur  — out of soft focus, rising        mask  — slides up from behind an edge (rising liquid, a card face)
   *   wipe  — revealed left→right (a ruler, a sliding highlight)   track — letters draw together (a zoom settling)
   *   scale — shrinks into place (inflating, morphing)              drop  — falls in and settles (gravity)
   *   flip  — hinges down like a counter wheel (odometer) */
  const TXT = {
    blur: (w, k, x) => fx(w, k, x, 22, 9),
    mask: (w, k, x) => { w.style.opacity = (k > 0 ? 1 - x : 0).toFixed(3); w.style.transform = `translateY(${((1 - k) * 110 - x * 110).toFixed(1)}%)`; w.style.filter = ''; },
    wipe: (w, k, x) => { w.style.opacity = (k > 0 ? 1 - x : 0).toFixed(3); w.style.clipPath = `inset(-30% ${((1 - clamp(k)) * 100).toFixed(1)}% -30% -2%)`; w.style.transform = `translateX(${((1 - k) * -16 - x * 16).toFixed(1)}px)`; w.style.filter = ''; },
    track: (w, k, x) => { w.style.opacity = clamp(k * 1.4 * (1 - x)).toFixed(3); w.style.letterSpacing = `${((1 - k) * 0.45 + x * 0.15).toFixed(3)}em`; const b = (1 - k) * 6 + x * 6; w.style.filter = b > 0.3 ? `blur(${b.toFixed(1)}px)` : ''; },
    scale: (w, k, x) => { w.style.opacity = clamp(k * 2 * (1 - x)).toFixed(3); w.style.transform = `scale(${(1.35 - 0.35 * k - x * 0.12).toFixed(4)})`; const b = (1 - k) * 5 + x * 6; w.style.filter = b > 0.3 ? `blur(${b.toFixed(1)}px)` : ''; },
    flip: (w, k, x) => { w.style.opacity = clamp(k * 2 * (1 - x)).toFixed(3); w.style.transform = `perspective(600px) rotateX(${((1 - k) * -85 + x * 60).toFixed(2)}deg)`; w.style.transformOrigin = '50% 0'; w.style.filter = ''; },
    drop: (w, k, x) => { w.style.opacity = clamp(k * 3 * (1 - x)).toFixed(3); w.style.transform = `translateY(${((1 - k) * -38 + x * 20).toFixed(1)}px) rotate(${((1 - k) * -5).toFixed(2)}deg)`; w.style.filter = ''; },
  };
  /** A line of text split into words; `style` picks the treatment. */
  const words = (text, cls, style = 'blur') => {
    const e = el('div', `${cls} tx-${style}`);
    e.innerHTML = String(text || '').split(/\s+/).filter(Boolean).map((w) => (style === 'mask' ? `<span class="fx-m"><span class="fx-w">${esc(w)}</span></span>` : `<span class="fx-w">${esc(w)}</span>`)).join(' ');
    return { el: e, ws: [...e.querySelectorAll('.fx-w')], style };
  };
  const wordsAt = (W, t, start, x = 0, step = 0.07) => W.ws.forEach((w, i) => {
    const raw = win(t, start + i * step, 0.7);
    TXT[W.style](w, W.style === 'drop' ? backOut(raw, 2.2) : expoOut(raw), x);
  });

  /** Time each stat's beat starts. */
  const starts = (n, P) => [...Array(n).keys()].map((i) => T0 + i * beat(P));
  /** Index of the stat whose beat is playing at t (−1 before the first). */
  const activeAt = (S, t) => { let k = -1; S.forEach((s, i) => { if (t >= s) k = i; }); return k; };

  const V = {};

  // ════════════════════════════════════════════════════════════════════════
  // 1 · TAPE MEASURE — the value is read off a ruler. A long tape scrolls under a fixed needle and decelerates to
  //     lock on the value (blur follows its speed). The distance it travels IS the change: a tinted band spans from
  //     the last stat's flag to the needle, and each finished stat leaves a flag hanging from the tape.
  // ════════════════════════════════════════════════════════════════════════
  V.tape = {
    minItems: 1, maxItems: 6,
    name: 'Tape Measure',
    use: 'Showing how a number moved from one value to the next, and by how much.',
    example: 'Revenue Q1 to Q4: the gap between flags is the growth each quarter.',
    avoid: 'Many unrelated numbers at once; the ruler needs values that share one scale.',
    note: 'Tape measure: a ruler scrolls under a fixed needle and locks onto each value, with blur following its speed. The distance it travels is the change: a band spans from the last flag to the needle, and every stat leaves a flag on the tape.',
    duration: (n, P) => durOf(n, P),
    build(stage, data, _U, o) {
      const items = data.items, n = items.length, B = beat(o.P), S = starts(n, o.P);
      const head = U.head(stage, data);
      const vals = items.map((it) => parsed(it).v);
      const vmax = Math.max(1e-9, ...vals), vmin = Math.min(0, ...vals);
      const PPU = 3000 / Math.max(1e-9, vmax - vmin);
      const raw = 36 / PPU, mag = Math.pow(10, Math.floor(Math.log10(raw)));
      const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || 10 * mag;
      const from = Math.floor(vmin / step) * step - step * 30, to = vmax + step * 30;
      const minorPx = step * PPU;
      const tape = el('div', 'tp-tape');
      tape.style.width = `${((to - from) * PPU).toFixed(1)}px`;
      tape.style.backgroundSize = `${minorPx}px 30px, ${minorPx * 5}px 60px`;
      tape.style.backgroundPosition = `0 0, ${(((0 - from) * PPU) % (minorPx * 5)).toFixed(2)}px 0`;
      const a0 = items[0];
      const dec = step < 1 ? Math.min(2, Math.ceil(-Math.log10(step * 5))) : 0;
      let marks = '';
      for (let v = Math.ceil(from / (step * 5)) * step * 5; v <= to; v += step * 5) marks += `<span class="tp-mark" style="left:${((v - from) * PPU).toFixed(1)}px">${esc(a0.prefix || '')}${U.fmt(v, dec)}${esc(a0.suffix || '')}</span>`;
      tape.innerHTML = marks;
      const band = el('div', 'tp-band'); tape.append(band);
      const flags = items.map((it, i) => {
        const f = el('div', 'tp-flag' + (it.highlight ? ' hi' : ''));
        f.style.left = `${((vals[i] - from) * PPU).toFixed(1)}px`;
        f.innerHTML = `<i></i><span><b>${esc(it.prefix || '')}${fmtVal(it, vals[i])}${esc(it.suffix || '')}</b>${esc(it.label)}</span>`;
        tape.append(f); return f;
      });
      const rail = el('div', 'tp-rail'); rail.append(tape); stage.append(rail);
      stage.append(el('div', 'tp-needle', '<i></i>'));
      const ctx = data.yAxis || data.xAxis ? [ctxEl(stage, 'ctx-under', `${esc(data.yAxis || '')}${data.xAxis ? `<span> · one flag per ${esc(data.xAxis.toLowerCase())}</span>` : ''}`, 'left:0;right:0;top:868px')] : [];
      const num = el('div', 'tp-num'); stage.append(num);
      const labs = items.map((it) => { const L = words(it.label, 'tp-label', 'wipe'); stage.append(L.el); return L; });
      const dels = items.map((it) => { if (!U.deltaOf(it)) return null; const d = U.delta(U.deltaOf(it), 'lg'); const w = el('div', 'tp-delta'); w.append(d.el); stage.append(w); return { d, w }; });
      const curAt = (t) => { let c = vmin; for (let i = 0; i < n; i++) c = lerp(c, vals[i], backOut(win(t, S[i] + 0.05, 1.5), 0.9)); return c; };
      return (f) => {
        const t = f / FPS;
        head(f);
        ctx.forEach((e) => { e.style.opacity = expoOut(win(f / FPS, 0.2, 0.6)).toFixed(3); });
        const c = curAt(t), vpx = Math.abs(c - curAt(t - 1 / FPS)) * PPU;
        const intro = expoOut(win(t, 0.1, 0.9));
        tape.style.transform = `translateX(${(960 - (c - from) * PPU).toFixed(1)}px)`;
        rail.style.opacity = intro.toFixed(3);
        tape.style.filter = vpx > 1.5 ? `blur(${Math.min(9, vpx / 10).toFixed(1)}px)` : '';
        const k = Math.max(0, activeAt(S, t));
        num.innerHTML = numHTML(items[k], c);
        num.classList.toggle('hi', !!items[k].highlight);
        TXT.wipe(num, intro, 0);
        labs.forEach((L, i) => {
          const s = S[i], last = i === n - 1, x = last ? 0 : inOut(win(t, s + B - 0.05, 0.3));
          L.el.style.visibility = t >= s - 0.05 && (last || t < s + B + 0.3) ? 'visible' : 'hidden';
          wordsAt(L, t, s + 0.3, x);
        });
        dels.forEach((d, i) => {
          if (!d) return;
          const s = S[i], last = i === n - 1, x = last ? 0 : inOut(win(t, s + B - 0.05, 0.3));
          d.w.style.visibility = t >= s && (last || t < s + B + 0.3) ? 'visible' : 'hidden';
          d.d.update(f, (s + 1.3) * FPS, x);
        });
        flags.forEach((fl, i) => {
          const p = win(t, S[i] + 1.35, 0.5);
          fl.style.opacity = p > 0 ? 1 : 0;
          fl.style.transform = `translateY(${((1 - Math.min(1, backOut(p, 2))) * -30).toFixed(1)}px) scaleY(${(0.2 + 0.8 * expoOut(p)).toFixed(3)})`;
        });
        if (k > 0 && t >= S[k]) {
          const lo = Math.min(vals[k - 1], c), hi = Math.max(vals[k - 1], c);
          band.style.left = `${((lo - from) * PPU).toFixed(1)}px`; band.style.width = `${((hi - lo) * PPU).toFixed(1)}px`;
          band.style.opacity = (k < n - 1 ? 1 - inOut(win(t, S[k] + B - 0.25, 0.4)) : 1).toFixed(3);
        } else band.style.opacity = 0;
      };
    },
  };

  // ════════════════════════════════════════════════════════════════════════
  // 2 · UNIT SWARM — the number is made of 100 units. A loose cloud of dots drifts on the left; for each stat the
  //     right number of dots flies out of the cloud on curved paths and locks into a 10×10 grid. The count runs with
  //     the dots. Dots added in this beat glow; earlier ones settle back, so the growth reads at a glance.
  // ════════════════════════════════════════════════════════════════════════
  V.swarm = {
    minItems: 1, maxItems: 6,
    name: 'Unit Swarm',
    use: 'Showing a count of things, or one value as a share of a whole (customers, orders, tickets).',
    example: 'Orders by region: 100 dots stand for 100 percent, and each region claims its own dots.',
    avoid: 'Decimals or very large totals that do not read as countable units.',
    note: 'Unit swarm: a cloud of 100 dots drifts; each stat pulls its share out of the cloud on curved paths into a 10×10 grid. Dots added this beat glow, earlier ones settle back — the growth is visible, not just the number.',
    duration: (n, P) => durOf(n, P),
    build(stage, data, _U, o) {
      const items = data.items, n = items.length, B = beat(o.P), S = starts(n, o.P);
      const head = U.head(stage, data);
      const vmax = vmaxOf(items);
      const pct = items.every((it) => String(it.suffix).trim() === '%' && Math.abs(parsed(it).v) <= 100);
      const C = items.map((it) => { const v = Math.abs(parsed(it).v); const c = Math.round(pct ? v : (v / vmax) * 100); return clamp(c, v > 0 ? 1 : 0, 100); });
      const unit = pct ? '1%' : `${items[0].prefix || ''}${U.fmt(vmax / 100, vmax / 100 < 10 ? 1 : 0)}${items[0].suffix || ''}`;

      const cell = 60, G = { x: 200, y: 318 };
      const field = el('div', 'sw-field'); stage.append(field);
      for (let j = 0; j < 100; j++) { const g = el('i', 'sw-slot'); g.style.left = `${G.x + (j % 10) * cell + 9}px`; g.style.top = `${G.y + Math.floor(j / 10) * cell + 9}px`; field.append(g); }
      const dots = [...Array(100).keys()].map((j) => {
        const d = el('i', 'sw-dot'); field.append(d);
        const col = j % 10, row = 9 - Math.floor(j / 10);
        const a = rnd(j * 3 + 1) * Math.PI * 2, r = Math.sqrt(rnd(j * 7 + 2));
        return {
          d, hx: G.x + col * cell + cell / 2, hy: G.y + row * cell + cell / 2,
          sx: 140 + rnd(j * 7 + 2) * 1640, sy: 240 + rnd(j * 3 + 1) * 800,
          ph: rnd(j * 11 + 5) * 6.28, bend: (rnd(j * 13 + 3) - 0.5) * 360,
        };
      });
      // which beat first lit each dot, and per-beat changes
      const litAt = (k, j) => (k < 0 ? false : j < C[k]);
      const firstLit = (k, j) => { let m = k; while (m > 0 && litAt(m - 1, j)) m--; return m; };

      const legend = el('div', 'sw-legend', `<i></i><span>= ${esc(unit)}</span>`); stage.append(legend);
      const ctx = data.yAxis ? [ctxEl(legend, 'ctx-inline', `· ${esc(data.yAxis)}`)] : [];
      const panel = el('div', 'sw-panel'); stage.append(panel);
      const beats = items.map((it, i) => {
        const box = el('div', 'sw-beat');
        const num = el('div', 'sw-num' + (it.highlight ? ' hi' : ''));
        const lab = words(it.label, 'sw-label', 'blur');
        const dl = U.deltaOf(it) ? U.delta(U.deltaOf(it), 'lg') : null;
        const idx = el('div', 'sw-idx', `${String(i + 1).padStart(2, '0')} / ${String(n).padStart(2, '0')}`);
        box.append(idx, num, lab.el);
        if (dl) { const w = el('div', 'sw-delta'); w.append(dl.el); box.append(w); }
        panel.append(box);
        return { box, num, lab, dl, idx, v: parsed(it).v, it };
      });

      return (f) => {
        const t = f / FPS;
        head(f);
        ctx.forEach((e) => { e.style.opacity = expoOut(win(f / FPS, 0.2, 0.6)).toFixed(3); });
        const k = activeAt(S, t);
        fx(legend, expoOut(win(t, 0.4, 0.8)));
        dots.forEach((p, j) => {
          const amb = { x: Math.sin(t * 0.7 + p.ph) * 14, y: Math.cos(t * 0.55 + p.ph * 1.3) * 12 };
          const sx = p.sx + amb.x, sy = p.sy + amb.y;
          const now = litAt(k, j), before = litAt(k - 1, j);
          let x, y, e = now ? 1 : 0;
          if (k >= 0 && now !== before) {
            const changed = now ? C[k] - (k > 0 ? C[k - 1] : 0) : C[k - 1] - C[k];
            const rank = now ? j - (k > 0 ? C[k - 1] : 0) : C[k - 1] - 1 - j;
            const delay = 0.15 + (rank / Math.max(1, changed)) * Math.min(1.1, 0.5 * B);
            const q = quartOut(win(t, S[k] + delay, 0.85));
            e = now ? q : 1 - q;
          }
          // quadratic path cloud → cell with a sideways bend
          const mx = (sx + p.hx) / 2 + p.bend, my = (sy + p.hy) / 2 - Math.abs(p.bend) * 0.4;
          const u = e;
          x = (1 - u) * (1 - u) * sx + 2 * (1 - u) * u * mx + u * u * p.hx;
          y = (1 - u) * (1 - u) * sy + 2 * (1 - u) * u * my + u * u * p.hy;
          const size = lerp(9, 42, e);
          const fresh = now && k >= 0 && firstLit(k, j) === k;
          const intro = expoOut(win(t, 0.1 + rnd(j) * 0.5, 0.8));
          p.d.style.transform = `translate(${(x - size / 2).toFixed(1)}px, ${(y - size / 2).toFixed(1)}px)`;
          p.d.style.width = p.d.style.height = `${size.toFixed(1)}px`;
          p.d.style.borderRadius = `${lerp(50, 28, e).toFixed(1)}%`;
          p.d.style.opacity = (lerp(0.22, fresh ? 1 : 0.55, e) * intro).toFixed(3);
          p.d.className = 'sw-dot' + (e > 0.5 ? (fresh ? ' on' : ' old') : '');
        });
        beats.forEach((b, i) => {
          const s = S[i], last = i === n - 1;
          const kk = expoOut(win(t, s + (i ? 0.3 : 0), 0.8)), x = last ? 0 : inOut(win(t, s + B - 0.05, 0.32));
          b.box.style.visibility = t >= s - 0.05 && (last || t < s + B + 0.5) ? 'visible' : 'hidden';
          fx(b.idx, kk, x, 16, 8);
          const from = i > 0 ? beats[i - 1].v : 0;
          const cp = quartOut(win(t, s + 0.2, Math.min(1.1, 0.5 * B) + 0.75));
          b.num.innerHTML = numHTML(b.it, lerp(from, b.v, cp));
          fx(b.num, kk, x, 40, 14);
          wordsAt(b.lab, t, s + 0.3, x);
          if (b.dl) b.dl.update(f, (s + 1.2) * FPS, x);
        });
      };
    },
  };

  // ════════════════════════════════════════════════════════════════════════
  // 3 · LIQUID TUBES — glass tubes fill with liquid whose surface sloshes and settles (amplitude decays), bubbles rise,
  //     and the value floats on the surface. The camera eases toward the tube that is filling; the others dim.
  //     At the end every tube comes back into focus and the highlighted one glows.
  // ════════════════════════════════════════════════════════════════════════
  V.tubes = {
    minItems: 2, maxItems: 6,
    name: 'Liquid Tubes',
    use: 'Comparing levels against a capacity: how full each bucket is (budget used, storage, quota).',
    example: 'Budget used per team: each tube fills to its percent of allowance.',
    avoid: 'Values with no natural maximum, since the tube needs a full mark.',
    note: 'Liquid tubes: each tube fills with a sloshing liquid that settles, bubbles rise, and the value floats on the surface. Focus walks tube to tube while the camera leans in; at the end all tubes return and the highlight glows.',
    duration: (n, P) => durOf(n, P, 2.2),
    build(stage, data, _U, o) {
      const items = data.items, n = items.length, B = beat(o.P), S = starts(n, o.P);
      const head = U.head(stage, data);
      const vmax = vmaxOf(items);
      const world = el('div', 'fx-world'); stage.append(world);
      const w = 132, Ht = 520, top = 330, span = Math.min(1500, n * 280);
      const gap = n > 1 ? (span - w) / (n - 1) : 0, left0 = 960 - span / 2;
      const end = S[n - 1] + B + 0.2;
      const yOf = (v) => top + Ht - 5 - (Math.abs(v) / vmax) * 0.84 * (Ht - 10), a0 = items[0], ax = left0 - 40;
      const ctx = [0, 0.5, 1].map((q) => ctxEl(world, 'ctx-tick', `${esc(a0.prefix || '')}${U.fmt(q * vmax, q * vmax >= 10 || q === 0 ? 0 : 1)}${esc(a0.suffix || '')}`, `left:${ax}px;top:${yOf(q * vmax)}px`));
      ctx.push(ctxEl(world, 'ctx-axis', '', `left:${ax + 14}px;top:${yOf(vmax)}px;height:${yOf(0) - yOf(vmax)}px`));
      if (data.yAxis) ctx.push(ctxEl(world, 'ctx-ytitle', esc(data.yAxis), `left:${ax - 130}px;top:${(yOf(0) + yOf(vmax)) / 2}px`));
      if (data.xAxis) ctx.push(ctxEl(world, 'ctx-xtitle', esc(data.xAxis), `left:960px;top:${top + Ht + 92}px`));
      const tubes = items.map((it, i) => {
        const cx = n > 1 ? left0 + w / 2 + i * gap : 960;
        const ac = it.highlight ? 'var(--secondary)' : U.accent(i);
        const box = el('div', 'tb' + (it.highlight ? ' hi' : ''));
        box.style.left = `${cx - w / 2}px`; box.style.top = `${top}px`; box.style.setProperty('--ac', ac);
        const bub = [...Array(7).keys()].map((j) => `<circle class="tb-b" r="${(3 + rnd(i * 9 + j) * 5).toFixed(1)}"/>`).join('');
        box.innerHTML = `<svg width="${w}" height="${Ht}" viewBox="0 0 ${w} ${Ht}">
          <defs><clipPath id="tbc${i}"><rect x="5" y="5" width="${w - 10}" height="${Ht - 10}" rx="${(w - 10) / 2}"/></clipPath>
          <linearGradient id="tbg${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--ac)"/><stop offset="1" style="stop-color:color-mix(in srgb, var(--ac) 55%, var(--ink))"/></linearGradient></defs>
          <rect class="tb-glass" x="3" y="3" width="${w - 6}" height="${Ht - 6}" rx="${(w - 6) / 2}"/>
          <g clip-path="url(#tbc${i})"><path class="tb-back"/><path class="tb-liq" fill="url(#tbg${i})"/>${bub}</g>
          <rect class="tb-rim" x="3" y="3" width="${w - 6}" height="${Ht - 6}" rx="${(w - 6) / 2}"/>
          <rect class="tb-shine" x="${w * 0.2}" y="34" width="9" height="${Ht * 0.55}" rx="4.5"/></svg>`;
        const tag = el('div', 'tb-tag'); tag.style.left = `${cx}px`;
        const lab = words(it.label, 'tb-label', 'mask'); lab.el.style.left = `${cx}px`; lab.el.style.top = `${top + Ht + 26}px`;
        world.append(box, tag, lab.el);
        const { v } = parsed(it);
        return { box, tag, lab, cx, it, v, h: (Math.abs(v) / vmax) * 0.84, liq: box.querySelector('.tb-liq'), back: box.querySelector('.tb-back'), bubs: [...box.querySelectorAll('.tb-b')] };
      });
      const wave = (y0, amp, ph, t) => {
        let d = `M 0 ${Ht}`;
        for (let x = 0; x <= w; x += 6) d += ` L ${x} ${(y0 + Math.sin((x / w) * Math.PI * 2.2 + t * 4.2 + ph) * amp + Math.sin((x / w) * Math.PI * 4.6 - t * 2.6 + ph) * amp * 0.35).toFixed(2)}`;
        return d + ` L ${w} ${Ht} Z`;
      };
      return (f) => {
        const t = f / FPS;
        head(f);
        ctx.forEach((e) => { e.style.opacity = expoOut(win(f / FPS, 0.2, 0.6)).toFixed(3); });
        const k = activeAt(S, t);
        const resolve = inOut(win(t, end, 0.9));
        // camera: lean toward the tube being filled, ease back to centre at the end
        const camAt = (j) => (j < 0 ? 0 : (960 - tubes[j].cx) * 0.12);
        const ck = k < 0 ? 0 : lerp(camAt(k - 1), camAt(k), inOut(win(t, S[k] - 0.1, 0.9)));
        world.style.transform = `translateX(${(ck * (1 - resolve)).toFixed(1)}px) scale(${(1.03 - 0.03 * resolve + 0.012 * win(t, 0, 30)).toFixed(4)})`;
        tubes.forEach((tb, i) => {
          const s = S[i];
          const intro = expoOut(win(t, 0.15 + i * 0.08, 0.9));
          const fill = t < s ? 0 : backOut(win(t, s + 0.1, 1.3), 1.25);
          const L = tb.h * fill;
          const y0 = Ht - 5 - L * (Ht - 10);
          const settle = t < s ? 0 : Math.exp(-2.2 * Math.max(0, t - s - 0.5));
          const amp = 2.5 + 15 * settle * win(t, s, 0.3);
          tb.liq.setAttribute('d', wave(y0, amp, i, t));
          tb.back.setAttribute('d', wave(y0 - 6, amp * 0.8, i + 2.1, t * 0.8));
          tb.bubs.forEach((c, j) => {
            const sp = 60 + rnd(i * 7 + j) * 80, ph = rnd(i * 5 + j * 3) * (Ht - y0 + 1);
            const by = Ht - 8 - ((t * sp + ph) % Math.max(20, Ht - y0 - 10));
            c.setAttribute('cx', (w * (0.25 + 0.5 * rnd(i * 3 + j * 11)) + Math.sin(t * 3 + j) * 6).toFixed(1));
            c.setAttribute('cy', by.toFixed(1));
            c.style.opacity = L > 0.04 ? 0.5 : 0;
          });
          // focus walk (rule of one): the filling tube is sharp, the rest step back
          const focus = k === i ? 1 : 0;
          const dim = resolve > 0 ? lerp(focus ? 1 : 0.42, 1, resolve) : (k < 0 ? 1 : focus ? 1 : 0.42);
          const blur = (1 - dim) * 3.2;
          tb.box.style.opacity = (intro * (t < s && k >= 0 ? 0.55 : dim)).toFixed(3);
          tb.box.style.transform = `translateY(${((1 - intro) * 60).toFixed(1)}px)`;
          tb.box.style.filter = blur > 0.3 ? `blur(${blur.toFixed(1)}px)` : '';
          const glow = tb.it.highlight ? resolve * (0.6 + 0.4 * Math.sin(t * 3)) : 0;
          tb.box.style.setProperty('--glow', glow.toFixed(3));
          const tk = expoOut(win(t, s + 0.25, 0.7));
          tb.tag.innerHTML = numHTML(tb.it, tb.v * clamp(fill));
          tb.tag.style.top = `${(top + y0 - 92).toFixed(1)}px`;
          tb.tag.style.opacity = (tk * (t < s ? 0 : dim)).toFixed(3);
          tb.tag.style.filter = tk < 0.98 ? `blur(${((1 - tk) * 10).toFixed(1)}px)` : (blur > 0.3 ? `blur(${blur.toFixed(1)}px)` : '');
          wordsAt(tb.lab, t, 0.35 + i * 0.08);
          tb.lab.el.style.opacity = dim.toFixed(3);
        });
      };
    },
  };

  // ════════════════════════════════════════════════════════════════════════
  // 4 · BUBBLE PACK — each stat inflates as a bubble whose area is the value. It floats up into the cluster and
  //     physically shoulders the others aside (a real collision simulation, baked per frame so scrubbing stays exact);
  //     the cluster settles with a soft wobble and keeps breathing. The newest bubble is lit, the rest step back.
  // ════════════════════════════════════════════════════════════════════════
  V.bubbles = {
    minItems: 2, maxItems: 6,
    name: 'Bubble Pack',
    use: 'Relative size and share across several categories, where the biggest should stand out.',
    example: 'Revenue by product line: bubble area is the revenue of each line.',
    avoid: 'Exact comparisons; people judge area less precisely than length.',
    note: 'Bubble pack: each stat inflates as a bubble whose area is the value; it floats into the cluster and shoulders the others aside (real collision physics), then everything settles with a soft wobble. The newest bubble is lit.',
    duration: (n, P) => durOf(n, P, 2),
    build(stage, data, _U, o) {
      const items = data.items, n = items.length, S = starts(n, o.P);
      const head = U.head(stage, data);
      const vmax = vmaxOf(items);
      const R = items.map((it) => Math.max(56, Math.sqrt(Math.abs(parsed(it).v) / vmax) * 225));
      const CX = 960, CY = 650;
      const total = durOf(n, o.P, 2) + 2;
      const rad = (i, t) => (t < S[i] ? 0 : R[i] * backOut(win(t, S[i], 0.75), 2.0));
      // deterministic physics, baked once
      const P_ = items.map((_, i) => ({ x: CX + (rnd(i * 5 + 1) - 0.5) * 520, y: 1240, vx: 0, vy: 0 }));
      const frames = [];
      for (let fr = 0; fr <= total; fr++) {
        const t = fr / FPS;
        for (let sub = 0; sub < 4; sub++) {
          const dt = 1 / FPS / 4;
          P_.forEach((p, i) => {
            if (t < S[i]) return;
            p.vx += (CX - p.x) * 7 * dt; p.vy += (CY - p.y) * 7 * dt;
            p.vx *= 0.965; p.vy *= 0.965;
            p.x += p.vx * dt; p.y += p.vy * dt;
          });
          for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
            if (t < S[a] || t < S[b]) continue;
            const A = P_[a], Bq = P_[b];
            let dx = Bq.x - A.x, dy = Bq.y - A.y;
            const d = Math.hypot(dx, dy) || 0.01, min = rad(a, t) + rad(b, t) + 14;
            if (d < min) {
              const ov = (min - d) / 2; dx /= d; dy /= d;
              A.x -= dx * ov; A.y -= dy * ov; Bq.x += dx * ov; Bq.y += dy * ov;
              const rv = (Bq.vx - A.vx) * dx + (Bq.vy - A.vy) * dy;
              if (rv < 0) { A.vx += dx * rv * 0.5; A.vy += dy * rv * 0.5; Bq.vx -= dx * rv * 0.5; Bq.vy -= dy * rv * 0.5; }
            }
          }
          P_.forEach((p, i) => { if (t >= S[i]) { const r = rad(i, t); p.y = Math.max(p.y, 230 + r); } });
        }
        frames.push(P_.map((p) => ({ x: p.x, y: p.y })));
      }
      const bubs = items.map((it, i) => {
        const b = el('div', 'bp-bub' + (it.highlight ? ' hi' : ''));
        b.style.setProperty('--ac', it.highlight ? 'var(--secondary)' : U.accent(i));
        const num = el('div', 'bp-num', numHTML(it, parsed(it).v));
        const L = words(it.label, 'bp-label', 'scale');
        b.append(num, L.el); stage.append(b);
        num.style.fontSize = `${(R[i] * 0.4).toFixed(1)}px`;
        L.el.style.fontSize = `${Math.max(18, R[i] * 0.12).toFixed(1)}px`;
        const dl = U.deltaOf(it) ? U.delta(U.deltaOf(it), 'md') : null;
        if (dl) { const w = el('div', 'bp-delta'); w.append(dl.el); b.append(w); }
        return { b, num, L, dl };
      });
      // legend: every bubble's colour, label and value, so small bubbles stay readable
      const leg = el('div', 'bp-leg'); stage.append(leg);
      const ctx = data.yAxis ? [ctxEl(leg, 'ctx-legtitle', `Bubble size = ${esc(data.yAxis)}`)] : [];
      const rows = items.map((it, i) => { const r = el('div', 'bp-row' + (it.highlight ? ' hi' : ''), `<i style="background:${it.highlight ? 'var(--secondary)' : U.accent(i)}"></i><span>${esc(it.label)}</span><b>${numHTML(it, parsed(it).v)}</b>`); leg.append(r); return r; });
      return (f) => {
        const t = f / FPS;
        head(f);
        ctx.forEach((e) => { e.style.opacity = expoOut(win(f / FPS, 0.2, 0.6)).toFixed(3); });
        const fr = frames[Math.min(frames.length - 1, Math.max(0, Math.round(f)))];
        const k = activeAt(S, t);
        rows.forEach((r, i) => { const p = expoOut(win(t, S[i] + 0.3, 0.5)); r.style.opacity = (p * (i === k ? 1 : 0.6)).toFixed(3); r.style.transform = `translateX(${((1 - p) * 30).toFixed(1)}px)`; r.classList.toggle('on', i === k); });
        bubs.forEach((bb, i) => {
          const r = rad(i, t) * (1 + 0.012 * Math.sin(t * 2.1 + i * 1.7));
          if (r <= 0.5) { bb.b.style.visibility = 'hidden'; return; }
          bb.b.style.visibility = 'visible';
          const p = fr[i];
          bb.b.style.width = bb.b.style.height = `${(2 * r).toFixed(1)}px`;
          bb.b.style.transform = `translate(${(p.x - r).toFixed(1)}px, ${(p.y - r).toFixed(1)}px)`;
          bb.b.classList.toggle('on', i === k);
          bb.b.style.opacity = (i === k ? 1 : 0.8).toFixed(3);
          TXT.scale(bb.num, expoOut(win(t, S[i] + 0.25, 0.6)), 0);
          wordsAt(bb.L, t, S[i] + 0.45);
          if (bb.dl) bb.dl.update(f, (S[i] + 0.9) * FPS, 0);
        });
      };
    },
  };

  // ════════════════════════════════════════════════════════════════════════
  // 5 · SCALE ZOOM — each stat is a square whose AREA is the value, all growing from one corner. The newest square
  //     always fills the same frame: as it grows, the camera pulls back and the earlier squares shrink inside it, so
  //     you feel how much bigger it got. A side panel carries the number and "× vs first".
  // ════════════════════════════════════════════════════════════════════════
  V.scale = {
    minItems: 2, maxItems: 6,
    name: 'Scale Zoom',
    use: 'How much bigger a value is than the one before: growth across periods.',
    example: 'Annual revenue by year: each year is a square that grows from the same corner.',
    avoid: 'Values that shrink or stay close together; the squares will not visibly grow.',
    note: 'Scale zoom: each value is a square whose area is the number, all growing from one corner. The newest square always fills the frame — the camera pulls back and the older squares shrink inside it, so you feel the growth.',
    duration: (n, P) => durOf(n, P),
    build(stage, data, _U, o) {
      const items = data.items, n = items.length, B = beat(o.P), S = starts(n, o.P);
      const head = U.head(stage, data);
      const vmax = vmaxOf(items);
      const A = { x: 180, y: 975 }, DISP = 640;
      const side = items.map((it) => Math.max(0.02, Math.sqrt(Math.abs(parsed(it).v) / vmax)));
      const view = el('div', 'zs-view'); stage.append(view);
      const ctx = data.yAxis ? [ctxEl(stage, 'ctx-under', `Square area = ${esc(data.yAxis)}`, `left:${A.x}px;width:${DISP}px;top:${A.y + 22}px;text-align:left`)] : [];
      const sq = items.map((it, i) => {
        const e = el('div', 'zs-sq' + (it.highlight ? ' hi' : ''));
        e.style.setProperty('--ac', it.highlight ? 'var(--secondary)' : U.accent(i));
        e.innerHTML = `<span class="zs-tag">${esc(it.prefix || '')}${fmtVal(it, parsed(it).v)}${esc(it.suffix || '')}<em>${esc(it.label)}</em></span>`;
        view.append(e);
        return { e, tag: e.firstChild };
      });
      const panel = el('div', 'zs-panel'); stage.append(panel);
      const v0 = parsed(items[0]).v;
      const beats = items.map((it, i) => {
        const box = el('div', 'zs-beat');
        const num = el('div', 'zs-num' + (it.highlight ? ' hi' : ''));
        const lab = words(it.label, 'zs-label', 'track');
        box.append(num, lab.el);
        const v = parsed(it).v;
        let ratio = null;
        if (i > 0 && v0 !== 0) { ratio = el('div', 'zs-ratio', `<b>×${(v / v0).toFixed(v / v0 >= 10 ? 0 : 1)}</b> vs ${esc(items[0].label)}`); box.append(ratio); }
        const dl = U.deltaOf(it) ? U.delta(U.deltaOf(it), 'lg') : null;
        if (dl) { const w = el('div', 'zs-delta'); w.append(dl.el); box.append(w); }
        panel.append(box);
        return { box, num, lab, ratio, dl, it, v };
      });
      return (f) => {
        const t = f / FPS;
        head(f);
        ctx.forEach((e) => { e.style.opacity = expoOut(win(f / FPS, 0.2, 0.6)).toFixed(3); });
        const k = Math.max(0, activeAt(S, t));
        // camera zoom: the active square's side always maps to DISP pixels
        let cur = side[0];
        for (let i = 1; i < n; i++) cur = lerp(cur, side[i], inOut(win(t, S[i] + 0.05, 1.2)));
        const zoom = DISP / cur;
        sq.forEach((s, i) => {
          const g = expoOut(win(t, S[i] + 0.05, i === 0 ? 1.1 : 1.2));
          const px = side[i] * zoom * g;
          const active = i === k;
          s.e.style.left = `${A.x}px`; s.e.style.top = `${(A.y - px).toFixed(1)}px`;
          s.e.style.width = s.e.style.height = `${px.toFixed(1)}px`;
          s.e.style.visibility = g > 0.001 ? 'visible' : 'hidden';
          s.e.classList.toggle('on', active);
          s.e.style.zIndex = String(100 - Math.round(side[i] * 50));
          const fit = clamp((px - 90) / 80);
          s.tag.style.opacity = (fit * expoOut(win(t, S[i] + 0.5, 0.6))).toFixed(3);
          s.tag.style.fontSize = `${Math.min(30, 16 + px / 30).toFixed(1)}px`;
        });
        beats.forEach((b, i) => {
          const s = S[i], last = i === n - 1;
          const kk = expoOut(win(t, s + (i ? 0.35 : 0.1), 0.8)), x = last ? 0 : inOut(win(t, s + B - 0.05, 0.32));
          b.box.style.visibility = t >= s && (last || t < s + B + 0.5) ? 'visible' : 'hidden';
          const from = i > 0 ? beats[i - 1].v : 0;
          b.num.innerHTML = numHTML(b.it, lerp(from, b.v, quartOut(win(t, s + 0.05, 1.2))));
          TXT.track(b.num, kk, x);
          wordsAt(b.lab, t, s + 0.3, x);
          if (b.ratio) fx(b.ratio, expoOut(win(t, s + 1.05, 0.6)), x, 18, 8);
          if (b.dl) b.dl.update(f, (s + 1.3) * FPS, x);
        });
      };
    },
  };

  // ════════════════════════════════════════════════════════════════════════
  // 6 · COMET TRAIL — a glowing comet draws the line from value to value. The number rides on the comet and is the
  //     value of the line right under it, so it flows continuously between points. The camera tracks the comet with
  //     look-ahead space, pausing at each point where a pin drops; at the end it pulls back to show the whole path.
  // ════════════════════════════════════════════════════════════════════════
  V.comet = {
    minItems: 2, maxItems: 8,
    name: 'Comet Trail',
    use: 'A trend over time, where the order of the points matters.',
    example: 'Monthly active users across twelve months, drawn as a line through each month.',
    avoid: 'Unordered categories; the line implies a sequence.',
    note: 'Comet trail: a glowing comet draws the line; the number riding on it is the value of the line under it, so it flows between points, and a level line reads its height straight off the axis. Pins drop in at each point.',
    duration: (n, P) => durOf(n, P, 2.4),
    build(stage, data, _U, o) {
      const items = data.items, n = items.length, B = beat(o.P), S = starts(n, o.P);
      const head = U.head(stage, data);
      const vmax = vmaxOf(items);
      const VW = 1920, VH = 860, VY = 210;
      const view = el('div', 'cm-view'); view.style.top = `${VY}px`; view.style.height = `${VH}px`; stage.append(view);
      const world = el('div', 'cm-world'); view.append(world);
      const X0 = 230, X1 = 1690, YB = 700, YT = 170;
      const pts = items.map((it, i) => ({ x: n > 1 ? X0 + (i * (X1 - X0)) / (n - 1) : 960, y: YB - (Math.abs(parsed(it).v) / vmax) * (YB - YT), v: parsed(it).v, it }));
      // Catmull-Rom → cubic Bézier per segment
      const segs = pts.slice(0, -1).map((p1, i) => {
        const p0 = pts[i - 1] || p1, p2 = pts[i + 1], p3 = pts[i + 2] || p2;
        return { p1, c1: { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 }, c2: { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 }, p2 };
      });
      const bez = (s, u) => {
        const a = (1 - u) ** 3, b = 3 * (1 - u) ** 2 * u, c = 3 * (1 - u) * u * u, d = u ** 3;
        return { x: a * s.p1.x + b * s.c1.x + c * s.c2.x + d * s.p2.x, y: a * s.p1.y + b * s.c1.y + c * s.c2.y + d * s.p2.y };
      };
      const segD = (s) => `M ${s.p1.x} ${s.p1.y} C ${s.c1.x} ${s.c1.y} ${s.c2.x} ${s.c2.y} ${s.p2.x} ${s.p2.y}`;
      const fullD = segs.length ? segs.map((s, i) => (i ? segD(s).replace(/^M [^C]+/, '') : segD(s))).join(' ') : '';
      const ns = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('width', VW); svg.setAttribute('height', VH); svg.setAttribute('class', 'cm-svg');
      svg.innerHTML = `<defs><linearGradient id="cmA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--primary);stop-opacity:.28"/><stop offset="1" style="stop-color:var(--primary);stop-opacity:0"/></linearGradient>
          <clipPath id="cmC"><rect class="cm-clip" x="0" y="0" width="0" height="${VH}"/></clipPath></defs>
        <g class="cm-grid">${[0, 1, 2, 3].map((j) => `<line x1="${X0 - 60}" x2="${X1 + 60}" y1="${YB - (j * (YB - YT)) / 3}" y2="${YB - (j * (YB - YT)) / 3}"/>`).join('')}</g>
        ${fullD ? `<path class="cm-area" clip-path="url(#cmC)" d="${fullD} L ${X1} ${YB} L ${pts[0].x} ${YB} Z"/>` : ''}
        <line class="cm-level"/>${segs.map((s) => `<path class="cm-glow" pathLength="1" d="${segD(s)}"/><path class="cm-line" pathLength="1" d="${segD(s)}"/>`).join('')}`;
      world.append(svg);
      const level = svg.querySelector('.cm-level');
      const axTag = el('div', 'cm-axtag'); world.append(axTag);
      // axis: value ticks on the gridlines and every period label along the baseline, visible from the start
      const a0 = items[0], tdec = vmax / 3 >= 10 ? 0 : 1;
      const axis = [0, 1, 2, 3].map((j) => { const e = el('div', 'cm-tick', `${esc(a0.prefix || '')}${U.fmt((j * vmax) / 3, j ? tdec : 0)}${esc(a0.suffix || '')}`); e.style.left = `${X1 + 80}px`; e.style.top = `${YB - (j * (YB - YT)) / 3}px`; world.append(e); return e; })
        .concat(pts.map((p) => { const e = el('div', 'cm-x', esc(p.it.label)); e.style.left = `${p.x}px`; e.style.top = `${YB + 34}px`; world.append(e); return e; }));
      // axis titles: what runs along the bottom, and what the height measures
      if (data.xAxis) { const e = el('div', 'cm-xt', esc(data.xAxis)); e.style.left = `${(X0 + X1) / 2}px`; e.style.top = `${YB + 80}px`; world.append(e); axis.push(e); }
      if (data.yAxis) { const e = el('div', 'cm-yt', esc(data.yAxis)); e.style.left = `${X1 + 190}px`; e.style.top = `${(YB + YT) / 2}px`; world.append(e); axis.push(e); }
      const clip = svg.querySelector('.cm-clip'), glows = [...svg.querySelectorAll('.cm-glow')], lines = [...svg.querySelectorAll('.cm-line')];
      const pins = pts.map((p, i) => {
        const e = el('div', 'cm-pin' + (p.it.highlight ? ' hi' : ''));
        e.style.left = `${p.x}px`; e.style.top = `${p.y}px`;
        e.innerHTML = `<i class="cm-ring"></i><i class="cm-dot"></i><div class="cm-pl"><b>${esc(p.it.prefix || '')}${fmtVal(p.it, p.v)}${esc(p.it.suffix || '')}</b></div>`;
        world.append(e);
        return { e, ring: e.querySelector('.cm-ring'), lab: e.querySelector('.cm-pl'), dot: e.querySelector('.cm-dot') };
      });
      const comet = el('div', 'cm-comet', '<i class="cm-halo"></i><i class="cm-head"></i>'); world.append(comet);
      const bubble = el('div', 'cm-bubble'); world.append(bubble);
      const travel = Math.min(1.3, B * 0.55);
      const arrive = (i) => S[i] + 0.4;                              // comet reaches point i
      const end = arrive(n - 1) + 0.9;
      const where = (t) => {
        if (t <= arrive(0) || !segs.length) return { ...pts[0], v: pts[0].v, it: pts[0].it, seg: -1 };
        for (let i = 0; i < segs.length; i++) {
          const a = arrive(i + 1) - travel;
          if (t < a) return { ...pts[i], seg: i, u: 0 };
          if (t < arrive(i + 1)) { const u = inOut(win(t, a, travel)); const q = bez(segs[i], u); return { x: q.x, y: q.y, v: lerp(pts[i].v, pts[i + 1].v, u), it: pts[i + 1].it, seg: i, u }; }
        }
        const p = pts[n - 1]; return { ...p, seg: segs.length };
      };
      return (f) => {
        const t = f / FPS;
        head(f);
        axis.forEach((e) => { e.style.opacity = (0.9 * expoOut(win(f / FPS, 0.2, 0.6))).toFixed(3); });
        const c = where(t);
        // lines: done segments full, current one drawing
        lines.forEach((ln, i) => {
          const u = c.seg > i ? 1 : c.seg === i ? c.u || 0 : 0;
          ln.style.strokeDasharray = '1'; ln.style.strokeDashoffset = String(1 - u);
          glows[i].style.strokeDasharray = '1'; glows[i].style.strokeDashoffset = String(1 - u);
        });
        clip.setAttribute('width', Math.max(0, c.x).toFixed(1));
        // comet + riding number
        const born = expoOut(win(t, arrive(0) - 0.5, 0.6));
        comet.style.transform = `translate(${c.x.toFixed(1)}px, ${c.y.toFixed(1)}px) scale(${born.toFixed(3)})`;
        const fade = 1 - inOut(win(t, end, 0.6));
        bubble.innerHTML = numHTML(c.it, c.v);
        bubble.style.transform = `translate(${c.x.toFixed(1)}px, ${c.y.toFixed(1)}px) translate(-50%, -100%) translateY(-54px)`;
        bubble.style.opacity = (born * fade).toFixed(3);
        comet.style.opacity = (0.25 + 0.75 * fade).toFixed(3);
        pins.forEach((p, i) => {
          const a = arrive(i);
          const k = expoOut(win(t, a - 0.05, 0.6));
          p.dot.style.transform = `translate(-50%, -50%) scale(${backOut(win(t, a - 0.05, 0.5), 2.2).toFixed(3)})`;
          const r = win(t, a, 0.9);
          p.ring.style.opacity = r > 0 && r < 1 ? (1 - r).toFixed(3) : 0;
          p.ring.style.transform = `translate(-50%, -50%) scale(${(0.4 + 2.6 * expoOut(r)).toFixed(3)})`;
          const showLab = Math.max(i < n - 1 ? win(t, arrive(i + 1) - travel + 0.1, 0.5) : 0, 1 - fade);
          TXT.drop(p.lab, showLab > 0 ? backOut(showLab, 2.2) : 0, 0);
          void k;
        });
        // level line: the comet's height read straight off the axis
        level.setAttribute('x1', X0 - 70); level.setAttribute('x2', c.x.toFixed(1)); level.setAttribute('y1', c.y.toFixed(1)); level.setAttribute('y2', c.y.toFixed(1));
        level.style.opacity = (born * fade * 0.9).toFixed(3);
        axTag.innerHTML = numHTML(c.it, c.v);
        axTag.style.transform = `translate(${X0 - 84}px, ${c.y.toFixed(1)}px) translate(-100%, -50%)`;
        axTag.style.opacity = (born * fade).toFixed(3);
        world.style.transform = `scale(${(1 + 0.012 * Math.sin(t * 0.5) + 0.02 * win(t, 0, 20)).toFixed(4)})`;
      };
    },
  };

  // ════════════════════════════════════════════════════════════════════════
  // 7 · ODOMETER — every digit is a mechanical reel. Low digits spin more than high ones (as on a real counter),
  //     and each reel's blur follows its own speed. The finished number drops into a history rail below.
  //     (Kept by the owner's choice although Titles · Reel also uses reels: here it is place-value counting physics.)
  // ════════════════════════════════════════════════════════════════════════
  V.odometer = {
    minItems: 1, maxItems: 6,
    name: 'Odometer',
    use: 'One headline counter climbing to a final total (sign-ups, funds raised, visitors).',
    example: 'Total donations raised so far this year, counting up to the final figure.',
    avoid: 'Several numbers that need comparing; reels are read one at a time.',
    note: 'Odometer: each digit is a reel that spins and lands — the ones digit spins most, like a real counter, and blur follows each reel\'s speed. Finished numbers drop into a history rail.',
    duration: (n, P) => durOf(n, P),
    build(stage, data, _U, o) {
      const items = data.items, n = items.length, B = beat(o.P), S = starts(n, o.P);
      const head = U.head(stage, data);
      const world = el('div', 'fx-world'); stage.append(world);
      const rail = el('div', 'od-rail'); world.append(rail);
      const ctx = data.yAxis ? [ctxEl(stage, 'ctx-under', esc(data.yAxis), 'left:0;right:0;top:250px')] : [];

      const beats = items.map((it) => {
        const { v, dec } = parsed(it);
        const chars = Array.from(U.fmt(v, dec));
        const digitAt = []; chars.forEach((c, ci) => { if (/\d/.test(c)) digitAt.push(ci); });
        const D = digitAt.length;
        const layer = el('div', 'od-layer' + (it.highlight ? ' hi' : ''));
        const halo = el('div', 'od-halo');
        const num = el('div', 'od-num');
        let html = it.prefix ? `<span class="od-aff">${esc(it.prefix)}</span>` : '';
        chars.forEach((c, ci) => {
          if (/\d/.test(c)) {
            const fromRight = D - 1 - digitAt.indexOf(ci);
            const spins = D - fromRight + 1;                       // ones digit spins most
            const strip = Array.from({ length: (spins + 1) * 10 }, (_, j) => `<span>${j % 10}</span>`).join('');
            html += `<span class="od-col" data-d="${c}" data-s="${spins}" data-r="${D - 1 - fromRight}"><span class="od-ghost">0</span><span class="od-strip">${strip}</span></span>`;
          } else html += `<span class="od-sep">${esc(c)}</span>`;
        });
        if (it.suffix) html += `<span class="od-aff">${esc(it.suffix)}</span>`;
        num.innerHTML = html;
        const lab = words(it.label, 'od-label', 'flip');
        const dl = U.deltaOf(it) ? U.delta(U.deltaOf(it), 'lg') : null;
        const col = el('div', 'od-stack'); col.append(num, lab.el);
        if (dl) { const w = el('div', 'od-delta'); w.append(dl.el); col.append(w); }
        layer.append(halo, col); world.append(layer);
        const chip = el('div', 'od-chip', `<b>${esc(it.prefix || '')}${U.fmt(v, dec)}${esc(it.suffix || '')}</b><span>${esc(it.label)}</span>`);
        rail.append(chip);
        const cols = [...num.querySelectorAll('.od-col')].map((c) => ({ strip: c.lastChild, d: +c.dataset.d, s: +c.dataset.s, r: +c.dataset.r }));
        return { layer, halo, col, num, cols, seps: [...num.querySelectorAll('.od-sep, .od-aff')], lab, dl, chip };
      });

      const reel = (t, s, c) => { const k = win(t, s + 0.15 + c.r * 0.05, 1.25 + c.s * 0.1); return quartOut(k) * (c.s * 10 + c.d); };

      return (f) => {
        const t = f / FPS;
        head(f);
        ctx.forEach((e) => { e.style.opacity = expoOut(win(f / FPS, 0.2, 0.6)).toFixed(3); });
        beats.forEach((b, i) => {
          const s = S[i], last = i === n - 1;
          const x = last ? 0 : inOut(win(t, s + B, 0.5));
          const on = t >= s - 0.05 && (last || t < s + B + 0.55);
          b.layer.style.visibility = on ? 'visible' : 'hidden';
          const k = expoOut(win(t, s, 0.8));
          b.layer.style.transform = `scale(${(1 + 0.035 * win(t, s, B + 1)).toFixed(4)})`;            // hold life: slow push-in
          b.col.style.opacity = clamp(k * (1 - x)).toFixed(3);
          b.col.style.transform = `translateY(${((1 - k) * 40 + x * 300).toFixed(1)}px) scale(${(1 - x * 0.62).toFixed(4)})`;   // drops toward the rail
          b.col.style.filter = x > 0.02 ? `blur(${(x * 10).toFixed(1)}px)` : '';
          b.cols.forEach((c) => {
            const p = reel(t, s, c), vel = Math.abs(p - reel(t - 1 / FPS, s, c));    // digits per frame
            c.strip.style.transform = `translateY(${(-p).toFixed(3)}em)`;
            c.strip.style.filter = vel > 0.04 ? `blur(${Math.min(9, vel * 7).toFixed(1)}px)` : '';
          });
          b.seps.forEach((e) => { e.style.opacity = expoOut(win(t, s + 0.9, 0.5)).toFixed(3); });
          wordsAt(b.lab, t, s + 0.45);
          if (b.dl) b.dl.update(f, (s + 1.45) * FPS, 0);
          const hp = win(t, s + 1.5, 1.4);
          b.halo.style.opacity = ((Math.sin(hp * Math.PI) * 0.9 + (hp > 0 ? 0.25 : 0)) * (1 - x)).toFixed(3);
          b.halo.style.transform = `translate(-50%, -50%) scale(${(0.7 + 0.5 * expoOut(hp)).toFixed(3)})`;
          if (!last) fx(b.chip, expoOut(win(t, s + B + 0.3, 0.7)), 0, 30, 10);
          else b.chip.style.opacity = 0;
        });
      };
    },
  };

  function mount(id) {
    const v = V[id];
    SM.mount({ id, name: v.name, minItems: v.minItems, maxItems: v.maxItems, note: v.note, use: v.use, example: v.example, avoid: v.avoid, duration: v.duration, build: v.build });
  }
  window.StatsFX = { mount, variants: V };
})();
