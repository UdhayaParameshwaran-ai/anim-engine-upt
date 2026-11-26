/* Comparison — one content, five ways to show "this vs that". Reuses the process-steps shell + motion kit.
 * Items: item 1 = the two side names (title = left / before, detail = right / after). Items 2+ = one row each
 * (title = left point, detail = right point, icon = the aspect). The right side is treated as the better one.
 * Signature motions (../MOTION-LEDGER.md): handle wipe · verdict ticks · balance tipping · card flip · versus clash.
 */
(function () {
  'use strict';
  const SM = window.StepsMotion, U = SM.U, K = window.StepsFX.kit;
  const { clamp, lerp, esc, el } = U;
  const { expoOut, inOut, backOut, win, words, wordsAt, drawIcon, durOf, starts, activeAt, beat, fx } = K;
  const FPS = 30;
  const CROSS = '<svg class="ic" viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 6l12 12" pathLength="1" style="stroke-dasharray:1"/><path d="M18 6L6 18" pathLength="1" style="stroke-dasharray:1"/></svg>';
  const split = (data) => { const [h, ...rows] = data.items; return { L: h ? h.title : 'Before', R: h ? h.detail || 'After' : 'After', rows: rows.slice(0, 5) }; };
  const dur = (n, P) => durOf(Math.max(1, n - 1), P, 2.2);
  const pop = (e, t, a, s = 2.4) => { const k = win(t, a, 0.45); e.style.opacity = clamp(k * 3).toFixed(3); e.style.transform = `scale(${backOut(k, s).toFixed(3)})`; };
  const V = {};

  // 1 · SPLIT WIPE — a drag handle sweeps in from the right and parts the frame into Before | After; each row then
  //     wipes in on both sides while the handle nudges, like someone sliding to compare.
  V.split = {
    name: 'Split Wipe',
    note: 'Split wipe: a slider handle sweeps in and parts the frame into before | after; each row then wipes in on both sides while the handle nudges, like someone dragging to compare.',
    duration: dur,
    build(stage, data, o) {
      const { L, R, rows } = split(data), n = rows.length, S = starts(n, o.P).map((s) => s + 0.9), head = U.head(stage, data);
      const before = el('div', 'cs-pane cs-before', `<span class="cs-tag">${esc(L)}</span>`), after = el('div', 'cs-pane cs-after', `<span class="cs-tag">${esc(R)}</span>`);
      const handle = el('div', 'cs-handle', '<i></i><b>⟷</b>');
      stage.append(before, after, handle);
      const base = Math.max(340, 610 - (n * 124) / 2);
      before.firstChild.style.top = after.firstChild.style.top = `${base - 210 - 100}px`;
      handle.querySelector('b').style.top = `${base + n * 124 - 210 + 4}px`;
      const lines = rows.map((r, i) => {
        const y = base + i * 124;
        const a = words(r.title, 'cs-row cs-l', 'wipe'), b = words(r.detail, 'cs-row cs-r', 'wipe');
        a.el.style.top = b.el.style.top = `${y}px`;
        const ic = el('span', 'cs-ic', U.icon(r.icon || 'star', 34, 2.2)); ic.style.top = `${y + 2}px`;
        stage.append(a.el, b.el, ic); return { a, b, ic };
      });
      return (f) => {
        const t = f / FPS, k = activeAt(S, t);
        head(f);
        const sweep = backOut(win(t, 0.2, 1.0), 1.2);
        const nudge = k >= 0 ? Math.sin(win(t, S[k], 0.5) * Math.PI) * 26 : 0;
        const x = lerp(1900, 960, sweep) + nudge;
        after.style.clipPath = `inset(0 0 0 ${x.toFixed(1)}px)`;
        handle.style.transform = `translateX(${x.toFixed(1)}px)`;
        lines.forEach((ln, i) => {
          wordsAt(ln.a, t, S[i], 0, 0.05); wordsAt(ln.b, t, S[i] + 0.25, 0, 0.05);
          pop(ln.ic, t, S[i] - 0.1, 1.8);
          const d = t < S[i] - 0.15 ? 0 : k > i ? 0.6 : 1; ln.a.el.style.opacity = ln.b.el.style.opacity = d;
        });
      };
    },
  };

  // 2 · VERDICT COLUMNS — two cards side by side; each row lands as a pair and gets its verdict: the left draws a
  //     cross, the right draws a tick with a ripple. A highlight band walks down the rows.
  V.columns = {
    name: 'Verdict Columns',
    note: 'Verdict columns: two cards side by side; each row lands as a pair and gets its verdict — a drawn cross on the left, a tick with a ripple on the right — while a highlight band walks down the rows.',
    duration: dur,
    build(stage, data, o) {
      const { L, R, rows } = split(data), n = rows.length, S = starts(n, o.P).map((s) => s + 0.4), head = U.head(stage, data);
      const RH = Math.min(124, 620 / Math.max(1, n)), CT = Math.max(230, 610 - (n * RH + 150) / 2), Y0 = CT + 140;
      const band = el('div', 'cv-band'); stage.append(band);
      const cards = [['cv-card cv-l', L, 'var(--negative)'], ['cv-card cv-r', R, 'var(--positive)']].map(([c, lbl, col]) => { const e = el('div', c, `<div class="cv-h">${esc(lbl)}</div>`); e.style.setProperty('--vc', col); stage.append(e); return e; });
      cards.forEach((c) => { c.style.height = `${n * RH + 150}px`; c.style.top = `${CT}px`; });
      const cells = rows.map((r, i) => {
        const y = Y0 + i * RH;
        const a = words(r.title, 'cv-cell cv-cl', 'mask'), b = words(r.detail, 'cv-cell cv-cr', 'mask');
        a.el.style.top = b.el.style.top = `${y}px`;
        const xm = el('span', 'cv-mark cv-x', CROSS), ck = el('span', 'cv-mark cv-ok', `${U.icon('check', 30, 3)}<i class="cv-rip"></i>`);
        xm.style.top = ck.style.top = `${y - 4}px`;
        stage.append(a.el, b.el, xm, ck);
        return { a, b, xm, ck, rip: ck.querySelector('.cv-rip'), y };
      });
      return (f) => {
        const t = f / FPS, k = activeAt(S, t);
        head(f);
        cards.forEach((c, j) => fx(c, expoOut(win(t, 0.1 + j * 0.12, 0.7)), 0, 40, 8));
        if (k >= 0) { const y = lerp(cells[Math.max(0, k - 1)].y, cells[k].y, backOut(win(t, S[k] - 0.1, 0.5), 1.4)); band.style.transform = `translateY(${(y - 36).toFixed(1)}px)`; }
        band.style.opacity = k >= 0 ? 1 : 0;
        cells.forEach((c, i) => {
          wordsAt(c.a, t, S[i], 0, 0.05); wordsAt(c.b, t, S[i] + 0.3, 0, 0.05);
          pop(c.xm, t, S[i] + 0.55); drawIcon(c.xm, expoOut(win(t, S[i] + 0.6, 0.4)));
          pop(c.ck, t, S[i] + 0.85); drawIcon(c.ck, expoOut(win(t, S[i] + 0.9, 0.4)));
          const q = win(t, S[i] + 0.9, 0.6); c.rip.style.opacity = q > 0 && q < 1 ? 1 - q : 0; c.rip.style.transform = `scale(${0.4 + 2.2 * expoOut(q)})`;
        });
      };
    },
  };

  // 3 · BALANCE — a beam scale. For each row a block drops into each pan; the right side keeps winning, so the beam
  //     tips a little further every time and wobbles as it settles.
  V.balance = {
    name: 'Balance',
    note: 'Balance: a beam scale. For each row a block drops into each pan; the right side keeps winning, so the beam tips a little further every time and wobbles as it settles.',
    duration: dur,
    build(stage, data, o) {
      const { L, R, rows } = split(data), n = rows.length, S = starts(n, o.P).map((s) => s + 0.6), head = U.head(stage, data);
      const CX = 960, CY = 470, ARM = 560;
      const stand = el('div', 'bl-stand'), beam = el('div', 'bl-beam'); stage.append(stand, beam);
      const pans = [L, R].map((lbl, j) => { const p = el('div', `bl-pan ${j ? 'bl-pr' : 'bl-pl'}`, `<i class="bl-str"></i><div class="bl-dish"></div><span class="bl-lbl">${esc(lbl)}</span>`); stage.append(p); return p; });
      const chips = rows.flatMap((r, i) => [0, 1].map((j) => { const w = words(j ? r.detail : r.title, `bl-chip ${j ? 'bl-cr' : 'bl-cl'}`, 'drop'); stage.append(w.el); return { w, i, j }; }));
      const land = (i) => S[i] + 0.55;
      const angle = (t) => {
        let a = 0;
        S.forEach((_, i) => { if (t >= land(i)) { const q = t - land(i); a += 2.6 * (1 - Math.exp(-6 * q) * Math.cos(q * 16)); } });
        return clamp(a, -14, 14) * Math.PI / 180;
      };
      return (f) => {
        const t = f / FPS;
        head(f);
        const a = angle(t), intro = expoOut(win(t, 0.1, 0.8));
        stand.style.opacity = beam.style.opacity = intro;
        beam.style.transform = `translate(${CX}px, ${CY}px) rotate(${a}rad) scaleX(${intro})`;
        const ends = [-1, 1].map((s) => ({ x: CX + s * ARM * Math.cos(a), y: CY + s * ARM * Math.sin(a) }));
        pans.forEach((p, j) => { p.style.transform = `translate(${ends[j].x.toFixed(1)}px, ${ends[j].y.toFixed(1)}px)`; p.style.opacity = intro; });
        chips.forEach((c) => {
          const e = ends[c.j], slotY = e.y + 238 - c.i * 64;
          const fall = clamp((t - (S[c.i] + c.j * 0.12)) / 0.43);
          const y = lerp(150, slotY, fall * fall) - (fall >= 1 ? Math.abs(Math.sin((t - land(c.i)) * 14)) * 10 * Math.exp(-5 * (t - land(c.i))) : 0);
          c.w.el.style.transform = `translate(${e.x.toFixed(1)}px, ${y.toFixed(1)}px) translateX(-50%)`;
          c.w.el.style.opacity = fall > 0 ? 1 : 0;
          wordsAt(c.w, t, land(c.i) - 0.1, 0, 0.03);
        });
      };
    },
  };

  // 4 · FLIP CARDS — each card shows the problem; on its beat it flips over in 3D (lifting as it turns) to show the
  //     solution on its back.
  V.flip = {
    name: 'Flip Cards',
    note: 'Flip cards: each card shows the problem; on its beat it flips over in 3D, lifting as it turns, to show the solution on its back.',
    duration: dur,
    build(stage, data, o) {
      const { L, R, rows } = split(data), n = rows.length, S = starts(n, o.P).map((s) => s + 0.5), head = U.head(stage, data);
      const cols = n > 3 ? Math.ceil(n / 2) : n, CW = cols === 2 ? 560 : 440, CH = 300, G = 32;
      const x0 = 960 - (cols * CW + (cols - 1) * G) / 2, y0 = n > 3 ? 300 : 420;
      stage.append(el('div', 'fl-legend', `<span>${esc(L)}</span><b>→</b><span class="on">${esc(R)}</span>`));
      const cards = rows.map((r, i) => {
        const c = el('div', 'fl-card');
        Object.assign(c.style, { width: `${CW}px`, left: `${x0 + (i % cols) * (CW + G)}px`, top: `${y0 + Math.floor(i / cols) * (CH + G)}px` });
        c.innerHTML = `<div class="fl-face fl-front"><span class="fl-ic">${CROSS}</span><div class="fl-t"></div></div><div class="fl-face fl-back"><span class="fl-ic">${U.icon('check', 30, 3)}</span><div class="fl-was">Was: ${esc(r.title)}</div><div class="fl-t"></div></div>`;
        const a = words(r.title, 'fl-txt', 'blur'), b = words(r.detail, 'fl-txt', 'blur');
        c.querySelector('.fl-front .fl-t').append(a.el); c.querySelector('.fl-back .fl-t').append(b.el);
        stage.append(c); return { c, a, b };
      });
      return (f) => {
        const t = f / FPS;
        head(f);
        cards.forEach((cd, i) => {
          const q = inOut(win(t, S[i], 0.7)), lift = Math.sin(Math.PI * q);
          cd.c.style.opacity = expoOut(win(t, 0.15 + i * 0.07, 0.6));
          cd.c.style.transform = `perspective(1400px) rotateY(${(q * 180).toFixed(2)}deg) scale(${(1 + 0.08 * lift).toFixed(4)}) translateZ(${(lift * 40).toFixed(1)}px)`;
          wordsAt(cd.a, t, 0.3 + i * 0.07, 0, 0.04); wordsAt(cd.b, t, S[i] + 0.4, 0, 0.05);
        });
      };
    },
  };

  // 5 · VERSUS — the two sides charge in from the edges and collide in the middle: a flash, a shockwave and a "VS"
  //     badge, then they recoil apart and each row is called out on alternating sides.
  V.versus = {
    name: 'Versus',
    note: 'Versus: the two sides charge in from the edges and collide in the middle — flash, shockwave, a VS badge — then recoil apart, and each row is called out on alternating sides.',
    duration: dur,
    build(stage, data, o) {
      const { L, R, rows } = split(data), n = rows.length, S = starts(n, o.P).map((s) => s + 1.2), head = U.head(stage, data);
      const tl = el('div', 'vs-tile vs-l', esc(L)), tr = el('div', 'vs-tile vs-r', esc(R)), badge = el('div', 'vs-badge', 'VS'), ring = el('i', 'vs-ring'), flash = el('i', 'vs-flash');
      stage.append(flash, ring, tl, tr, badge);
      const lines = rows.map((r, i) => {
        const y = 510 + i * 104;
        const a = words(r.title, 'vs-line vs-ll', 'scale'), b = words(r.detail, 'vs-line vs-lr', 'scale');
        a.el.style.top = b.el.style.top = `${y}px`; stage.append(a.el, b.el); return { a, b };
      });
      const HIT = 0.75;
      return (f) => {
        const t = f / FPS;
        head(f);
        const run = win(t, 0.15, HIT - 0.15), charge = run * run;                    // accelerates into the hit
        const rec = t > HIT ? Math.exp(-5 * (t - HIT)) * Math.sin((t - HIT) * 14) * 30 + 34 * expoOut(win(t, HIT, 0.5)) : 0;
        tl.style.transform = `translateX(${(lerp(-1000, 0, charge) - rec).toFixed(1)}px)`;
        tr.style.transform = `translateX(${(lerp(1000, 0, charge) + rec).toFixed(1)}px)`;
        const h = win(t, HIT, 0.5);
        flash.style.opacity = h > 0 && h < 1 ? ((1 - h) * 0.8).toFixed(3) : 0;
        ring.style.opacity = h > 0 && h < 1 ? (1 - h).toFixed(3) : 0; ring.style.transform = `translate(-50%, -50%) scale(${(0.2 + 4 * expoOut(h)).toFixed(3)})`;
        pop(badge, t, HIT, 2.8);
        lines.forEach((ln, i) => { wordsAt(ln.a, t, S[i], 0, 0.05); wordsAt(ln.b, t, S[i] + 0.3, 0, 0.05); });
      };
    },
  };

  const SET = {
    title: 'Comparison', item: 'Row', ph: ['Left side (row 1: left name)', 'Right side (row 1: right name)'],
    storageKey: 'comparison-data-v1',
    variants: [
      { id: 'split', file: 'v1-split-wipe.html', name: 'Split Wipe' },
      { id: 'columns', file: 'v2-verdict-columns.html', name: 'Verdict Columns' },
      { id: 'balance', file: 'v3-balance.html', name: 'Balance' },
      { id: 'flip', file: 'v4-flip-cards.html', name: 'Flip Cards' },
      { id: 'versus', file: 'v5-versus.html', name: 'Versus' },
    ],
    defaults: {
      pace: 'normal', motion: 'default', order: 'forward',
      kicker: 'Before vs after', heading: 'Manual reports vs automated reports',
      items: [
        { title: 'Manual', detail: 'Automated', icon: 'layers' },
        { title: '3 days to build', detail: 'Ready in 5 minutes', icon: 'clock' },
        { title: 'Copy-paste errors', detail: 'Checked on every sync', icon: 'shield' },
        { title: 'Stale by Monday', detail: 'Live, every hour', icon: 'chart' },
        { title: 'One person knows how', detail: 'Anyone can share it', icon: 'user' },
      ],
    },
  };
  window.ComparisonFX = { variants: V, set: SET, mount: (id) => SM.mount({ id, name: V[id].name, note: V[id].note, duration: V[id].duration, build: V[id].build, set: SET }) };
})();
