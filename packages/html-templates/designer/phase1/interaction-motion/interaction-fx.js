/* Interaction kit — how a person uses the product: click, drag, type & send, toggle, touch & swipe.
 * Reuses the process-steps shell (player, editor, themes) and its motion kit; only the scenes below are new.
 * Each item = one action: title = the control's label, detail = the text it produces/types, icon = its icon.
 * Signature motions (see ../MOTION-LEDGER.md): cursor glide + press ripple · drag with velocity tilt · typed text lifts
 * into a sent bubble · switch knob squash · finger swipe with momentum.
 */
(function () {
  'use strict';
  const SM = window.StepsMotion, U = SM.U, K = window.StepsFX.kit;
  const { clamp, lerp, esc, el } = U;
  const { expoOut, inOut, backOut, win, accent, words, wordsAt, drawIcon, durOf, starts, activeAt, beat, fx } = K;
  const FPS = 30;

  // ── Shared: cursor, press, ripple ──
  const CURSOR = '<svg viewBox="0 0 24 24" width="46" height="46"><path d="M4 2.5l6.8 18.6 2.7-7.6 7.6-2.7z" fill="#fff" stroke="#0F172A" stroke-width="1.7" stroke-linejoin="round"/></svg>';
  const cursorEl = (stage) => { const c = el('div', 'ix-cursor', CURSOR); stage.append(c); return c; };
  /** Human-like glide: eased, a slight arc, a tiny overshoot. */
  const glide = (a, b, k) => { const e = backOut(clamp(k), 0.6), arc = Math.sin(Math.PI * clamp(k)) * 0.1, dx = b.x - a.x, dy = b.y - a.y; return { x: a.x + dx * e - dy * arc, y: a.y + dy * e + dx * arc }; };
  /** Waypoints [{p}, {t, d, p}…]: arrive at p at time t after a glide of d seconds. */
  const track = (W) => (t) => { let p = W[0].p; for (let i = 1; i < W.length; i++) { const w = W[i], s = w.t - w.d; if (t < s) return p; if (t < w.t) return glide(W[i - 1].p, w.p, (t - s) / w.d); p = w.p; } return p; };
  const pressK = (t, at) => Math.sin(Math.PI * win(t, at - 0.04, 0.22));          // 0 → 1 → 0 around a click
  const ripple = (e, t, at, size = 3) => { const q = win(t, at, 0.65); e.style.opacity = q > 0 && q < 1 ? (1 - q).toFixed(3) : 0; e.style.transform = `scale(${(0.2 + size * expoOut(q)).toFixed(3)})`; };
  const putCursor = (c, p, t, sc = 1) => { c.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) scale(${sc.toFixed(3)})`; c.style.opacity = expoOut(win(t, 0.3, 0.4)).toFixed(3); };
  /** One caption per item, shown during its beat. */
  const captions = (stage, items, cls, style) => items.map((it) => { const c = words(it.detail, cls, style); stage.append(c.el); return c; });
  const showCaption = (c, i, n, t, S, B, at) => { const last = i === n - 1, x = last ? 0 : inOut(win(t, S[i] + B - 0.1, 0.3)); c.el.style.visibility = t >= S[i] && (last || t < S[i] + B + 0.3) ? 'visible' : 'hidden'; wordsAt(c, t, at, x, 0.04); };

  const V = {};

  // 1 · CURSOR & CLICK — the cursor glides (eased, arced, tiny overshoot) to each button, the button lifts on hover,
  //     presses on click with a ripple from the exact click point, then turns on with a drawn check.
  V.click = {
    name: 'Cursor & Click',
    note: 'Cursor & click: the cursor glides to each button on a natural arc, the button lifts on hover, presses on click with a ripple from the click point, then turns on with a drawn check. The result appears below.',
    duration: (n, P) => durOf(n, P),
    build(stage, data, o) {
      const items = data.items, n = items.length, B = beat(o.P), S = starts(n, o.P), head = U.head(stage, data);
      const cols = Math.min(3, n), rows = Math.ceil(n / cols), BW = 440, BH = 120, G = 28;
      const x0 = 960 - (cols * BW + (cols - 1) * G) / 2, y0 = 540 - (rows * BH + (rows - 1) * G) / 2;
      const panel = el('div', 'ix-panel'); stage.append(panel);
      Object.assign(panel.style, { left: `${x0 - 48}px`, top: `${y0 - 48}px`, width: `${cols * BW + (cols - 1) * G + 96}px`, height: `${rows * BH + (rows - 1) * G + 96}px` });
      const btns = items.map((it, i) => {
        const x = x0 + (i % cols) * (BW + G), y = y0 + Math.floor(i / cols) * (BH + G);
        const b = el('div', 'ck-btn'); b.style.cssText = `left:${x}px;top:${y}px;width:${BW}px;height:${BH}px;--ac:${accent(i)}`;
        b.innerHTML = `<span class="ck-ic">${U.icon(it.icon || 'star', 40, 2.2)}</span><span class="ck-t">${esc(it.title)}</span><span class="ck-ok">${U.icon('check', 26, 3)}</span><i class="ix-ripple" style="left:${BW * 0.72}px;top:${BH * 0.55}px"></i>`;
        stage.append(b);
        return { b, x, y, rip: b.querySelector('.ix-ripple'), ok: b.querySelector('.ck-ok .ic') };
      });
      const caps = captions(stage, items, 'ck-cap', 'scale');
      caps.forEach((c) => { c.el.style.top = `${y0 + rows * (BH + G) + 70}px`; });
      const hit = (i) => ({ x: btns[i].x + BW * 0.72, y: btns[i].y + BH * 0.55 });
      const clickAt = (i) => S[i] + 0.75;
      const cur = track([{ p: { x: 1560, y: 980 } }].concat(items.map((_, i) => ({ t: clickAt(i) - 0.15, d: 0.6, p: hit(i) }))));
      const cursor = cursorEl(stage);
      return (f) => {
        const t = f / FPS, k = activeAt(S, t);
        head(f);
        fx(panel, expoOut(win(t, 0.05, 0.7)), 0, 30, 8);
        putCursor(cursor, cur(t), t, 1 - 0.16 * (k >= 0 ? pressK(t, clickAt(k)) : 0));
        btns.forEach((bt, i) => {
          const done = t >= clickAt(i), hover = k === i && t > clickAt(i) - 0.3 && !done;
          bt.b.classList.toggle('hover', hover); bt.b.classList.toggle('on', done);
          bt.b.style.opacity = expoOut(win(t, 0.15 + i * 0.06, 0.6)).toFixed(3);
          bt.b.style.transform = `translateY(${hover ? -5 : 0}px) scale(${(1 - 0.05 * pressK(t, clickAt(i))).toFixed(4)})`;
          ripple(bt.rip, t, clickAt(i), 4);
          drawIcon(bt.ok, expoOut(win(t, clickAt(i) + 0.1, 0.5)));
        });
        caps.forEach((c, i) => showCaption(c, i, n, t, S, B, clickAt(i) + 0.2));
      };
    },
  };

  // 2 · DRAG & DROP — the cursor grabs a card, it lifts (bigger shadow, slight scale), tilts with its own speed while
  //     carried, the drop zone glows as it arrives, and it settles into its slot with a small bounce.
  V.drag = {
    name: 'Drag & Drop',
    note: 'Drag & drop: the cursor grabs a card, it lifts and tilts with its own speed while carried, the drop zone glows as it arrives, and the card settles into its slot with a small bounce. A ghost outline stays where it came from.',
    duration: (n, P) => durOf(n, P),
    build(stage, data, o) {
      const items = data.items, n = items.length, B = beat(o.P), S = starts(n, o.P), head = U.head(stage, data);
      const CW = 400, CH = 96, LG = 18;
      const ly0 = 560 - (n * (CH + LG) - LG) / 2;
      const zone = el('div', 'dg-zone', `<div class="dg-zh">Board <b class="dg-count">0</b></div>`); stage.append(zone);
      const count = zone.querySelector('.dg-count');
      const home = (i) => ({ x: 170, y: ly0 + i * (CH + LG) });
      const slot = (i) => ({ x: 1010 + (i % 2) * (CW + 20), y: 330 + Math.floor(i / 2) * (CH + LG) });
      const cards = items.map((it, i) => {
        const g = el('div', 'dg-ghost'); Object.assign(g.style, { left: `${home(i).x}px`, top: `${home(i).y}px` }); stage.append(g);
        const c = el('div', 'dg-card'); c.style.setProperty('--ac', accent(i));
        c.innerHTML = `<span class="dg-ic">${U.icon(it.icon || 'star', 34, 2.2)}</span><span class="dg-t">${esc(it.title)}</span><span class="dg-grip">⋮⋮</span>`;
        stage.append(c); return { c, g };
      });
      const caps = captions(stage, items, 'dg-cap', 'drop');
      const grab = (i) => S[i] + 0.55, drop = (i) => grab(i) + 1.0;
      const posAt = (i, t) => {
        const g = grab(i);
        if (t < g + 0.1) return home(i);
        if (t < drop(i)) return glide(home(i), slot(i), inOut(win(t, g + 0.1, 0.9)));
        return slot(i);
      };
      const handle = { x: CW - 50, y: CH / 2 };
      const cursor = cursorEl(stage);
      const toCard = track([{ p: { x: 1500, y: 980 } }].concat(items.map((_, i) => ({ t: grab(i), d: 0.45, p: { x: home(i).x + handle.x, y: home(i).y + handle.y } }))));
      return (f) => {
        const t = f / FPS, k = activeAt(S, t);
        head(f);
        fx(zone, expoOut(win(t, 0.1, 0.7)), 0, 30, 8);
        let cp = toCard(t);
        if (k >= 0 && t >= grab(k) + 0.1) { const p = posAt(k, t); cp = { x: p.x + handle.x, y: p.y + handle.y }; if (t > drop(k)) cp = glide(cp, { x: cp.x + 60, y: cp.y + 90 }, win(t, drop(k) + 0.1, 0.5)); }
        putCursor(cursor, cp, t, 1 - 0.16 * (k >= 0 ? Math.max(pressK(t, grab(k)), pressK(t, drop(k))) : 0));
        let landed = 0;
        cards.forEach((cd, i) => {
          const p = posAt(i, t), p0 = posAt(i, t - 1 / FPS);
          const carrying = t >= grab(i) + 0.05 && t < drop(i);
          const tilt = clamp((p.x - p0.x) * 0.25, -10, 10);
          const settle = t >= drop(i) ? 1 + 0.05 * (1 - backOut(win(t, drop(i), 0.45), 2.6)) : 1;
          const lift = carrying ? 1.05 : settle;
          cd.c.style.left = `${p.x.toFixed(1)}px`; cd.c.style.top = `${p.y.toFixed(1)}px`;
          cd.c.style.transform = `rotate(${(carrying ? tilt : 0).toFixed(2)}deg) scale(${lift.toFixed(4)})`;
          cd.c.classList.toggle('lift', carrying);
          cd.c.style.opacity = expoOut(win(t, 0.15 + i * 0.06, 0.6)).toFixed(3);
          cd.g.style.opacity = t >= grab(i) + 0.1 ? 1 : 0;
          if (t >= drop(i)) landed++;
        });
        zone.classList.toggle('hot', k >= 0 && t > drop(k) - 0.35 && t < drop(k) + 0.4);
        count.textContent = String(landed);
        count.style.transform = `scale(${(1 + 0.3 * (k >= 0 ? pressK(t, drop(k) + 0.05) : 0)).toFixed(3)})`;
        caps.forEach((c, i) => showCaption(c, i, n, t, S, B, drop(i) + 0.1));
      };
    },
  };

  // 3 · PROMPT & SEND — the request is typed into a prompt box with a caret, the cursor clicks send (press + ripple),
  //     the text lifts out of the box into a sent bubble, the conversation scrolls up, and a reply resolves from
  //     typing dots.
  V.prompt = {
    name: 'Prompt & Send',
    note: 'Prompt & send: the request is typed with a caret, the cursor clicks send, the text lifts out of the box into a sent bubble and the conversation scrolls up; a reply resolves from typing dots.',
    duration: (n, P) => durOf(n, P),
    build(stage, data, o) {
      const items = data.items, n = items.length, B = beat(o.P), S = starts(n, o.P), head = U.head(stage, data);
      const box = el('div', 'pr-box', `<span class="pr-text"></span><i class="pr-caret"></i><span class="pr-send">${U.icon('send', 34, 2.2)}<i class="ix-ripple"></i></span>`); stage.append(box);
      const txt = box.querySelector('.pr-text'), caret = box.querySelector('.pr-caret'), send = box.querySelector('.pr-send'), rip = send.querySelector('.ix-ripple');
      const feed = el('div', 'pr-feed'); stage.append(feed);
      const HX = 260;
      const ex = items.map((it, i) => {
        const g = el('div', 'pr-ex');
        g.innerHTML = `<div class="pr-me">${esc(it.detail)}</div><div class="pr-ai" style="--ac:${accent(i)}"><span class="pr-ic">${U.icon(it.icon || 'star', 30, 2.2)}</span><span class="pr-dots"><i></i><i></i><i></i></span></div>`;
        const ans = words(it.title, 'pr-ans', 'blur'); g.querySelector('.pr-ai').append(ans.el);
        feed.append(g);
        return { g, me: g.querySelector('.pr-me'), ai: g.querySelector('.pr-ai'), dots: g.querySelector('.pr-dots'), ans, len: Array.from(it.detail || '').length };
      });
      const typeAt = (i) => S[i] + 0.1;
      const cps = (i) => Math.max(30, ex[i].len / Math.max(0.6, B * 0.4));
      const typedEnd = (i) => typeAt(i) + ex[i].len / cps(i);
      const sendAt = (i) => typedEnd(i) + 0.45;
      const cursor = cursorEl(stage);
      const sendPt = { x: 1505, y: 912 };
      const cur = track([{ p: { x: 1700, y: 1040 } }].concat(items.map((_, i) => ({ t: sendAt(i) - 0.08, d: 0.45, p: sendPt }))));
      return (f) => {
        const t = f / FPS, k = activeAt(S, t);
        head(f);
        fx(box, expoOut(win(t, 0.05, 0.7)), 0, 30, 8);
        // input: typing until sent, then the text lifts out and the box clears
        if (k >= 0) {
          const it = items[k], chars = Array.from(it.detail || '');
          const nC = Math.floor(clamp((t - typeAt(k)) * cps(k), 0, chars.length));
          const lifted = win(t, sendAt(k) + 0.05, 0.3);
          txt.textContent = chars.slice(0, nC).join('');
          txt.style.opacity = (1 - lifted).toFixed(3); txt.style.transform = `translateY(${(-lifted * 40).toFixed(1)}px)`;
          caret.style.opacity = t < sendAt(k) && (nC < chars.length || Math.floor(t * 2.2) % 2 === 0) ? 1 : 0;
        } else caret.style.opacity = Math.floor(t * 2.2) % 2 === 0 ? 1 : 0;
        send.classList.toggle('ready', k >= 0 && t >= typedEnd(k) && t < sendAt(k) + 0.3);
        send.style.transform = `scale(${(1 - 0.12 * (k >= 0 ? pressK(t, sendAt(k)) : 0)).toFixed(3)})`;
        if (k >= 0) ripple(rip, t, sendAt(k), 2.4);
        putCursor(cursor, cur(t), t, 1 - 0.16 * (k >= 0 ? pressK(t, sendAt(k)) : 0));
        // feed: each exchange sits above the newer ones; sending pushes the stack up
        ex.forEach((e, i) => {
          let up = 0; for (let j = i + 1; j < n; j++) up += inOut(win(t, sendAt(j), 0.5)) * HX;
          const q = expoOut(win(t, sendAt(i), 0.55));
          const y = 560 - up;
          e.g.style.transform = `translateY(${y.toFixed(1)}px)`;
          e.g.style.opacity = (t < sendAt(i) ? 0 : clamp((y + 120) / 260)).toFixed(3);
          e.me.style.opacity = q.toFixed(3);
          e.me.style.transform = `translateY(${((1 - q) * 300).toFixed(1)}px) scale(${(0.9 + 0.1 * q).toFixed(3)})`;
          const ra = sendAt(i) + 0.45, rv = ra + 0.6;
          const aq = expoOut(win(t, ra, 0.4));
          e.ai.style.opacity = aq.toFixed(3); e.ai.style.transform = `translateY(${((1 - aq) * 20).toFixed(1)}px)`;
          e.dots.style.display = t < rv ? 'inline-flex' : 'none';
          [...e.dots.children].forEach((d, j) => { d.style.transform = `translateY(${(-Math.max(0, Math.sin(t * 9 - j * 0.9)) * 7).toFixed(1)}px)`; });
          wordsAt(e.ans, t, rv, 0, 0.06);
        });
      };
    },
  };

  // 4 · TOGGLE SWITCHES — the cursor flips each setting: the knob stretches as it slides and snaps round at the end,
  //     the track fills with colour behind it, and the row confirms with its new state.
  V.toggle = {
    name: 'Toggle Switches',
    note: 'Toggle switches: the cursor flips each setting; the knob stretches as it slides and snaps round at the end, the track fills with colour behind it, and the row wipes in its new state.',
    duration: (n, P) => durOf(n, P),
    build(stage, data, o) {
      const items = data.items, n = items.length, S = starts(n, o.P), head = U.head(stage, data);
      const RH = 118, x0 = 440, w = 1040, y0 = 560 - (n * RH) / 2;
      const card = el('div', 'tg-card'); Object.assign(card.style, { left: `${x0}px`, top: `${y0 - 24}px`, width: `${w}px`, height: `${n * RH + 48}px` }); stage.append(card);
      const rows = items.map((it, i) => {
        const r = el('div', 'tg-row'); r.style.cssText = `left:${x0}px;top:${y0 + i * RH}px;width:${w}px;height:${RH}px;--ac:${accent(i)}`;
        r.innerHTML = `<span class="tg-ic">${U.icon(it.icon || 'star', 34, 2.2)}</span><div class="tg-txt"><div class="tg-t">${esc(it.title)}</div></div><span class="tg-sw"><i class="tg-fill"></i><i class="tg-knob"></i></span>`;
        const st = words(it.detail, 'tg-state', 'wipe'); r.querySelector('.tg-txt').append(st.el);
        stage.append(r);
        return { r, st, fill: r.querySelector('.tg-fill'), knob: r.querySelector('.tg-knob') };
      });
      const flip = (i) => S[i] + 0.7;
      const sw = (i) => ({ x: x0 + w - 92, y: y0 + i * RH + RH / 2 + 4 });
      const cursor = cursorEl(stage);
      const cur = track([{ p: { x: 1640, y: 1000 } }].concat(items.map((_, i) => ({ t: flip(i) - 0.08, d: 0.55, p: sw(i) }))));
      return (f) => {
        const t = f / FPS, k = activeAt(S, t);
        head(f);
        fx(card, expoOut(win(t, 0.05, 0.7)), 0, 30, 8);
        putCursor(cursor, cur(t), t, 1 - 0.16 * (k >= 0 ? pressK(t, flip(k)) : 0));
        rows.forEach((rw, i) => {
          const q = inOut(win(t, flip(i), 0.32));
          const stretch = Math.sin(Math.PI * q);
          rw.r.style.opacity = (expoOut(win(t, 0.15 + i * 0.06, 0.6)) * (k > i ? 0.75 : 1)).toFixed(3);
          rw.r.classList.toggle('on', q > 0.5); rw.r.classList.toggle('focus', k === i);
          rw.knob.style.transform = `translateX(${(q * 44).toFixed(1)}px) scaleX(${(1 + 0.4 * stretch).toFixed(3)})`;
          rw.knob.style.transformOrigin = q < 0.5 ? '0 50%' : '100% 50%';
          rw.fill.style.transform = `scaleX(${q.toFixed(3)})`;
          wordsAt(rw.st, t, flip(i) + 0.2, 0, 0.04);
        });
      };
    },
  };

  // 5 · TOUCH & SWIPE — on a phone, a fingertip presses (ripple), drags the carousel 1:1, lets go and the cards carry
  //     on with momentum and spring onto the next page. The current card's message rises beside the phone.
  V.touch = {
    name: 'Touch & Swipe',
    note: 'Touch & swipe: on a phone a fingertip presses with a ripple, drags the carousel with it, lets go, and the cards carry on with momentum and spring onto the next page. The current card’s message rises beside the phone.',
    duration: (n, P) => durOf(n, P),
    build(stage, data, o) {
      const items = data.items, n = items.length, B = beat(o.P), S = starts(n, o.P), head = U.head(stage, data);
      const phone = el('div', 'tc-phone', '<div class="tc-screen"><div class="tc-track"></div><div class="tc-dots"></div></div>'); stage.append(phone);
      const trackEl = phone.querySelector('.tc-track'), dotsEl = phone.querySelector('.tc-dots');
      const PG = 360;
      items.forEach((it, i) => { const c = el('div', 'tc-card'); c.style.cssText = `left:${i * PG}px;--ac:${accent(i)}`; c.innerHTML = `<span class="tc-ic">${U.icon(it.icon || 'star', 64, 2)}</span><b>${esc(it.title)}</b><span>${esc(it.detail)}</span>`; trackEl.append(c); });
      dotsEl.innerHTML = items.map(() => '<i></i>').join('');
      const dots = [...dotsEl.children];
      const finger = el('div', 'tc-finger', '<i class="ix-ripple"></i>'); stage.append(finger);
      const frip = finger.firstChild;
      const panes = items.map((it) => { const p = el('div', 'tc-pane'); const ti = words(it.title, 'tc-title', 'mask'), de = words(it.detail, 'tc-detail', 'mask'); p.append(ti.el, de.el); stage.append(p); return { p, ti, de }; });
      const DRAG = 220;
      const press = (i) => S[i] + (i ? 0.1 : 0.35), rel = (i) => press(i) + 0.5;
      const offset = (t) => {
        let off = 0;
        for (let i = 1; i < n; i++) {
          if (t < press(i)) return off;
          const base = -(i - 1) * PG;
          if (t < rel(i)) return base - DRAG * inOut(win(t, press(i) + 0.05, 0.45));
          off = lerp(base - DRAG, -i * PG, backOut(win(t, rel(i), 0.6), 1.3));
        }
        return off;
      };
      const SX = 620 - 160, SY = 560;                                     // finger start on screen (stage coords)
      return (f) => {
        const t = f / FPS, k = activeAt(S, t);
        head(f);
        fx(phone, expoOut(win(t, 0.05, 0.8)), 0, 60, 8);
        trackEl.style.transform = `translateX(${offset(t).toFixed(1)}px)`;
        const page = -offset(t) / PG;
        dots.forEach((d, i) => d.classList.toggle('on', Math.abs(page - i) < 0.5));
        // finger: lands, drags (for i ≥ 1), lifts
        let fxp = SX + 200, fyp = SY, fo = 0, fs = 1;
        if (k >= 0) {
          const p = press(k), r = rel(k);
          const land = expoOut(win(t, p - 0.2, 0.2)), lift = win(t, r, 0.25);
          fo = land * (1 - lift); fs = 1.25 - 0.25 * land + 0.3 * lift;
          fxp = SX + 200 - (k ? DRAG * inOut(win(t, p + 0.05, 0.45)) : 0);
          ripple(frip, t, p, 2.2);
        }
        finger.style.transform = `translate(${fxp.toFixed(1)}px, ${fyp}px) scale(${fs.toFixed(3)})`;
        finger.style.opacity = fo.toFixed(3);
        panes.forEach((pn, i) => {
          const last = i === n - 1, x = last ? 0 : inOut(win(t, S[i] + B - 0.1, 0.3));
          pn.p.style.visibility = t >= S[i] && (last || t < S[i] + B + 0.3) ? 'visible' : 'hidden';
          wordsAt(pn.ti, t, rel(i) + (i ? 0.2 : 0), x); wordsAt(pn.de, t, rel(i) + 0.4, x, 0.035);
        });
      };
    },
  };

  const SET = {
    title: 'Interaction Kit', item: 'Action', ph: ['Control label (Search, Auto-sync…)', 'Text it types / shows'],
    storageKey: 'interaction-kit-data-v1',
    variants: [
      { id: 'click', file: 'v1-cursor-click.html', name: 'Cursor & Click' },
      { id: 'drag', file: 'v2-drag-drop.html', name: 'Drag & Drop' },
      { id: 'prompt', file: 'v3-prompt-send.html', name: 'Prompt & Send' },
      { id: 'toggle', file: 'v4-toggle-switches.html', name: 'Toggle Switches' },
      { id: 'touch', file: 'v5-touch-swipe.html', name: 'Touch & Swipe' },
    ],
    defaults: {
      pace: 'normal', motion: 'default', order: 'forward',
      kicker: 'Product tour', heading: 'Your report, ready in three moves',
      items: [
        { title: 'Revenue by region', detail: 'Show revenue by region for Q3', icon: 'search' },
        { title: 'Auto-sync', detail: 'Synced · updates every hour', icon: 'layers' },
        { title: 'Share with team', detail: 'Sent to 12 teammates', icon: 'send' },
        { title: 'Smart alerts', detail: 'Alert me when a target slips', icon: 'mail' },
      ],
    },
  };
  window.InteractionFX = { variants: V, set: SET, mount: (id) => SM.mount({ id, name: V[id].name, note: V[id].note, duration: V[id].duration, build: V[id].build, set: SET }) };
})();
