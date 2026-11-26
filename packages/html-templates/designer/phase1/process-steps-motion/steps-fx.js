/* Process Steps · Motion set — six ways to walk through a process, each with its own motion idea.
 *
 * Shared rules (from the motion research):
 *   · Rule of one   — the current step has the motion; finished steps dim and soften, future steps wait as ghosts.
 *   · Blur-rise     — text arrives word by word out of blur (expo-out), exits fast and blurred.
 *   · Eye-trace     — each motion ends where the next step will appear.
 *   · Hold life     — camera drift / ambient motion so a hold never freezes.
 *   · Resolve       — at the end the whole process comes back into view so it is remembered as one thing.
 *
 * Variants:  morph · deck · accordion · orbit · stack · domino · path · dolly · rail   (see ../MOTION-LEDGER.md — every signature motion is used once)
 * Each page calls  StepsFX.mount('<id>')  → StepsMotion.mount() (steps-core.js) with its own build() and duration().
 */
(function () {
  'use strict';

  const SM = window.StepsMotion;
  const U = SM.U;
  const { clamp, lerp, esc, el } = U;
  const FPS = 30;

  const expoOut = (k) => (k >= 1 ? 1 : 1 - Math.pow(2, -10 * k));
  const quartOut = (k) => 1 - Math.pow(1 - clamp(k), 4);
  const inOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
  const backOut = (k, s = 1.7) => { const c3 = s + 1; return 1 + c3 * Math.pow(k - 1, 3) + s * Math.pow(k - 1, 2); };
  const win = (t, a, d) => clamp((t - a) / Math.max(0.001, d));
  const rnd = (i) => { const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };
  const accent = (i) => `var(--${['primary', 'secondary', 'tertiary', 'quaternary'][i % 4]})`;
  const pad = (i) => String(i + 1).padStart(2, '0');

  const beat = (P) => 0.9 * P.stagger + 1.6 * P.hold;
  const T0 = 0.7;
  const durOf = (n, P, tail = 1.8) => Math.round((T0 + n * beat(P) + tail) * FPS);
  const starts = (n, P) => [...Array(n).keys()].map((i) => T0 + i * beat(P));
  const activeAt = (S, t) => { let k = -1; S.forEach((s, i) => { if (t >= s) k = i; }); return k; };

  const fx = (e, k, x = 0, dy = 24, bl = 10) => {
    e.style.opacity = clamp(k * (1 - x)).toFixed(3);
    e.style.transform = `translateY(${((1 - k) * dy - x * dy).toFixed(1)}px)`;
    const b = (1 - k) * bl + x * bl;
    e.style.filter = b > 0.3 ? `blur(${b.toFixed(1)}px)` : '';
  };
  /* Text treatments. The signature motion of each variant is unique; the supporting text also gets its own
   * treatment chosen to echo that motion, so no two variants in a set share one:
   *   blur  — out of soft focus, rising        mask  — slides up from behind an edge (rising liquid, a card face)
   *   wipe  — revealed left→right (a ruler, a sliding highlight)   track — letters draw together (a zoom settling)
   *   scale — shrinks into place (inflating, morphing)              drop  — falls in and settles (gravity) */
  const TXT = {
    blur: (w, k, x) => fx(w, k, x, 22, 9),
    mask: (w, k, x) => { w.style.opacity = (k > 0 ? 1 - x : 0).toFixed(3); w.style.transform = `translateY(${((1 - k) * 110 - x * 110).toFixed(1)}%)`; w.style.filter = ''; },
    wipe: (w, k, x) => { w.style.opacity = (k > 0 ? 1 - x : 0).toFixed(3); w.style.clipPath = `inset(-30% ${((1 - clamp(k)) * 100).toFixed(1)}% -30% -2%)`; w.style.transform = `translateX(${((1 - k) * -16 - x * 16).toFixed(1)}px)`; w.style.filter = ''; },
    track: (w, k, x) => { w.style.opacity = clamp(k * 1.4 * (1 - x)).toFixed(3); w.style.letterSpacing = `${((1 - k) * 0.45 + x * 0.15).toFixed(3)}em`; const b = (1 - k) * 6 + x * 6; w.style.filter = b > 0.3 ? `blur(${b.toFixed(1)}px)` : ''; },
    scale: (w, k, x) => { w.style.opacity = clamp(k * 2 * (1 - x)).toFixed(3); w.style.transform = `scale(${(1.35 - 0.35 * k - x * 0.12).toFixed(4)})`; const b = (1 - k) * 5 + x * 6; w.style.filter = b > 0.3 ? `blur(${b.toFixed(1)}px)` : ''; },
    flip: (w, k, x) => { w.style.opacity = clamp(k * 2 * (1 - x)).toFixed(3); w.style.transform = `perspective(600px) rotateX(${((1 - k) * -85 + x * 60).toFixed(2)}deg)`; w.style.transformOrigin = '50% 0'; w.style.filter = ''; },
    slide: (w, k, x) => { w.style.opacity = clamp(k * 1.6 * (1 - x)).toFixed(3); w.style.transform = `translateX(${((1 - k) * 70 - x * 50).toFixed(1)}px) skewX(${((1 - k) * -10).toFixed(2)}deg)`; w.style.filter = ''; },
    shear: (w, k, x) => { w.style.opacity = clamp(k * 1.6 * (1 - x)).toFixed(3); w.style.transform = `translateY(${((1 - k) * 34 - x * 24).toFixed(1)}px) skewY(${((1 - k) * 7).toFixed(2)}deg)`; w.style.transformOrigin = '0 100%'; w.style.filter = ''; },
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
  const drawIcon = (root, p) => root.querySelectorAll('[pathLength]').forEach((e) => { e.style.strokeDashoffset = String(1 - clamp(p)); });
  const dimTo = (e, d) => { e.style.opacity = d.toFixed(3); const b = (1 - d) * 2.4; e.style.filter = b > 0.3 ? `blur(${b.toFixed(1)}px)` : ''; };

  const V = {};

  // ════════════════════════════════════════════════════════════════════════
  // 1 · MORPH RELAY — one shape carries the whole process. At each step it morphs into a new form (circle → squircle
  //     → hexagon → diamond → flower → star), turning and squashing as it changes, taking on the step's colour while its
  //     icon swaps through it. Each finished form is stamped into a row below, so the stages stay readable.
  // ════════════════════════════════════════════════════════════════════════
  V.morph = {
    name: 'Morph Relay',
    note: 'Morph relay: one shape carries the whole process. At each step it morphs into a new form — circle, squircle, hexagon, diamond, flower, star — turning and squashing as it changes and taking the step colour while its icon swaps. Every finished form is stamped into the row below.',
    duration: (n, P) => durOf(n, P),
    build(stage, data, o) {
      const steps = data.items, n = steps.length, B = beat(o.P), S = starts(n, o.P);
      const head = U.head(stage, data);
      const NP = 72;
      const poly = (seg, k) => (a) => { const b = (((a + Math.PI / 2) % seg) + seg) % seg - seg / 2; return k * Math.cos(seg / 2) / Math.cos(b); };
      const FORMS = [
        () => 0.96,
        (a) => 0.94 / Math.pow(Math.pow(Math.abs(Math.cos(a)), 4) + Math.pow(Math.abs(Math.sin(a)), 4), 0.25),
        poly(Math.PI / 3, 1.0),
        (a) => 1.0 / (Math.abs(Math.cos(a)) + Math.abs(Math.sin(a))),
        (a) => 0.8 + 0.18 * Math.cos(6 * a),
        (a) => 0.5 + 0.48 * Math.pow(Math.abs(Math.cos(2 * a)), 2.2),
      ];
      const form = (i) => FORMS[i % FORMS.length];
      const clip = (rf) => `polygon(${[...Array(NP).keys()].map((j) => { const a = (j / NP) * Math.PI * 2, r = rf(a); return `${(50 + 50 * r * Math.cos(a)).toFixed(2)}% ${(50 + 50 * r * Math.sin(a)).toFixed(2)}%`; }).join(',')})`;
      const wrap = el('div', 'mr-wrap'); const shape = el('div', 'mr-shape');
      const icons = steps.map((s) => { const e = el('div', 'mr-ic', U.icon(s.icon || 'star', 150, 1.8)); shape.append(e); return e; });
      wrap.append(shape); stage.append(wrap);
      const row = el('div', 'mr-row');
      const stamps = steps.map((s, i) => { const e = el('i', 'mr-stamp'); e.style.clipPath = clip(form(i)); e.style.setProperty('--ac', accent(i)); row.append(e); return e; });
      row.style.marginLeft = `${-(n * 96 - 26) / 2}px`;
      stage.append(row);
      const panes = steps.map((s, i) => {
        const p = el('div', 'mr-pane'); p.style.setProperty('--ac', accent(i));
        const k = el('div', 'mr-k', `Step ${i + 1} of ${n}`);
        const ti = words(s.title, 'mr-title', 'track'), de = words(s.detail, 'mr-detail', 'track');
        p.append(k, ti.el, de.el); stage.append(p); return { p, k, ti, de };
      });
      const morphAt = (t, i) => (i === 0 ? 1 : inOut(win(t, S[i] - 0.1, 0.9)));
      return (f) => {
        const t = f / FPS;
        head(f);
        // radius function: chain of morphs up to now
        const es = steps.map((_, i) => morphAt(t, i));
        const rf = (a) => { let r = form(0)(a); for (let i = 1; i < n; i++) if (es[i] > 0) r = lerp(r, form(i)(a), es[i]); return r; };
        shape.style.clipPath = clip(rf);
        let rot = 0, sq = 0, k = 0;
        for (let i = 1; i < n; i++) { rot += es[i] * 60; sq += Math.sin(Math.PI * es[i]); if (es[i] > 0.5) k = i; }
        const intro = backOut(win(t, 0.15, 0.8), 1.8);
        wrap.style.transform = `translate(-50%, -50%) rotate(${(rot + Math.sin(t * 0.7) * 3).toFixed(2)}deg) scale(${(intro * (1 + 0.08 * sq)).toFixed(4)}, ${(intro * (1 - 0.08 * sq)).toFixed(4)})`;
        // colour blends from the previous step's accent into the current one
        let cur = 0; es.forEach((e, i) => { if (e >= 1) cur = i; });
        const nxt = Math.min(n - 1, cur + 1), m = cur === nxt ? 0 : es[nxt];
        shape.style.background = `color-mix(in srgb, ${accent(nxt)} ${(m * 100).toFixed(1)}%, ${accent(cur)})`;
        wrap.style.setProperty('--ac', accent(m > 0.5 ? nxt : cur));
        icons.forEach((ic, i) => {
          const on = i === 0 ? 1 - (n > 1 ? es[1] : 0) : es[i] * (i + 1 < n ? 1 - es[i + 1] : 1);
          ic.style.opacity = clamp(on * 1.6 - 0.3).toFixed(3);
          ic.style.transform = `translate(-50%, -50%) rotate(${(-rot).toFixed(2)}deg) scale(${(0.6 + 0.4 * on).toFixed(3)})`;
        });
        stamps.forEach((st, i) => {
          const done = i < k ? 1 : 0, now = i === k;
          const p = now ? backOut(win(t, S[i] + 0.1, 0.5), 2.4) : done ? 1 : 0;
          st.classList.toggle('on', now); st.classList.toggle('done', done === 1);
          st.style.transform = `scale(${(0.82 + 0.18 * clamp(p) + (now ? 0.12 : 0)).toFixed(3)})`;
          st.style.opacity = (expoOut(win(t, 0.3 + i * 0.06, 0.6)) * (now || done ? 1 : 0.28)).toFixed(3);
        });
        panes.forEach((pn, i) => {
          const s = S[i], last = i === n - 1;
          const x = last ? 0 : inOut(win(t, s + B - 0.15, 0.3));
          pn.p.style.visibility = t >= s - 0.05 && (last || t < s + B + 0.2) ? 'visible' : 'hidden';
          const st = s + (i ? 0.55 : 0.4);
          fx(pn.k, expoOut(win(t, st, 0.6)), x, 14, 8);
          wordsAt(pn.ti, t, st + 0.08, x);
          wordsAt(pn.de, t, st + 0.3, x, 0.03);
        });
      };
    },
  };

  // ════════════════════════════════════════════════════════════════════════
  // 2 · CARD DECK — the steps are a deck of cards. The top card holds the current step; when it is done it lifts,
  //     tips back in 3D and arcs down into a "done" tray, and the deck slides forward to show the next card.
  // ════════════════════════════════════════════════════════════════════════
  V.deck = {
    name: 'Card Deck',
    note: 'Card deck: each step is a card on a deck. When a step is done the card lifts, tips back in 3D and arcs into the "done" tray at the bottom, and the deck slides forward to the next card.',
    duration: (n, P) => durOf(n, P),
    build(stage, data, o) {
      const steps = data.items, n = steps.length, S = starts(n, o.P);
      const head = U.head(stage, data);
      const scene = el('div', 'dk-scene'); stage.append(scene);
      const CX = 960, CY = 560;
      const slotW = 230, trayY = 985, trayX0 = 960 - ((n - 1) * slotW) / 2;
      const tray = steps.map((s, i) => {
        const g = el('div', 'dk-slot'); g.style.left = `${trayX0 + i * slotW}px`; g.style.top = `${trayY}px`; g.style.setProperty('--ac', accent(i));
        g.innerHTML = `<span class="dk-chk">${U.icon('check', 22, 3)}</span><b>${pad(i)}</b><span class="dk-st">${esc(s.title)}</span>`;
        scene.append(g); return g;
      });
      const cards = steps.map((s, i) => {
        const c = el('div', 'dk-card'); c.style.setProperty('--ac', accent(i));
        c.innerHTML = `<div class="dk-big">${pad(i)}</div><div class="dk-body"><div class="dk-row"><span class="dk-disc">${U.icon(s.icon || 'star', 48, 2.2)}</span><span class="dk-of">Step ${i + 1} of ${n}</span></div></div>`;
        const ti = words(s.title, 'dk-title', 'mask'), de = words(s.detail, 'dk-detail', 'mask');
        c.querySelector('.dk-body').append(ti.el, de.el);
        scene.append(c);
        return { c, ti, de, ic: c.querySelector('.dk-disc .ic') };
      });
      const leave = (i) => (i < n - 1 ? S[i + 1] - 0.05 : Infinity);
      return (f) => {
        const t = f / FPS;
        head(f);
        const drift = 1 + 0.02 * Math.sin(t * 0.4);
        scene.style.transform = `scale(${drift.toFixed(4)})`;
        // continuous "how many cards have left"
        let gone = 0;
        for (let j = 0; j < n - 1; j++) gone += inOut(win(t, leave(j) + 0.15, 0.6));
        cards.forEach((cd, i) => {
          const deal = expoOut(win(t, 0.05 + (n - 1 - i) * 0.07, 0.8));
          const e = clamp((t - leave(i)) / 0.85);
          const d = i - gone;                                            // depth in the deck (0 = top)
          if (e > 0) {
            // flight to the tray
            const q = inOut(e), arc = Math.sin(Math.PI * q);
            const x = lerp(CX, trayX0 + i * slotW, q), y = lerp(CY, trayY, q) - arc * 220;
            const s = lerp(1, 0.2, q);
            cd.c.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%) perspective(1600px) rotateX(${(arc * 38).toFixed(2)}deg) rotateZ(${(-arc * 9).toFixed(2)}deg) scale(${s.toFixed(4)})`;
            cd.c.style.opacity = (1 - win(e, 0.78, 0.22)).toFixed(3);
            cd.c.style.filter = arc > 0.1 ? `blur(${(arc * 3).toFixed(1)}px)` : '';
            cd.c.style.zIndex = '50';
          } else {
            const dd = Math.max(0, d);
            cd.c.style.transform = `translate(${CX}px, ${(CY - dd * 30 + (1 - deal) * 500).toFixed(1)}px) translate(-50%, -50%) scale(${(1 - dd * 0.055).toFixed(4)})`;
            cd.c.style.opacity = (dd > 3 ? 0 : clamp(1 - dd * 0.22) * deal).toFixed(3);
            cd.c.style.filter = dd > 0.1 ? `blur(${(dd * 1.4).toFixed(1)}px)` : '';
            cd.c.style.zIndex = String(40 - i);
          }
          cd.c.classList.toggle('top', d < 0.5 || e > 0);
          const shown = Math.max(S[i] + (i ? 0.45 : 0.25), 0);
          wordsAt(cd.ti, t, shown);
          wordsAt(cd.de, t, shown + 0.22, 0, 0.035);
          drawIcon(cd.ic, expoOut(win(t, shown - 0.1, 0.9)));
          // tray chip appears when the card lands
          const land = expoOut(win(t, leave(i) + 0.7, 0.5));
          tray[i].classList.toggle('done', land > 0.5);
          const ghost = expoOut(win(t, 0.3 + i * 0.05, 0.6));
          tray[i].style.opacity = (0.45 * ghost + 0.55 * land).toFixed(3);
          tray[i].style.transform = `translate(-50%, -50%) scale(${(0.96 + 0.04 * backOut(win(t, leave(i) + 0.7, 0.45), 2.4)).toFixed(4)})`;
        });
      };
    },
  };

  // ════════════════════════════════════════════════════════════════════════
  // 3 · ACCORDION FOCUS — the steps are a list. A highlight slides to the current row with a springy overshoot and the
  //     row opens to reveal its detail and icon, while the previous row folds shut and gets a drawn check. The whole list
  //     reflows smoothly as rows open and close, like a well-made interface.
  // ════════════════════════════════════════════════════════════════════════
  V.accordion = {
    name: 'Accordion Focus',
    note: 'Accordion focus: a highlight slides to the current row with a springy overshoot and the row opens to reveal its detail, while the previous row folds shut and gets a drawn check. The list reflows smoothly as rows open and close.',
    duration: (n, P) => durOf(n, P),
    build(stage, data, o) {
      const steps = data.items, n = steps.length, S = starts(n, o.P);
      const head = U.head(stage, data);
      const list = el('div', 'ac-list'); stage.append(list);
      const hl = el('div', 'ac-hl'); list.append(hl);
      const HC = 92, HO = 214, G = 12;
      const rows = steps.map((s, i) => {
        const r = el('div', 'ac-row'); r.style.setProperty('--ac', accent(i));
        r.innerHTML = `<div class="ac-head"><span class="ac-chk">${U.icon('check', 24, 3)}</span><span class="ac-no">${pad(i)}</span><span class="ac-title">${esc(s.title)}</span><span class="ac-disc">${U.icon(s.icon || 'star', 40, 2.2)}</span></div>`;
        const de = words(s.detail, 'ac-detail', 'wipe'); r.append(de.el); list.append(r);
        return { r, de, chk: r.querySelector('.ac-chk'), chkIc: r.querySelector('.ac-chk .ic'), disc: r.querySelector('.ac-disc'), ic: r.querySelector('.ac-disc .ic') };
      });
      const openAt = (i, t) => {
        const o1 = i === 0 ? inOut(win(t, S[0] - 0.1, 0.6)) : inOut(win(t, S[i] - 0.1, 0.6));
        const o2 = i < n - 1 ? inOut(win(t, S[i + 1] - 0.1, 0.6)) : 0;
        return o1 * (1 - o2);
      };
      const layout = (t) => {
        const h = steps.map((_, i) => HC + (HO - HC) * openAt(i, t));
        const total = h.reduce((a, b) => a + b, 0) + G * (n - 1);
        let y = Math.max(250, 620 - total / 2);
        return h.map((hh) => { const r = { y, h: hh }; y += hh + G; return r; });
      };
      return (f) => {
        const t = f / FPS;
        head(f);
        const L = layout(t);
        const k = Math.max(0, activeAt(S, t));
        rows.forEach((rw, i) => {
          const intro = expoOut(win(t, 0.1 + i * 0.07, 0.7));
          rw.r.style.top = `${L[i].y.toFixed(1)}px`; rw.r.style.height = `${L[i].h.toFixed(1)}px`;
          rw.r.style.clipPath = `inset(0 ${((1 - intro) * 100).toFixed(1)}% 0 0 round 22px)`;
          const op = openAt(i, t);
          const done = t >= S[i] && i < k;
          rw.r.classList.toggle('on', i === k && t >= S[0] - 0.1);
          rw.r.classList.toggle('done', done);
          rw.r.style.opacity = (t < S[i] - 0.1 ? 0.5 : 1).toFixed(3);
          rw.disc.style.opacity = op.toFixed(3);
          rw.disc.style.transform = `scale(${(0.5 + 0.5 * backOut(clamp(op), 1.6)).toFixed(3)})`;
          drawIcon(rw.ic, op);
          const ck = i < n - 1 ? expoOut(win(t, S[i + 1] + 0.2, 0.6)) : 0;
          rw.chk.style.width = `${(ck * 40).toFixed(1)}px`; rw.chk.style.opacity = ck.toFixed(3);
          drawIcon(rw.chkIc, ck);
          wordsAt(rw.de, t, S[i] + 0.35, 0, 0.04);
          rw.de.el.style.opacity = clamp(op * 1.5).toFixed(3);
        });
        // highlight springs from the previous row to the current one (positions follow the live layout)
        const q = k === 0 ? 1 : backOut(win(t, S[k] - 0.1, 0.75), 1.3);
        const a = L[Math.max(0, k - 1)], b = L[k];
        hl.style.top = `${lerp(a.y, b.y, q).toFixed(1)}px`; hl.style.height = `${Math.max(HC, lerp(a.h, b.h, Math.min(1, q))).toFixed(1)}px`;
        hl.style.opacity = expoOut(win(t, S[0] - 0.1, 0.5)).toFixed(3);
        hl.style.setProperty('--ac', accent(k));
      };
    },
  };

  // ════════════════════════════════════════════════════════════════════════
  // 4 · ORBIT — the steps sit on a tilted 3D ring. The ring turns to bring each step to the front: the front disc is
  //     large, sharp and lit, the ones behind are small, soft and faded. Small dots travel round the ring.
  // ════════════════════════════════════════════════════════════════════════
  V.orbit = {
    name: 'Orbit',
    note: 'Orbit: the steps sit on a tilted 3D ring that turns to bring each one to the front — front is large, sharp and lit, the back ones are small and soft. Dots travel round the ring; the text for the front step rises below it.',
    duration: (n, P) => durOf(n, P),
    build(stage, data, o) {
      const steps = data.items, n = steps.length, B = beat(o.P), S = starts(n, o.P);
      const head = U.head(stage, data);
      const CX = 960, CY = 520, RX = 640, RY = 150;
      const ns = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('width', 1920); svg.setAttribute('height', 1080); svg.setAttribute('class', 'ob-svg');
      svg.innerHTML = `<ellipse class="ob-ring" cx="${CX}" cy="${CY}" rx="${RX}" ry="${RY}" pathLength="1"/>${[0, 1, 2, 3, 4, 5].map(() => '<circle class="ob-dot" r="5"/>').join('')}`;
      stage.append(svg);
      const ring = svg.querySelector('.ob-ring'), dots = [...svg.querySelectorAll('.ob-dot')];
      const discs = steps.map((s, i) => {
        const d = el('div', 'ob-node'); d.style.setProperty('--ac', accent(i));
        d.innerHTML = `<div class="ob-disc">${U.icon(s.icon || 'star', 64, 2.2)}</div><div class="ob-cap"><b>${pad(i)}</b> ${esc(s.title)}</div>`;
        stage.append(d); return { d, cap: d.querySelector('.ob-cap') };
      });
      const panes = steps.map((s, i) => {
        const p = el('div', 'ob-pane'); p.style.setProperty('--ac', accent(i));
        const ti = words(s.title, 'ob-title', 'blur'), de = words(s.detail, 'ob-detail', 'blur');
        const k = el('div', 'ob-k', `Step ${i + 1} of ${n}`);
        p.append(k, ti.el, de.el); stage.append(p); return { p, k, ti, de };
      });
      const turn = (t) => { let r = 0; for (let i = 1; i < n; i++) r += inOut(win(t, S[i] - 0.15, 1.05)); return r; };
      return (f) => {
        const t = f / FPS;
        head(f);
        const r = turn(t), intro = expoOut(win(t, 0, 1.2));
        ring.style.strokeDasharray = '1'; ring.style.strokeDashoffset = String(1 - intro);
        const spin = r * ((Math.PI * 2) / n) + (1 - intro) * 0.8;
        dots.forEach((d, j) => { const a = t * 0.45 + (j * Math.PI * 2) / dots.length; d.setAttribute('cx', (CX + RX * Math.cos(a)).toFixed(1)); d.setAttribute('cy', (CY + RY * Math.sin(a)).toFixed(1)); d.style.opacity = (intro * (0.25 + 0.45 * (Math.sin(a) + 1) / 2)).toFixed(3); });
        discs.forEach((dc, i) => {
          const a = Math.PI / 2 + (i * Math.PI * 2) / n - spin;
          const depth = (Math.sin(a) + 1) / 2;                      // 1 = front
          const x = CX + RX * Math.cos(a), y = CY + RY * Math.sin(a);
          const sc = (0.5 + 0.5 * depth) * (0.4 + 0.6 * expoOut(win(t, 0.2 + i * 0.07, 0.8)));
          dc.d.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%) scale(${sc.toFixed(4)})`;
          dc.d.style.zIndex = String(Math.round(depth * 100));
          dc.d.style.opacity = ((0.3 + 0.7 * depth) * intro).toFixed(3);
          const b = (1 - depth) * 4; dc.d.style.filter = b > 0.3 ? `blur(${b.toFixed(1)}px)` : '';
          dc.d.classList.toggle('front', depth > 0.97);
          dc.cap.style.opacity = clamp((0.92 - depth) * 3).toFixed(3);
        });
        panes.forEach((pn, i) => {
          const s = S[i], last = i === n - 1;
          const x = last ? 0 : inOut(win(t, s + B - 0.15, 0.3));
          pn.p.style.visibility = t >= s - 0.05 && (last || t < s + B + 0.2) ? 'visible' : 'hidden';
          const st = s + (i ? 0.75 : 0.5);
          fx(pn.k, expoOut(win(t, st, 0.6)), x, 14, 8);
          wordsAt(pn.ti, t, st + 0.1, x);
          wordsAt(pn.de, t, st + 0.3, x, 0.03);
        });
      };
    },
  };

  // ════════════════════════════════════════════════════════════════════════
  // 5 · BLOCK STACK — each step is a block that drops onto the one before it: it falls under gravity, squashes on
  //     impact, springs back, the tower shudders and dust puffs out. A leader line then draws out to the step's
  //     detail. Each step literally builds on the last.
  // ════════════════════════════════════════════════════════════════════════
  V.stack = {
    name: 'Block Stack',
    note: 'Block stack: each step drops onto the last — it falls under gravity, squashes on impact and springs back, the tower shudders and dust puffs out — then a leader line draws out to its detail. Each step builds on the one before.',
    duration: (n, P) => durOf(n, P),
    build(stage, data, o) {
      const steps = data.items, n = steps.length, S = starts(n, o.P);
      const head = U.head(stage, data);
      const tower = el('div', 'bs-tower'); stage.append(tower);
      const BX = 640, BASE = 950, BH = Math.min(112, 700 / n), GAP = 8;
      const ground = el('div', 'bs-ground'); tower.append(ground);
      const ns = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('width', 1920); svg.setAttribute('height', 1080); svg.setAttribute('class', 'bs-svg');
      tower.append(svg);
      const blocks = steps.map((s, i) => {
        const w = 720 - i * (n > 1 ? 260 / (n - 1) : 0);
        const top = BASE - (i + 1) * (BH + GAP);
        const b = el('div', 'bs-block'); b.style.setProperty('--ac', accent(i));
        b.style.left = `${BX - w / 2}px`; b.style.top = `${top}px`; b.style.width = `${w}px`; b.style.height = `${BH}px`;
        b.innerHTML = `<span class="bs-no">${pad(i)}</span><span class="bs-ic">${U.icon(s.icon || 'star', 36, 2.2)}</span><span class="bs-t">${esc(s.title)}</span>`;
        tower.append(b);
        const line = document.createElementNS(ns, 'path');
        const y = top + BH / 2, x1 = BX + w / 2 + 14, x2 = 1130;
        line.setAttribute('d', `M ${x1} ${y} L ${x2 - 40} ${y} L ${x2} ${y}`); line.setAttribute('pathLength', '1'); line.setAttribute('class', 'bs-lead');
        line.style.setProperty('--ac', accent(i));
        svg.append(line);
        const call = el('div', 'bs-call'); call.style.left = `${x2 + 20}px`; call.style.top = `${y}px`; call.style.setProperty('--ac', accent(i));
        const ti = words(s.title, 'bs-ct', 'drop'), de = words(s.detail, 'bs-cd', 'drop');
        call.append(ti.el, de.el); tower.append(call);
        const puffs = [0, 1, 2, 3, 4, 5].map((j) => { const p = el('i', 'bs-puff'); p.style.left = `${j < 3 ? BX - w / 2 : BX + w / 2}px`; p.style.top = `${top + BH}px`; tower.append(p); return { p, dir: j < 3 ? -1 : 1, k: j % 3 }; });
        return { b, line, call, ti, de, puffs, top };
      });
      const FALL = 0.42;
      const impacts = S.map((s) => s + FALL);
      return (f) => {
        const t = f / FPS;
        head(f);
        // tower shudder from the latest impact
        let shake = 0;
        impacts.forEach((a) => { if (t >= a) shake += Math.exp(-7 * (t - a)) * Math.sin((t - a) * 55) * 7; });
        tower.style.transform = `translate(${(shake * 0.4).toFixed(2)}px, ${shake.toFixed(2)}px)`;
        ground.style.opacity = expoOut(win(t, 0, 0.8)).toFixed(3);
        ground.style.transform = `scaleX(${expoOut(win(t, 0, 1)).toFixed(3)})`;
        const k = activeAt(S, t);
        blocks.forEach((bl, i) => {
          const s = S[i], a = impacts[i];
          if (t < s) { bl.b.style.opacity = 0; bl.call.style.opacity = 0; bl.line.style.strokeDashoffset = '1'; bl.puffs.forEach((p) => { p.p.style.opacity = 0; }); return; }
          const fall = clamp((t - s) / FALL);
          const y = -(1 - fall * fall) * 820;                                     // gravity: y ∝ t²
          let sx = 1, sy = 1;
          if (t >= a) { const q = t - a; const wob = Math.exp(-9 * q) * Math.cos(q * 34); sy = 1 - 0.2 * wob; sx = 1 + 0.12 * wob; }
          else { sy = 1 + 0.12 * fall; sx = 1 - 0.05 * fall; }                    // stretch while falling
          bl.b.style.opacity = clamp(fall * 4).toFixed(3);
          bl.b.style.transform = `translateY(${y.toFixed(1)}px) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;
          bl.b.classList.toggle('on', k === i);
          bl.puffs.forEach((p) => {
            const q = win(t, a, 0.7);
            const e = expoOut(q);
            p.p.style.opacity = q > 0 && q < 1 ? ((1 - q) * 0.6).toFixed(3) : 0;
            p.p.style.transform = `translate(${(p.dir * (20 + e * (50 + p.k * 40))).toFixed(1)}px, ${(-e * (10 + p.k * 16)).toFixed(1)}px) scale(${(0.4 + e * (1 + p.k * 0.4)).toFixed(3)})`;
          });
          const lp = expoOut(win(t, a + 0.25, 0.6));
          bl.line.style.strokeDasharray = '1'; bl.line.style.strokeDashoffset = String(1 - lp);
          wordsAt(bl.ti, t, a + 0.55);
          wordsAt(bl.de, t, a + 0.7, 0, 0.03);
          const dim = k > i ? 0.4 : 1;
          bl.call.style.opacity = dim.toFixed(3);
          bl.line.style.opacity = dim.toFixed(3);
        });
      };
    },
  };

  // ════════════════════════════════════════════════════════════════════════
  // 6 · DOMINO CHAIN — cause and effect. Each step is a tile standing on a line. When its step comes, it is knocked:
  //     it teeters (held in tension while the step is explained), then falls against the next tile — which is the next
  //     step — and the chain moves on. Falling tiles pile up on the ones ahead; the last lands flat with a bounce.
  // ════════════════════════════════════════════════════════════════════════
  V.domino = {
    name: 'Domino Chain',
    note: 'Domino chain: each step is a tile standing on a line. Its step knocks it so it teeters (held while the step is explained), then it falls into the next tile — the next step — and the chain moves on. The last tile lands flat with a bounce.',
    duration: (n, P) => durOf(n, P, 2.4),
    build(stage, data, o) {
      const steps = data.items, n = steps.length, B = beat(o.P), S = starts(n, o.P);
      const head = U.head(stage, data);
      const W = 132, H = 330, FLOOR = 720;
      const sp = n > 1 ? Math.min(340, 1440 / (n - 1)) : 0, X0 = 960 - (sp * (n - 1)) / 2 - 165;   // leave room on the right for the last tile to land flat
      const lean = Math.asin(clamp((sp - W) / H, 0.05, 0.98));
      const TZ = 0.13;
      const floor = el('div', 'dm-floor'); stage.append(floor);
      const tiles = steps.map((s, i) => {
        const x = X0 + i * sp;
        const tl = el('div', 'dm-tile'); tl.style.setProperty('--ac', accent(i));
        tl.style.left = `${x - W / 2}px`; tl.style.top = `${FLOOR - H}px`;
        tl.innerHTML = `<b class="dm-no">${pad(i)}</b><span class="dm-ic">${U.icon(s.icon || 'star', 54, 2.2)}</span>`;
        stage.append(tl);
        const tx = el('div', 'dm-text'); tx.style.left = `${x}px`; tx.style.width = `${Math.max(240, sp - 24)}px`;
        const ti = words(s.title, 'dm-title', 'scale'), de = words(s.detail, 'dm-detail', 'scale');
        tx.append(ti.el, de.el); stage.append(tx);
        const spark = el('i', 'dm-spark'); spark.style.left = `${x - W / 2}px`; spark.style.top = `${FLOOR - H + 30}px`; stage.append(spark);
        return { tl, tx, ti, de, spark };
      });
      const lastFall = S[n - 1] + Math.max(1.3, B * 0.7);
      const angle = (i, t, next) => {
        if (t < S[i]) return 0;
        const q0 = t - S[i];
        let a = TZ * (1 - Math.exp(-5 * q0) * Math.cos(14 * q0));            // knocked: teeter and hold
        const fs = i < n - 1 ? S[i + 1] - 0.42 : lastFall, fd = i < n - 1 ? 0.42 : 0.55;
        if (t >= fs) {
          const g = clamp((t - fs) / fd);
          const target = i < n - 1 ? lean : Math.PI / 2;
          a = TZ + (target - TZ) * g * g;                                    // gravity: accelerates into the next tile
          if (i === n - 1 && g >= 1) { const q = t - fs - fd; a = Math.PI / 2 - 0.09 * Math.exp(-6 * q) * Math.abs(Math.sin(18 * q)); }
          if (i < n - 1 && next > TZ + 0.02) { const fol = clamp((next - TZ) / (Math.PI / 2 - TZ)); a = lean + fol * (Math.PI / 2 * 0.86 - lean); }
        }
        return a;
      };
      return (f) => {
        const t = f / FPS;
        head(f);
        floor.style.transform = `scaleX(${expoOut(win(t, 0, 0.9)).toFixed(3)})`;
        const A = new Array(n);
        for (let i = n - 1; i >= 0; i--) A[i] = angle(i, t, i < n - 1 ? A[i + 1] : 0);
        const k = activeAt(S, t);
        tiles.forEach((tt, i) => {
          const rise = expoOut(win(t, 0.1 + i * 0.08, 0.7));
          tt.tl.style.transform = `rotate(${(A[i] * 180 / Math.PI).toFixed(2)}deg) scaleY(${rise.toFixed(3)})`;
          tt.tl.classList.toggle('on', i === k);
          tt.tl.classList.toggle('hit', t >= S[i]);
          const s = S[i];
          wordsAt(tt.ti, t, s + 0.12);
          wordsAt(tt.de, t, s + 0.3, 0, 0.03);
          const d = k > i ? 0.42 : 1;
          tt.tx.style.opacity = d.toFixed(3);
          tt.tx.style.filter = d < 0.9 ? 'blur(1.2px)' : '';
          const sp_ = win(t, s, 0.45);
          tt.spark.style.opacity = i > 0 && sp_ > 0 && sp_ < 1 ? (1 - sp_).toFixed(3) : 0;
          tt.spark.style.transform = `translate(-50%, -50%) scale(${(0.3 + 1.6 * expoOut(sp_)).toFixed(3)})`;
        });
      };
    },
  };

  // ════════════════════════════════════════════════════════════════════════
  // 7 · PATH WALKER — a glowing traveller walks a winding road from step to step. The road ahead is a faint dashed
  //     line (so you see where it goes); behind the traveller it turns solid. Each step blooms when it is reached:
  //     the disc lights up, its icon draws, a ring pulses and the text rises. Earlier steps step back.
  //     (Kept by the owner's choice. Its camera only leans; full camera tracking belongs to Timeline · Camera track.)
  // ════════════════════════════════════════════════════════════════════════
  V.path = {
    name: 'Path Walker',
    note: 'Path walker: a glowing traveller walks a winding road; the road ahead is a faint dashed line and turns solid behind it. Each step blooms on arrival (disc lights, icon draws, ring pulses, text flips in) while earlier steps step back.',
    duration: (n, P) => durOf(n, P),
    build(stage, data, o) {
      const steps = data.items, n = steps.length, B = beat(o.P), S = starts(n, o.P);
      const head = U.head(stage, data);
      const world = el('div', 'fx-world'); stage.append(world);
      const X0 = 230, X1 = 1690, YU = 540, YD = 760;
      const pts = steps.map((_, i) => ({ x: n > 1 ? X0 + (i * (X1 - X0)) / (n - 1) : 960, y: n > 1 ? (i % 2 ? YU : YD) : 650 }));
      const segs = pts.slice(0, -1).map((p1, i) => {
        const p0 = pts[i - 1] || p1, p2 = pts[i + 1], p3 = pts[i + 2] || p2, k = 0.22;
        return { p1, c1: { x: p1.x + (p2.x - p0.x) * k, y: p1.y + (p2.y - p0.y) * k }, c2: { x: p2.x - (p3.x - p1.x) * k, y: p2.y - (p3.y - p1.y) * k }, p2 };
      });
      const bez = (s, u) => { const a = (1 - u) ** 3, b = 3 * (1 - u) ** 2 * u, c = 3 * (1 - u) * u * u, d = u ** 3; return { x: a * s.p1.x + b * s.c1.x + c * s.c2.x + d * s.p2.x, y: a * s.p1.y + b * s.c1.y + c * s.c2.y + d * s.p2.y }; };
      const segD = (s) => `M ${s.p1.x} ${s.p1.y} C ${s.c1.x} ${s.c1.y} ${s.c2.x} ${s.c2.y} ${s.p2.x} ${s.p2.y}`;
      const ns = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('width', 1920); svg.setAttribute('height', 1080); svg.setAttribute('class', 'pw-svg');
      svg.innerHTML = segs.map((s) => `<path class="pw-ahead" d="${segD(s)}"/><path class="pw-glow" pathLength="1" d="${segD(s)}"/><path class="pw-done" pathLength="1" d="${segD(s)}"/>`).join('');
      world.append(svg);
      const aheads = [...svg.querySelectorAll('.pw-ahead')], glows = [...svg.querySelectorAll('.pw-glow')], dones = [...svg.querySelectorAll('.pw-done')];
      const nodes = steps.map((s, i) => {
        const up = n > 1 && i % 2 === 1;
        const nd = el('div', 'pw-node'); nd.style.left = `${pts[i].x}px`; nd.style.top = `${pts[i].y}px`; nd.style.setProperty('--ac', accent(i));
        nd.innerHTML = `<i class="pw-ring"></i><div class="pw-disc">${U.icon(s.icon || 'star', 52, 2.2)}<b class="pw-no">${pad(i)}</b></div>`;
        const tx = el('div', 'pw-text' + (up ? ' up' : ''));
        tx.style.left = `${pts[i].x}px`; tx.style.top = `${pts[i].y + (up ? -96 : 96)}px`;
        const ti = words(s.title, 'pw-title', 'flip'), de = words(s.detail, 'pw-detail', 'flip');
        tx.append(ti.el, de.el);
        world.append(nd, tx);
        return { nd, tx, ti, de, disc: nd.querySelector('.pw-disc'), ring: nd.querySelector('.pw-ring'), ic: nd.querySelector('.ic') };
      });
      const trav = el('div', 'pw-trav', '<i></i>'); world.append(trav);
      const travel = Math.min(1.2, B * 0.5);
      const arrive = (i) => S[i] + 0.1;
      const end = arrive(n - 1) + B;
      const where = (t) => {
        for (let i = 0; i < segs.length; i++) {
          const a = arrive(i + 1) - travel;
          if (t < a) return { ...pts[i], seg: i, u: 0 };
          if (t < arrive(i + 1)) { const u = inOut(win(t, a, travel)); return { ...bez(segs[i], u), seg: i, u }; }
        }
        return { ...pts[n - 1], seg: segs.length, u: 1 };
      };
      return (f) => {
        const t = f / FPS;
        head(f);
        const c = where(t);
        const resolve = inOut(win(t, end - 0.2, 1.0));
        world.style.transform = `translateX(${((960 - c.x) * 0.06 * (1 - resolve)).toFixed(1)}px) scale(${(1.02 + 0.015 * win(t, 0, 25) - 0.02 * resolve).toFixed(4)})`;
        const intro = expoOut(win(t, 0.1, 1.2));
        aheads.forEach((p) => { p.style.opacity = (intro * 0.9).toFixed(3); });
        dones.forEach((p, i) => {
          const u = c.seg > i ? 1 : c.seg === i ? c.u : 0;
          p.style.strokeDasharray = '1'; p.style.strokeDashoffset = String(1 - u);
          glows[i].style.strokeDasharray = '1'; glows[i].style.strokeDashoffset = String(1 - u);
        });
        const tb = expoOut(win(t, arrive(0) - 0.5, 0.5)) * (1 - resolve * 0.7);
        trav.style.transform = `translate(${c.x.toFixed(1)}px, ${c.y.toFixed(1)}px) scale(${tb.toFixed(3)})`;
        const k = activeAt(S.map((_, i) => arrive(i)), t);
        nodes.forEach((nd, i) => {
          const a = arrive(i);
          const lit = backOut(win(t, a - 0.05, 0.55), 2.0);
          const ghost = expoOut(win(t, 0.2 + i * 0.08, 0.8));
          nd.nd.classList.toggle('lit', t >= a - 0.05);
          nd.disc.style.transform = `translate(-50%, -50%) scale(${(t < a - 0.05 ? 0.78 * ghost : 0.78 + 0.22 * lit - (k > i ? 0.1 * (1 - resolve) : 0)).toFixed(4)})`;
          nd.disc.style.opacity = (t < a - 0.05 ? 0.55 * ghost : 1).toFixed(3);
          drawIcon(nd.ic, t < a - 0.05 ? 1 : expoOut(win(t, a - 0.05, 0.8)));
          const r = win(t, a, 0.9);
          nd.ring.style.opacity = r > 0 && r < 1 ? (1 - r).toFixed(3) : 0;
          nd.ring.style.transform = `translate(-50%, -50%) scale(${(0.8 + 1.6 * expoOut(r)).toFixed(3)})`;
          wordsAt(nd.ti, t, a + 0.15);
          wordsAt(nd.de, t, a + 0.35, 0, 0.035);
          const d = k > i ? lerp(0.42, 1, resolve) : 1;
          nd.tx.style.opacity = d.toFixed(3);
          nd.tx.style.filter = d < 0.95 ? `blur(${((1 - d) * 2.4).toFixed(1)}px)` : '';
        });
      };
    },
  };

  // ════════════════════════════════════════════════════════════════════════
  // 8 · DOLLY PAN — the steps are laid out on a long set wider than the screen. The camera dollies sideways from one
  //     to the next; giant background numerals move slower and foreground specks faster (parallax), and the frame
  //     softens with the speed of the move. Neighbouring steps peek in at the edges.
  //     (Kept by the owner's choice; it travels sideways, while Transitions · Zoom-through travels in depth.)
  // ════════════════════════════════════════════════════════════════════════
  V.dolly = {
    name: 'Dolly Pan',
    note: 'Dolly pan: the steps sit on a set wider than the screen and the camera dollies from one to the next. Giant background numerals drift slower, foreground specks faster (parallax), the frame softens with the speed of the move, and neighbours peek in at the edges.',
    duration: (n, P) => durOf(n, P),
    build(stage, data, o) {
      const steps = data.items, n = steps.length, S = starts(n, o.P);
      const head = U.head(stage, data);
      const GAP = 980;
      const back = el('div', 'dl-layer'), mid = el('div', 'dl-layer'), front = el('div', 'dl-layer');
      stage.append(back, mid, front);
      const bigs = steps.map((_, i) => { const e = el('div', 'dl-big', pad(i)); e.style.setProperty('--ac', accent(i)); back.append(e); return e; });
      const line = el('div', 'dl-line', '<i></i>'); mid.append(line);
      const lineFill = line.firstChild;
      const items = steps.map((s, i) => {
        const e = el('div', 'dl-step'); e.style.setProperty('--ac', accent(i));
        e.innerHTML = `<div class="dl-disc">${U.icon(s.icon || 'star', 84, 2)}</div><div class="dl-k">Step ${i + 1} of ${n}</div>`;
        const ti = words(s.title, 'dl-title', 'slide'), de = words(s.detail, 'dl-detail', 'slide');
        e.append(ti.el, de.el); mid.append(e);
        const node = el('i', 'dl-node'); node.style.setProperty('--ac', accent(i)); mid.append(node);
        return { e, ti, de, node, ic: e.querySelector('.ic'), disc: e.querySelector('.dl-disc') };
      });
      const specks = [...Array(26).keys()].map((j) => { const p = el('i', 'dl-speck'); front.append(p); return { p, x: rnd(j) * (n * GAP + 1800) - 900, y: 260 + rnd(j * 3 + 1) * 760, s: 4 + rnd(j * 5) * 10 }; });
      const dots = el('div', 'dl-dots', steps.map((_, i) => `<b style="--ac:${accent(i)}"></b>`).join('') + '<i class="dl-pill"></i>');
      dots.style.marginLeft = `${-(n * 44 - 20) / 2}px`;
      stage.append(dots);
      const pill = dots.querySelector('.dl-pill'), dotEls = [...dots.querySelectorAll('b')];
      const cam = (t) => { let c = 0; for (let i = 1; i < n; i++) c += inOut(win(t, S[i] - 0.2, 1.1)); return c; };
      return (f) => {
        const t = f / FPS;
        head(f);
        const c = cam(t), v = Math.abs(c - cam(t - 1 / FPS)) * GAP;    // px per frame
        const camX = c * GAP;
        const intro = expoOut(win(t, 0, 1.0));
        const sx = (x, p) => 960 + (x - camX) * p;
        bigs.forEach((b, i) => { b.style.transform = `translate(${sx(i * GAP, 0.45).toFixed(1)}px, 0) translateX(-50%)`; b.style.opacity = (0.9 * intro * clamp(1 - Math.abs(i - c) * 1.4)).toFixed(3); });
        mid.style.filter = v > 2 ? `blur(${Math.min(6, v / 9).toFixed(1)}px)` : '';
        back.style.filter = `blur(${(2 + Math.min(4, v / 12)).toFixed(1)}px)`;
        line.style.left = `${sx(0, 1)}px`; line.style.width = `${(n - 1) * GAP}px`;
        lineFill.style.width = `${(n > 1 ? c / (n - 1) : 1) * 100}%`;
        line.style.opacity = intro.toFixed(3);
        items.forEach((it, i) => {
          const x = sx(i * GAP, 1), d = Math.abs(i - c);
          it.e.style.transform = `translate(${x.toFixed(1)}px, 0) translateX(-50%) scale(${(1 - Math.min(1, d) * 0.14).toFixed(4)})`;
          it.e.style.opacity = (clamp(1 - d * 0.62) * intro).toFixed(3);
          it.node.style.left = `${x}px`;
          it.node.classList.toggle('on', c >= i - 0.3);
          const st = S[i] + (i ? 0.85 : 0.35);
          wordsAt(it.ti, t, st);
          wordsAt(it.de, t, st + 0.22, 0, 0.03);
          drawIcon(it.ic, expoOut(win(t, st - 0.2, 0.9)));
          it.disc.style.transform = `scale(${(0.85 + 0.15 * backOut(win(t, st - 0.25, 0.6), 2)).toFixed(4)})`;
        });
        specks.forEach((p) => { p.p.style.transform = `translate(${sx(p.x, 1.5).toFixed(1)}px, ${p.y}px)`; p.p.style.width = p.p.style.height = `${p.s}px`; p.p.style.opacity = (0.35 * intro).toFixed(3); });
        fx(dots, intro, 0, 20, 6);
        pill.style.transform = `translateX(${(c * 44).toFixed(1)}px)`;
        dotEls.forEach((d, i) => d.classList.toggle('on', Math.abs(c - i) < 0.5));
      };
    },
  };

  // ════════════════════════════════════════════════════════════════════════
  // 9 · NUMBER RAIL — editorial type. A giant step numeral sits in a window on the left and rolls like a reel to the
  //     next number (blur follows the roll), with the neighbours faintly visible above and below. A progress rail fills
  //     beside it; the step's title and detail swap on the right, word by word.
  //     (Kept by the owner's choice; it rolls whole step numbers, while Stats · Odometer spins digits by place value.)
  // ════════════════════════════════════════════════════════════════════════
  V.rail = {
    name: 'Number Rail',
    note: 'Number rail: a giant numeral rolls like a reel to the next step (blur follows the roll) with its neighbours faint above and below. A progress rail fills beside it; the title and detail shear into place word by word on the right.',
    duration: (n, P) => durOf(n, P),
    build(stage, data, o) {
      const steps = data.items, n = steps.length, B = beat(o.P), S = starts(n, o.P);
      const head = U.head(stage, data);
      const NH = 360;
      const win_ = el('div', 'nr-window');
      const reel = el('div', 'nr-reel', steps.map((_, i) => `<div class="nr-n" style="--ac:${accent(i)}">${pad(i)}</div>`).join(''));
      win_.append(reel); stage.append(win_);
      const rail = el('div', 'nr-rail', `<i class="nr-fill"></i>${steps.map((_, i) => `<b class="nr-tick" style="top:${n > 1 ? (i / (n - 1)) * 100 : 50}%;--ac:${accent(i)}"></b>`).join('')}`);
      stage.append(rail);
      const fill = rail.querySelector('.nr-fill'), ticks = [...rail.querySelectorAll('.nr-tick')], nums = [...reel.children];
      const panes = steps.map((s, i) => {
        const p = el('div', 'nr-pane'); p.style.setProperty('--ac', accent(i));
        const top = el('div', 'nr-top', `<span class="nr-disc">${U.icon(s.icon || 'star', 46, 2.2)}</span><span>Step ${i + 1} of ${n}</span>`);
        const ti = words(s.title, 'nr-title', 'shear'), de = words(s.detail, 'nr-detail', 'shear');
        p.append(top, ti.el, de.el); stage.append(p);
        return { p, top, ti, de, ic: top.querySelector('.ic') };
      });
      const pos = (t) => { let p = 0; for (let i = 1; i < n; i++) p += quartOut(win(t, S[i] - 0.05, 0.95)); return p; };
      return (f) => {
        const t = f / FPS;
        head(f);
        const p = pos(t), v = Math.abs(p - pos(t - 1 / FPS));
        const intro = expoOut(win(t, 0.1, 0.9));
        reel.style.transform = `translateY(${(-p * NH + (1 - intro) * 120).toFixed(1)}px)`;
        reel.style.filter = v > 0.01 ? `blur(${Math.min(10, v * 60).toFixed(1)}px)` : '';
        win_.style.opacity = intro.toFixed(3);
        nums.forEach((nm, i) => { const d = Math.abs(i - p); nm.style.opacity = clamp(1 - d * 0.8).toFixed(3); nm.style.transform = `scale(${(1 - Math.min(1, d) * 0.12).toFixed(4)})`; });
        fill.style.height = `${(n > 1 ? (p / (n - 1)) * 100 : 100) * expoOut(win(t, 0.3, 0.8))}%`;
        ticks.forEach((tk, i) => { tk.classList.toggle('on', p - i > -0.4); tk.style.transform = `translate(-50%, -50%) scale(${(0.7 + 0.5 * (1 - Math.min(1, Math.abs(p - i)))).toFixed(3)})`; tk.style.opacity = (0.5 + 0.5 * intro).toFixed(3); });
        rail.style.opacity = intro.toFixed(3);
        panes.forEach((pn, i) => {
          const s = S[i], last = i === n - 1;
          const x = last ? 0 : inOut(win(t, s + B - 0.1, 0.32));
          pn.p.style.visibility = t >= s - 0.05 && (last || t < s + B + 0.3) ? 'visible' : 'hidden';
          const st = s + (i ? 0.3 : 0.2);
          fx(pn.top, expoOut(win(t, st, 0.6)), x, 16, 8);
          drawIcon(pn.ic, expoOut(win(t, st, 0.9)));
          wordsAt(pn.ti, t, st + 0.12, x);
          wordsAt(pn.de, t, st + 0.35, x, 0.03);
          pn.p.style.transform = `scale(${(1 + 0.02 * win(t, s, B)).toFixed(4)})`;
        });
      };
    },
  };

  function mount(id) {
    const v = V[id];
    SM.mount({ id, name: v.name, note: v.note, duration: v.duration, build: v.build });
  }
  // kit: shared curves and text treatments, reused by other sets (e.g. ../interaction-motion).
  window.StepsFX = { mount, variants: V, kit: { expoOut, quartOut, inOut, backOut, win, rnd, accent, pad, fx, TXT, words, wordsAt, drawIcon, beat, durOf, starts, activeAt } };
})();
