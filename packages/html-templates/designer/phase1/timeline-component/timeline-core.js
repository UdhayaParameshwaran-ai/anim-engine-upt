/* Timeline (component set) — shared runtime for the three layouts of src/components/diagrams/Timeline.tsx.
 *
 *   ribbon    = layout "ribbon": a port of Timeline.tsx — same constants, easings, timings, card sizes, auto-focus pass,
 *               scale-to-box, and the look the active theme picks (lookFor in timelineLooks.ts).
 *   camera    = layout "camera":    the Camera Track motion (vertical spine, camera glides event to event, pull-back overview).
 *   filmstrip = layout "filmstrip": the Filmstrip Focus motion (full-bleed chapters on a bottom scrubber, end card).
 *
 * Three controls shape every layout:
 *   Comes in — (ribbon) layout default · from left / right / top / bottom · pop · slam · fade   (the component's `entrance`)
 *   Order    — (ribbon) first→last · last→first · centre out · all together                     (the component's `order`)
 *   Pace     — Relaxed / Normal / Snappy: stretches the GAP between events and the HOLD. Entrances keep their fixed lengths.
 *
 * NOT ported from the component (it is a copy, not the component itself):
 *   - chart media (bar / line / donut / gauge) and `custom` media: only image, text and stat media are drawn here;
 *   - narration-driven highlight (`active` / `activeAt`): the ribbon always runs the automatic focus pass;
 *   - per-event `mediaHeight`;
 *   - the retired looks (playful-pop wavy line + sticker dots + pill dates, neo-retro-print double line + diamonds + stamps + tape):
 *     the four HTML themes only ever use the classic / daylight / aurora looks, so those branches would be dead code here;
 *   - the stat media is a close copy of StatCounter size="inline" (count-up + rise on the smooth spring), not the component itself.
 * Camera and filmstrip show the picture only (their card layouts have no media slot).
 *
 * Nothing animates on its own: every layout is a pure function of time, so the playhead can be scrubbed or rendered frame by frame.
 */
(function () {
  'use strict';

  const F = 30;
  const W = 1920, H = 1080;
  const SPR = {"smooth":[0,0.0446,0.1443,0.2642,0.3849,0.4963,0.594,0.6768,0.7452,0.8009,0.8454,0.8807,0.9084,0.93,0.9467,0.9596,0.9694,0.9769,0.9826,0.987,0.9902,0.9927,0.9946,0.9959,0.997,0.9978,0.9983,0.9988,0.9991,0.9993,0.9995,0.9996,0.9997,0.9998,0.9999,0.9999,0.9999,0.9999,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],"snappy":[0,0.1124,0.3305,0.5483,0.7235,0.8475,0.9268,0.9728,0.9965,1.0067,1.0094,1.0087,1.0067,1.0046,1.0029,1.0016,1.0008,1.0003,1.0001,0.9999,0.9999,0.9999,0.9999,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],"bouncy":[0,0.0852,0.2879,0.5365,0.7758,0.9708,1.1053,1.1779,1.1978,1.1795,1.1387,1.0894,1.0423,1.0042,0.9782,0.9644,0.9609,0.9648,0.973,0.9828,0.992,0.9995,1.0045,1.0071,1.0077,1.0069,1.0053,1.0033,1.0015,1,0.9991,0.9986,0.9985,0.9986,0.999,0.9994,0.9997,1,1.0002,1.0003,1.0003,1.0003,1.0002,1.0001,1.0001,1,1,0.9999,0.9999,0.9999,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]};

  const VARIANTS = [
    { id: 'ribbon', file: 'v1-ribbon.html', name: 'Ribbon' },
    { id: 'camera', file: 'v2-camera.html', name: 'Camera Track' },
    { id: 'filmstrip', file: 'v3-filmstrip.html', name: 'Filmstrip Focus' },
  ];
  const STORAGE_KEY = 'timeline-component-data-v1';
  const PACES = {
    relaxed: { stagger: 1.5, focus: 1.5, span: 1.3 },
    normal: { stagger: 1, focus: 1, span: 1 },
    snappy: { stagger: 0.6, focus: 0.7, span: 0.75 },
  };
  const MOTIONS = [['default', 'Layout default'], ['from-left', 'From left'], ['from-right', 'From right'], ['from-top', 'From top'], ['from-bottom', 'From bottom'], ['pop', 'Pop'], ['slam', 'Slam'], ['fade', 'Fade']];
  const ORDERS = [['forward', 'First → last'], ['reverse', 'Last → first'], ['centre', 'Centre out'], ['together', 'All together']];
  const MEDIA_KINDS = [['image', 'Picture'], ['text', 'Text'], ['stat', 'Stat']];
  const MAX_EVENTS = 8;

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
  /** The theme's backdrop, drawn behind the stage. Colours come from CSS variables, so it follows the theme. */
  const backdropHTML = (kind) =>
    kind === 'daylight' ? '<div class="bd"><div class="bd-grid"></div><div class="bd-tint t1"></div><div class="bd-tint t2"></div></div>'
    : kind === 'aurora' ? '<div class="bd"><div class="bd-glow g1"></div><div class="bd-glow g2"></div><div class="bd-glow g3"></div><div class="bd-dots"></div></div>'
    : '';

  // ── Looks (timelineLooks.ts). Only the three the four HTML themes can pick; colours stay CSS variables. ──
  const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
  const LOOKS = {
    classic: {
      id: 'classic', weights: { heading: 700, title: 700, date: 700, body: 400 }, headingSize: 64, kicker: 'caps', headExtra: 0,
      stem: 'solid', dotR: 18, dateBox: 40, card: { radius: 'var(--radius)', border: 2, pad: 0, body: [18, 22] }, accents: ['primary'],
    },
    'daylight-clean': {
      id: 'daylight-clean', weights: { heading: 700, title: 700, date: 700, body: 400 }, headingSize: 66, kicker: 'pill', headExtra: 0,
      stem: 'solid', dotR: 19, dateBox: 40, card: { radius: '22px', border: 2, pad: 10, body: [16, 22] }, accents: ['primary', 'secondary', 'quaternary', 'tertiary'],
    },
    'aurora-night': {
      id: 'aurora-night', weights: { heading: 700, title: 700, date: 700, body: 400 }, headingSize: 66, kicker: 'mono', headExtra: 0,
      stem: 'dashed', dotR: 19, dateBox: 40, card: { radius: '18px', border: 2, pad: 0, body: [18, 22] }, accents: ['primary', 'secondary', 'tertiary', 'quaternary'],
    },
  };
  /** Which look a theme uses (lookFor): the plain themes are the same look; the backdrop belongs to the page here. */
  const lookFor = (id) => (id === 'daylight-clean' || id === 'daylight-plain' ? LOOKS['daylight-clean'] : id === 'aurora-night' || id === 'aurora-plain' ? LOOKS['aurora-night'] : LOOKS.classic);

  /** A spring sampled from Remotion, at a (fractional) frame. */
  const sp = (name, f) => {
    const a = SPR[name];
    if (f <= 0) return 0;
    if (f >= a.length - 1) return a[a.length - 1];
    const i = Math.floor(f), k = f - i;
    return a[i] + (a[i + 1] - a[i]) * k;
  };

  // ── Motion utilities (same curves as Timeline.tsx) ───────────────────────
  const U = {
    W, H, F,
    clamp: (v, a = 0, b = 1) => Math.min(b, Math.max(a, v)),
    /** 0→1 progress of t through [start, start + dur]. */
    p: (t, start, dur) => U.clamp((t - start) / dur),
    lerp: (a, b, k) => a + (b - a) * k,
    outCubic: (k) => 1 - Math.pow(1 - k, 3),
    inOutCubic: (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
    outExpo: (k) => (k >= 1 ? 1 : 1 - Math.pow(2, -10 * k)),
    outBack: (k) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); },
    /** Rises over `ramp` at `start`, falls over `ramp` ending at `end`. */
    window: (t, start, end, ramp = 0.35) => U.inOutCubic(U.p(t, start, ramp)) * (1 - U.inOutCubic(U.p(t, end - ramp, ramp))),
    /** Smooth spring (Remotion) at time t (s) for something that starts at `start` (s). */
    spring: (t, start) => sp('smooth', (t - start) * F),
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; },
    /** Wraps each character in a span so it can be staggered; words stay unbroken but lines can still wrap. */
    splitChars(text) {
      return String(text ?? '').split(/\s+/).filter(Boolean)
        .map((word) => `<span style="white-space:nowrap;display:inline-block">${[...word].map((ch) => `<span class="ch">${U.esc(ch)}</span>`).join('')}</span>`)
        .join(' ');
    },
    /** colour a→b by k (0–1), with CSS colour strings (variables are fine). */
    mix: (a, b, k) => `color-mix(in srgb, ${a} ${((1 - U.clamp(k)) * 100).toFixed(1)}%, ${b} ${(U.clamp(k) * 100).toFixed(1)}%)`,
    alpha: (c, a) => `color-mix(in srgb, ${c} ${(U.clamp(a) * 100).toFixed(1)}%, transparent)`,
    /** staggerRank from src/motion/motion.ts. */
    rank(i, n, order) {
      if (order === 'together') return 0;
      if (order === 'reverse') return n - 1 - i;
      if (order === 'centre') {
        const c = (n - 1) / 2;
        return [...Array(n).keys()].sort((a, b) => Math.abs(a - c) - Math.abs(b - c) || a - b).indexOf(i);
      }
      return i;
    },
    image: (item, i) => (item.image && item.image.trim()) || placeholder(i),
  };

  const cssVar = (n) => (getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888888');

  /** Generated picture for events without an image (Timeline.tsx `placeholder`; colours from the active theme). */
  function placeholder(i) {
    const v = cssVar;
    const pal = [[v('--primary'), v('--tertiary')], [v('--secondary'), v('--tertiary')], [v('--positive'), v('--quaternary')], [v('--tertiary'), v('--secondary')], [v('--quaternary'), v('--primary')], [v('--secondary'), v('--primary')]];
    const [a, b] = pal[i % pal.length];
    const bg = v('--bg'), on = v('--on-accent');
    const r = (n) => (Math.sin((i + 1) * 9301 + n * 49297) + 1) / 2;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>
    <radialGradient id="s" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${on}" stop-opacity=".55"/><stop offset="1" stop-color="${on}" stop-opacity="0"/></radialGradient></defs>
    <rect width="1600" height="1000" fill="url(#g)"/>
    <circle cx="${300 + r(1) * 1000}" cy="${180 + r(2) * 260}" r="${140 + r(3) * 120}" fill="url(#s)"/>
    <path d="M0 760 L${260 + r(4) * 200} ${430 + r(5) * 120} L${700 + r(6) * 160} 720 L${1000 + r(7) * 160} ${380 + r(8) * 140} L1600 700 L1600 1000 L0 1000Z" fill="${bg}" opacity=".35"/>
    <path d="M0 860 L${420 + r(9) * 200} 620 L${900 + r(10) * 200} 840 L1600 600 L1600 1000 L0 1000Z" fill="${bg}" opacity=".5"/>
  </svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  const DEFAULT_DATA = {
    kicker: 'Our journey',
    heading: 'From a sketch to a platform',
    pace: 'normal',
    motion: 'default',
    order: 'forward',
    items: [
      { date: '2019', title: 'The first sketch', detail: 'Two founders, one whiteboard and a question worth answering.', image: '' },
      { date: '2020', title: 'First prototype', detail: 'A rough build shipped to twelve friendly testers who broke everything.', image: '' },
      { date: '2022', title: 'Public launch', detail: 'Opened the doors and welcomed teams in the first month.', image: '', media: { kind: 'stat', value: 10000, prefix: '', suffix: '+', label: 'teams joined' } },
      { date: '2024', title: 'Going global', detail: 'New offices in three regions and support for twenty languages.', image: '', media: { kind: 'text', text: 'Twenty languages, three regions', label: 'Reach' } },
      { date: '2026', title: 'What comes next', detail: 'Bringing motion-first storytelling to every classroom and team.', image: '' },
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

  // Downscale uploads so they stay light enough for localStorage.
  function readImage(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = reject;
      fr.onload = () => {
        const img = new Image();
        img.onerror = () => resolve(fr.result);
        img.onload = () => {
          const max = 1600, k = Math.min(1, max / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', 0.85));
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }

  const decimalsOf = (n) => { const s = String(n); const d = s.indexOf('.'); return d === -1 ? 0 : Math.min(s.length - d - 1, 2); };
  const fmtNum = (v, d) => Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

  // ═════════════════════════════════════════════════════════════════════════
  // RIBBON — Timeline.tsx
  // ═════════════════════════════════════════════════════════════════════════
  const REF_W = 1920, MARGIN_X = 120, CARD_EDGE = 40, STEM = 56, IMG_H = 176, LINE_H = 6, MEDIA_PAD = 16, DISTANCE = 160;

  function buildRibbon(stage, data, o) {
    const { el, esc, clamp, lerp, mix, alpha } = U;
    const { outCubic, inOutCubic, outExpo, outBack } = U;
    const prog = U.p, windowAt = (t, s, e, r) => U.window(t, s, e, r);
    const th = THEMES.find((x) => x.id === document.documentElement.dataset.theme);
    const look = lookFor(th ? th.id : '');
    const items = data.items, n = items.length;
    const P = o.P, order = o.order, motion = o.motion;
    const stagger = Math.round(17 * P.stagger), focusFrames = Math.round(45 * P.focus);
    const kicker = data.kicker, heading = data.heading;

    const hasHead = Boolean(kicker || heading);
    const extra = Math.max(0, IMG_H - IMG_H) + look.card.pad * 2;
    const headExtra = hasHead ? look.headExtra : 0;
    const REF_H = (hasHead ? 1080 : 880) + 2 * extra + headExtra;
    const k = Math.min(W / REF_W, H / REF_H);
    const RW = W / k, RH = H / k;
    const oy = (RH - REF_H) / 2;
    const X0 = MARGIN_X, X1 = RW - MARGIN_X, LEN = X1 - X0;
    const LINE_Y = (hasHead ? 610 + extra + headExtra : REF_H / 2) + oy;
    const slot = LEN / n;
    const pos = (i) => X0 + slot * (i + 0.5);
    const cardW = Math.min(420, Math.max(240, (n > 1 ? 2 * slot : LEN) - 48));
    const sideOf = (i) => (i % 2 === 0 ? -1 : 1);

    // Timing in seconds from the start.
    const T0 = 0.9, STAG = stagger / F, FOCUS = focusFrames / F;
    const rankOf = (i) => U.rank(i, n, order);
    const at = (i) => T0 + rankOf(i) * STAG;
    const lastRank = order === 'together' ? 0 : n - 1;
    const BUILD_END = T0 + lastRank * STAG + 1.0;
    const H0 = BUILD_END + 0.4;
    const focusStart = (i) => H0 + i * FOCUS;
    const SETTLE = H0 + n * FOCUS;
    const duration = SETTLE + 1.2;

    const family = 'var(--font-heading)';
    const accentOf = (i) => `var(--${look.accents[i % look.accents.length]})`;
    const abs = (e, css) => { e.style.position = 'absolute'; if (css) e.style.cssText += ';' + css; return e; };

    const root = el('div');
    abs(root, `left:0;top:0;width:${RW}px;height:${RH}px;transform:scale(${k});transform-origin:0 0`);
    stage.append(root);

    // Heading: kicker, title
    let kickerEl = null, kickerSpan = null, headEl = null, headSpan = null;
    if (kicker) {
      if (look.kicker === 'caps') {
        kickerEl = abs(el('div'), `left:${MARGIN_X}px;top:${72 + oy}px;overflow:hidden;padding-bottom:6px;font-family:${family};font-size:24px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--secondary)`);
        kickerSpan = el('span'); kickerSpan.style.display = 'inline-block'; kickerSpan.textContent = kicker; kickerEl.append(kickerSpan);
      } else if (look.kicker === 'pill') {
        kickerEl = abs(el('div'), `left:${MARGIN_X}px;top:${70 + oy}px;transform-origin:0 50%`);
        kickerSpan = el('span'); kickerSpan.textContent = kicker;
        kickerSpan.style.cssText = `display:inline-block;padding:6px 22px;border-radius:999px;background:var(--secondary);color:var(--on-accent);font-family:${family};font-weight:${look.weights.heading};font-size:24px;letter-spacing:0.08em;text-transform:uppercase;box-shadow:0 4px 0 ${alpha('var(--text)', 0.18)}`;
        kickerEl.append(kickerSpan);
      } else {
        kickerEl = abs(el('div'), `left:${MARGIN_X}px;top:${76 + oy}px;display:flex;align-items:center;gap:16px;font-family:${MONO};font-size:22px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:var(--primary)`);
        kickerSpan = el('span'); kickerSpan.textContent = kicker;
        const bar = el('span'); bar.style.cssText = 'height:2px;background:var(--text);width:0';
        kickerEl.append(kickerSpan, bar); kickerEl._bar = bar;
      }
      root.append(kickerEl);
    }
    if (heading) {
      headEl = abs(el('div'), `left:${MARGIN_X}px;top:${108 + oy}px;overflow:hidden;padding-bottom:6px;white-space:nowrap;font-family:${family};font-size:${look.headingSize}px;font-weight:${look.weights.heading};letter-spacing:-0.02em;line-height:1.1;color:var(--text)`);
      headSpan = el('span'); headSpan.style.display = 'inline-block'; headSpan.textContent = heading; headEl.append(headSpan);
      root.append(headEl);
    }

    // Connector (ribbon): a grey base that draws across and a lit progress bar with a glow
    const lineBase = abs(el('div'), `left:${X0}px;top:${LINE_Y}px;height:${LINE_H}px;border-radius:${LINE_H / 2}px;transform:translateY(-50%);background:var(--border)`);
    const lineLit = abs(el('div'), `left:${X0}px;top:${LINE_Y}px;height:${LINE_H}px;border-radius:${LINE_H / 2}px;transform:translateY(-50%);background:linear-gradient(90deg, var(--primary), ${mix('var(--primary)', 'var(--text)', 0.35)});box-shadow:0 0 24px ${alpha('var(--primary)', 0.6)}`);
    root.append(lineBase, lineLit);

    // Events
    const nodes = items.map((it, i) => {
      const s = sideOf(i), x = pos(i), R = look.dotR, accent = accentOf(i);
      const media = it.media && (it.media.kind === 'text' || it.media.kind === 'stat') ? it.media : { kind: 'image' };
      const pad = look.card.pad, bd = look.card.border;
      const stemTop = s < 0 ? LINE_Y - R - STEM : LINE_Y + R;
      const cardLeft = clamp(x - cardW / 2, CARD_EDGE, RW - CARD_EDGE - cardW);

      const stem = abs(el('div'), `left:${x}px;top:${stemTop}px;height:${STEM}px;transform-origin:${s < 0 ? '50% 100%' : '50% 0'}`);
      if (look.stem === 'solid') stem.style.cssText += ';width:4px;margin-left:-2px';
      else stem.style.cssText += `;width:5px;margin-left:-2.5px;background:repeating-linear-gradient(180deg, ${accent} 0 10px, transparent 10px 18px)`;

      const card = abs(el('div'), `left:${cardLeft}px;${s < 0 ? `bottom:${RH - (LINE_Y - R - STEM)}px` : `top:${LINE_Y + R + STEM}px`};width:${cardW}px;background:var(--surface);border-style:solid;border-width:${bd}px;border-radius:${look.card.radius};transform-origin:${s < 0 ? '50% 100%' : '50% 0'}`);
      const clip = el('div'); clip.style.cssText = `overflow:hidden;border-radius:max(0px, calc(${look.card.radius} - ${bd}px))`;
      const padBox = el('div'); padBox.style.padding = pad + 'px';
      const mbox = el('div'); mbox.style.cssText = `position:relative;height:${IMG_H}px;box-sizing:border-box;overflow:hidden;${media.kind === 'image' ? '' : 'background:var(--raised)'}`;
      let pic = null, textBox = null, statParts = null;
      if (media.kind === 'image') {
        pic = el('img'); pic.alt = ''; pic.src = U.image(it, i);
        pic.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover';
        mbox.append(pic);
      } else if (media.kind === 'text') {
        const len = (media.text || '').length;
        const size = len <= 36 ? 36 : len <= 72 ? 30 : len <= 120 ? 26 : 22;
        textBox = abs(el('div'), `inset:${MEDIA_PAD}px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center`);
        textBox.innerHTML = `${media.label ? `<div style="font-family:${MONO};font-size:18px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:${mix('var(--primary)', 'var(--text)', 0.5)};margin-bottom:10px">${esc(media.label)}</div>` : ''}<div style="font-family:${family};font-size:${size}px;font-weight:700;line-height:1.25;color:var(--text)">${esc(media.text || '')}</div>`;
        mbox.append(textBox);
      } else {
        // stat — a copy of StatCounter size="inline": 80px number, 24px label, count-up on the smooth spring
        const dec = media.decimals != null && media.decimals !== '' ? Number(media.decimals) : decimalsOf(Number(media.value) || 0);
        const wrap = abs(el('div'), `inset:${MEDIA_PAD}px;display:flex;align-items:center;justify-content:center`);
        const col = el('div'); col.style.cssText = `display:inline-flex;flex-direction:column;align-items:center;text-align:center;gap:8px;font-family:${family}`;
        const numWrap = el('div'); numWrap.style.cssText = 'transform-origin:center';
        const numRow = el('div'); numRow.style.cssText = 'display:inline-flex;align-items:baseline;color:var(--primary);font-size:80px;font-weight:700;line-height:1;letter-spacing:-0.02em;font-variant-numeric:tabular-nums';
        const pre = el('span'); pre.style.cssText = 'font-size:49.6px;margin-right:4px'; pre.textContent = media.prefix || '';
        const val = el('span'); val.style.cssText = 'display:inline-grid;font-variant-numeric:tabular-nums';
        const ghost = el('span'); ghost.style.cssText = 'grid-area:1/1;visibility:hidden'; ghost.textContent = fmtNum(Number(media.value) || 0, dec);
        const cur = el('span'); cur.style.cssText = 'grid-area:1/1;justify-self:end';
        val.append(ghost, cur);
        const suf = el('span'); suf.style.cssText = 'font-size:49.6px;margin-left:3px'; suf.textContent = media.suffix || '';
        numRow.append(pre, val, suf); numWrap.append(numRow);
        const lab = el('div'); lab.style.cssText = 'color:var(--text-muted);font-family:var(--font);font-size:24px;font-weight:500;line-height:1.25'; lab.textContent = media.label || '';
        col.append(numWrap, lab); wrap.append(col); mbox.append(wrap);
        statParts = { numWrap, cur, lab, value: Number(media.value) || 0, dec };
      }
      padBox.append(mbox);
      const body = el('div'); body.style.padding = `${look.card.body[0]}px ${look.card.body[1]}px ${look.card.body[0] + 4}px`;
      const title = el('div'); title.style.cssText = `font-family:${family};font-size:30px;font-weight:${look.weights.title};line-height:1.2;color:var(--text)`; title.textContent = it.title;
      body.append(title);
      let detail = null;
      if (it.detail) {
        detail = el('div');
        detail.style.cssText = `margin-top:8px;font-family:var(--font);font-size:22px;font-weight:${look.weights.body};line-height:1.4;color:var(--text-muted);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden`;
        detail.textContent = it.detail; body.append(detail);
      }
      clip.append(padBox, body); card.append(clip);

      const dot = abs(el('div'), `left:${x}px;top:${LINE_Y}px;width:36px;height:36px;margin:-18px 0 0 -18px;border-radius:50%;box-sizing:border-box;border:6px solid var(--primary)`);
      const date = abs(el('div'), `left:${x}px;top:${s < 0 ? LINE_Y + R + 12 : LINE_Y - R - 12 - look.dateBox}px;font-family:${family};font-size:40px;line-height:1;font-weight:${look.weights.date};font-variant-numeric:tabular-nums;white-space:nowrap`);
      date.textContent = it.date;
      root.append(stem, card, dot, date);
      return { s, x, R, stem, card, dot, date, title, detail, pic, textBox, statParts, mbox, media, accent, cardLeft };
    });

    const bead = abs(el('div'), `width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:var(--on-accent);box-shadow:0 0 0 6px ${alpha('var(--primary)', 0.45)}, 0 0 30px ${alpha('var(--primary)', 0.9)}`);
    root.append(bead);

    function update(t) {
      // The line head reaches each dot exactly as it pops, then runs on to the end.
      const head = order === 'together'
        ? clamp(LEN * outCubic(prog(t, T0, 0.8)) + (t > BUILD_END ? (t - BUILD_END) * 2000 : 0), 0, LEN)
        : clamp(slot * ((t - T0) / STAG + 0.5) + (t > BUILD_END ? (t - BUILD_END) * 2000 : 0), 0, LEN);

      // Highlight: the automatic pass (narration cues are not ported)
      const w = items.map((_, i) => windowAt(t, focusStart(i), focusStart(i) + FOCUS + 0.2, 0.4));
      const any = Math.min(1, w.reduce((a, b) => a + b, 0));
      let progressX = X0;
      for (let i = 0; i <= n; i++) {
        const target = i < n ? pos(i) : X1;
        const from = i < n ? focusStart(i) - 0.15 : SETTLE - 0.2;
        progressX = lerp(progressX, target, inOutCubic(prog(t, from, 0.6)));
      }
      const beadOn = prog(t, H0 - 0.4, 0.3) * (1 - prog(t, SETTLE + 0.6, 0.4));
      const progressOn = beadOn > 0 || t > SETTLE ? 1 : 0;

      const kickerP = outCubic(prog(t, 0.05, 0.6));
      const headingP = outCubic(prog(t, 0.15, 0.7));

      if (kickerEl) {
        if (look.kicker === 'caps') kickerSpan.style.transform = `translateY(${(1 - kickerP) * 110}%)`;
        else if (look.kicker === 'pill') { kickerEl.style.opacity = kickerP; kickerEl.style.transform = `rotate(-2deg) scale(${0.8 + 0.2 * kickerP})`; }
        else { kickerEl.style.opacity = kickerP; kickerEl.style.transform = `translateY(${(1 - kickerP) * 12}px)`; kickerEl._bar.style.width = 120 * kickerP + 'px'; }
      }
      if (headEl) headSpan.style.transform = `translateY(${(1 - headingP) * 110}%)`;

      lineBase.style.width = head + 'px'; lineBase.style.opacity = head > 0 ? 1 : 0;
      lineLit.style.width = Math.max(0, progressX - X0) + 'px'; lineLit.style.opacity = progressOn;

      nodes.forEach((nd, i) => {
        const s = nd.s, s0 = at(i), wi = w[i];
        const dim = 1 - 0.6 * clamp(any - wi, 0, 1);
        const pop = prog(t, s0, 0.45);
        const stemP = outCubic(prog(t, s0 + 0.15, 0.3));
        const dateP = outCubic(prog(t, s0 + 0.1, 0.5));
        const cardP = outExpo(prog(t, s0 + 0.25, 0.8));
        const imgP = inOutCubic(prog(t, s0 + 0.3, 0.7));
        const picP = outCubic(prog(t, s0 + 0.3, 1.4));
        const titleP = outCubic(prog(t, s0 + 0.55, 0.5));
        const textP = outCubic(prog(t, s0 + 0.68, 0.5));
        const filled = wi > 0.5 || progressX >= pos(i) - 1;
        const dotScale = pop > 0 ? outBack(pop) * (1 + 0.35 * wi) : 0;

        // stem
        if (look.stem === 'solid') nd.stem.style.background = mix('var(--border)', 'var(--primary)', wi);
        nd.stem.style.transform = `scaleY(${stemP})`;
        nd.stem.style.opacity = dim;

        // card: layout-default entrance, or the chosen one (tilt is 0 in these looks; the highlight scale stays)
        const cardBorder = mix('var(--border)', 'var(--primary)', clamp(wi / 0.4, 0, 1));
        const hi = 1 + 0.08 * wi;
        let move;
        if (motion === 'from-left') move = `translateX(${-(1 - cardP) * DISTANCE}px) scale(${hi})`;
        else if (motion === 'from-right') move = `translateX(${(1 - cardP) * DISTANCE}px) scale(${hi})`;
        else if (motion === 'from-top') move = `translateY(${-(1 - cardP) * DISTANCE}px) scale(${hi})`;
        else if (motion === 'from-bottom') move = `translateY(${(1 - cardP) * DISTANCE}px) scale(${hi})`;
        else if (motion === 'pop') move = `scale(${(0.6 + 0.4 * cardP) * hi})`;
        else if (motion === 'slam') move = `scale(${(1.6 - 0.6 * cardP) * hi})`;
        else if (motion === 'fade') move = `scale(${hi})`;
        else move = `translateY(${(1 - cardP) * 40 * s}px) scale(${(0.92 + 0.08 * cardP) * hi})`;
        nd.card.style.borderColor = cardBorder;
        nd.card.style.boxShadow = wi > 0.4 ? `0 24px 60px ${alpha('var(--primary)', 0.35)}` : 'var(--shadow-card)';
        nd.card.style.zIndex = wi > 0.4 ? 2 : 1;
        nd.card.style.opacity = prog(t, s0 + 0.25, 0.25) * dim;
        nd.card.style.transform = move;

        // media: reveal clip, then the picture settles / the text or stat rises in
        nd.mbox.style.clipPath = s < 0 ? `inset(${(1 - imgP) * 100}% 0 0 0)` : `inset(0 0 ${(1 - imgP) * 100}% 0)`;
        if (nd.pic) nd.pic.style.transform = `scale(${1.25 - 0.2 * picP + 0.06 * wi})`;
        const appear = outCubic(prog(t, s0 + 0.45, 0.5));
        if (nd.textBox) { nd.textBox.style.opacity = appear; nd.textBox.style.transform = `translateY(${(1 - appear) * 14}px)`; }
        if (nd.statParts) {
          const sp0 = s0 + 0.35;
          const e = U.spring(t, sp0);
          const lin = prog(t, sp0, 42 / F), cnt = 1 - Math.pow(1 - lin, 3);
          nd.statParts.numWrap.style.opacity = e;
          nd.statParts.numWrap.style.transform = `translateY(${(1 - e) * 40}px)`;
          nd.statParts.cur.textContent = fmtNum(nd.statParts.value * cnt, nd.statParts.dec);
          const le = U.spring(t, sp0 + 8 / F);
          nd.statParts.lab.style.opacity = le; nd.statParts.lab.style.transform = `translateY(${(1 - le) * 40}px)`;
        }

        // title + detail
        nd.title.style.opacity = titleP; nd.title.style.transform = `translateY(${(1 - titleP) * 16}px)`;
        if (nd.detail) { nd.detail.style.opacity = textP; nd.detail.style.transform = `translateY(${(1 - textP) * 16}px)`; }

        // dot
        nd.dot.style.background = filled ? 'var(--primary)' : 'var(--surface)';
        nd.dot.style.boxShadow = `0 0 ${40 * wi}px ${alpha('var(--primary)', 0.9 * wi)}`;
        nd.dot.style.transform = `scale(${dotScale})`;

        // date
        nd.date.style.color = mix('var(--text-muted)', 'var(--text)', wi);
        nd.date.style.opacity = dateP * dim;
        nd.date.style.transform = `translate(-50%, ${(1 - dateP) * -20 * s}px) scale(${1 + 0.15 * wi})`;
      });

      bead.style.left = progressX + 'px'; bead.style.top = LINE_Y + 'px'; bead.style.opacity = beadOn;
    }
    return { update, duration };
  }

  // ═════════════════════════════════════════════════════════════════════════
  // CAMERA TRACK — a vertical spine and a camera that glides event to event
  // ═════════════════════════════════════════════════════════════════════════
  function buildCamera(stage, data, o) {
    const { el, esc, splitChars } = U;
    const items = data.items, n = items.length;
    const GAP = 600, CX = 960;
    const Y = (i) => 540 + i * GAP;              // world y of event i (i = −1 is the intro)
    const S = 2.8 * o.P.span, M = (k) => 1.2 + k * S;   // camera starts moving to event k
    const R = (k) => M(k) + 0.55;                // event k reveal starts
    const OUT = 1.2 + n * S;                     // pull-back starts
    const duration = OUT + 2.2;

    // Overview framing (intro heading → last event)
    const top = Y(-1) - 160, bottom = Y(n - 1) + 260;
    const sOv = Math.min(1, 980 / (bottom - top));
    const cOv = (top + bottom) / 2;

    stage.append(el('div', 'ct-glow'));
    const world = el('div', 'ct-world');
    stage.append(world);

    const intro = el('div', 'ct-intro', `<div class="k ct-m"><span>${esc(data.kicker)}</span></div><div class="h">${splitChars(data.heading)}</div>`);
    intro.style.top = Y(-1) + 'px';
    const introK = intro.querySelector('.k span'), introChars = [...intro.querySelectorAll('.h .ch')];

    const spine = el('div', 'ct-spine'), fill = el('div', 'ct-fill');
    const spineTop = Y(0) - GAP * 0.45, spineBottom = Y(n - 1) + GAP * 0.45;
    spine.style.top = fill.style.top = spineTop + 'px';
    world.append(intro, spine, fill);

    const nodes = items.map((it, i) => {
      const imgLeft = i % 2 === 0;                // image on the left of the spine for even events
      const media = el('div', 'ct-media' + (i % 2 ? ' alt' : ''), `<img alt="" src="${U.image(it, i)}"><div class="ct-slab"></div>`);
      media.style.top = Y(i) + 'px';
      media.style.left = (imgLeft ? CX - 60 - 760 : CX + 60) + 'px';

      const copy = el('div', 'ct-copy ' + (imgLeft ? 'right' : 'left'), `
        <div class="ct-date">${splitChars(it.date)}</div>
        <div class="ct-m" style="display:block"><div class="ct-title">${esc(it.title)}</div></div>
        ${it.detail ? `<div class="ct-text">${esc(it.detail)}</div>` : ''}`);
      copy.style.top = Y(i) + 'px';
      copy.style.left = (imgLeft ? CX + 80 : CX - 80 - 760) + 'px';

      const tick = el('div', 'ct-tick');
      tick.style.top = Y(i) + 'px';
      tick.style.left = (imgLeft ? CX - 60 : CX) + 'px';
      tick.style.width = '60px';
      tick.style.transformOrigin = imgLeft ? '100% 50%' : '0 50%';

      const ring = el('div', 'ct-ring'); ring.style.top = Y(i) + 'px';
      const dot = el('div', 'ct-dot'); dot.style.top = Y(i) + 'px';
      world.append(tick, media, copy, ring, dot);
      return {
        imgLeft, media, copy, tick, ring, dot,
        pic: media.querySelector('img'), slab: media.querySelector('.ct-slab'),
        chars: [...copy.querySelectorAll('.ct-date .ch')], title: copy.querySelector('.ct-title'), text: copy.querySelector('.ct-text'),
      };
    });

    const hud = el('div', 'ct-hud'), label = el('div', 'ct-label', esc(data.kicker));
    stage.append(hud, label);

    function update(t) {
      // Camera focus f: −1 (intro) → 0 → … → n−1
      let f = -1;
      for (let k = 0; k < n; k++) f = U.lerp(f, k, U.inOutCubic(U.p(t, M(k), 0.9)));
      const ov = U.inOutCubic(U.p(t, OUT, 1.4));
      const sc = U.lerp(1, sOv, ov);
      const cy = U.lerp(540 + f * GAP, cOv, ov);
      world.style.transform = `translateY(${540 - cy * sc}px) scale(${sc})`;

      // Intro heading
      introK.style.transform = `translateY(${(1 - U.outCubic(U.p(t, 0.05, 0.6))) * 110}%)`;
      introChars.forEach((c, j) => {
        const k = U.outBack(U.p(t, 0.15 + j * 0.025, 0.55));
        c.style.transform = `translateY(${(1 - k) * 60}px)`;
        c.style.opacity = U.p(t, 0.15 + j * 0.025, 0.2);
      });
      intro.style.opacity = U.lerp(U.clamp(1 - (f + 1) * 0.75), 1, ov);

      // Spine fills toward the camera
      spine.style.height = (U.outCubic(U.p(t, 0.5, 1.2)) * (spineBottom - spineTop)) + 'px';
      spine.style.opacity = U.p(t, 0.5, 0.3);
      const fillTo = Math.max(spineTop, U.lerp(Y(f), spineBottom, ov));
      fill.style.height = (fillTo - spineTop) + 'px';

      // HUD
      const active = U.clamp(Math.round(f), 0, n - 1);
      const hudOn = U.p(t, M(0) + 0.3, 0.4) * (1 - ov);
      hud.style.opacity = label.style.opacity = hudOn;
      hud.innerHTML = `<b>${String(active + 1).padStart(2, '0')}</b> / ${String(n).padStart(2, '0')}`;

      nodes.forEach((nd, i) => {
        const r = R(i);
        const w = U.clamp(1 - Math.abs(f - i));
        const shown = U.lerp(0.25 + 0.75 * w, 1, ov);
        const dir = nd.imgLeft ? 1 : -1;           // +1 when the spine is to the right of the image

        // Dot + pulse ring + connector tick
        const pop = U.p(t, r - 0.1, 0.45);
        nd.dot.style.transform = `scale(${pop > 0 ? U.outBack(pop) : 0})`;
        nd.dot.style.opacity = U.lerp(0.4 + 0.6 * w, 1, ov);
        const pr = U.p(t, r, 0.9);
        nd.ring.style.transform = `scale(${1 + pr * 2.2})`;
        nd.ring.style.opacity = pr > 0 && pr < 1 ? 0.7 * (1 - pr) : 0;
        nd.tick.style.transform = `scaleX(${U.outCubic(U.p(t, r, 0.3))})`;
        nd.tick.style.opacity = shown;

        // Slab wipe: grows from the spine side, then exits to the far side uncovering the photo
        const a = U.inOutCubic(U.p(t, r + 0.1, 0.4));
        const b = U.inOutCubic(U.p(t, r + 0.5, 0.45));
        const near = nd.imgLeft ? '100% 50%' : '0 50%', far = nd.imgLeft ? '0 50%' : '100% 50%';
        nd.slab.style.transformOrigin = b > 0 ? far : near;
        nd.slab.style.transform = `scaleX(${b > 0 ? 1 - b : a})`;
        nd.pic.style.opacity = b > 0 ? 1 : 0;
        nd.media.style.visibility = a > 0 ? 'visible' : 'hidden';
        const kb = 1.28 - 0.18 * U.outExpo(U.p(t, r + 0.5, 1.2)) - 0.08 * U.p(t, r + 0.5, 4);
        nd.pic.style.transform = `scale(${kb}) translateX(${dir * -12 * U.p(t, r + 0.5, 4)}px)`;
        nd.pic.style.filter = `grayscale(${(1 - shown) * 1.1}) brightness(${0.6 + 0.4 * shown})`;
        nd.media.style.boxShadow = w > 0.6 && ov < 0.5 ? '0 30px 80px color-mix(in srgb, var(--primary) 30%, transparent)' : 'var(--shadow-raised)';

        // Copy: date chars rise, title unmasks, text fades up
        nd.copy.style.opacity = shown;
        nd.chars.forEach((c, j) => {
          const k = U.outBack(U.p(t, r + 0.3 + j * 0.05, 0.5));
          c.style.transform = `translateY(${(1 - k) * 80}px) rotate(${(1 - k) * dir * 8}deg)`;
          c.style.opacity = U.p(t, r + 0.3 + j * 0.05, 0.15);
        });
        const ti = U.outCubic(U.p(t, r + 0.55, 0.6));
        nd.title.style.transform = `translateY(${(1 - ti) * 110}%)`;
        if (nd.text) {
          const tx = U.outCubic(U.p(t, r + 0.75, 0.6));
          nd.text.style.opacity = tx;
          nd.text.style.transform = `translateY(${(1 - tx) * 24}px)`;
        }
      });
    }
    return { update, duration };
  }

  // ═════════════════════════════════════════════════════════════════════════
  // FILMSTRIP FOCUS — full-bleed chapters on a bottom scrubber
  // ═════════════════════════════════════════════════════════════════════════
  function buildFilmstrip(stage, data, o) {
    const { el, esc, splitChars } = U;
    const items = data.items, n = items.length;
    const X0 = 120, X1 = 1800, LEN = X1 - X0, BAR_Y = 990;
    const x = (i) => X0 + LEN * (i + 0.5) / n;
    const S = 3.4 * o.P.span, T = (i) => 0.8 + i * S;
    const END = T(n);
    const duration = END + 2.2;

    const dark = el('div', 'ff-dark');
    const shots = items.map((it, i) => {
      const shot = el('div', 'ff-shot', `<img alt="" src="${U.image(it, i)}">`);
      shot.style.zIndex = 1 + i;
      return { shot, img: shot.querySelector('img') };
    });
    const shade = el('div', 'ff-shade'); shade.style.zIndex = 50;
    stage.append(dark, ...shots.map((s) => s.shot), shade);

    const layer = el('div'); layer.style.cssText = 'position:absolute;inset:0;z-index:60';
    stage.append(layer);

    const head = el('div', 'ff-head', `<div class="ff-m"><div class="k">${esc(data.kicker)}</div></div><div class="ff-m"><div class="h">${esc(data.heading)}</div></div>`);
    const headK = head.querySelector('.k'), headH = head.querySelector('.h');
    const count = el('div', 'ff-count', `<span class="cur"><span class="roll">${items.map((_, i) => `<span>${String(i + 1).padStart(2, '0')}</span>`).join('')}</span></span><span>/ ${String(n).padStart(2, '0')}</span>`);
    const roll = count.querySelector('.roll');

    const copies = items.map((it) => {
      const c = el('div', 'ff-copy', `
        <div class="ff-rule"></div>
        <div class="ff-m"><div class="ff-date">${splitChars(it.date)}</div></div>
        <div class="ff-m"><div class="ff-title">${esc(it.title)}</div></div>
        ${it.detail ? `<div class="ff-text">${esc(it.detail)}</div>` : ''}`);
      return { c, rule: c.querySelector('.ff-rule'), chars: [...c.querySelectorAll('.ff-date .ch')], title: c.querySelector('.ff-title'), text: c.querySelector('.ff-text') };
    });

    const bar = el('div', 'ff-bar'), fill = el('div', 'ff-fill');
    const ticks = items.map((it, i) => {
      const tick = el('div', 'ff-tick'); tick.style.left = x(i) + 'px';
      const label = el('div', 'ff-tlabel', esc(it.date)); label.style.left = x(i) + 'px';
      return { tick, label };
    });
    const marker = el('div', 'ff-marker');
    const end = el('div', 'ff-end', `<div class="ff-m"><div class="k">${esc(data.kicker)}</div></div><div class="h">${splitChars(data.heading)}</div>`);
    const endK = end.querySelector('.k'), endChars = [...end.querySelectorAll('.h .ch')];

    layer.append(head, count, ...copies.map((c) => c.c), bar, fill, ...ticks.flatMap((k) => [k.tick, k.label]), marker, end);

    function update(t) {
      const ov = U.inOutCubic(U.p(t, END, 0.9));   // end-card progress

      // Intro: bar draws, heading unmasks
      bar.style.width = U.outCubic(U.p(t, 0.1, 0.8)) * LEN + 'px';
      headK.style.transform = `translateY(${(1 - U.outCubic(U.p(t, 0.05, 0.6))) * 110}%)`;
      headH.style.transform = `translateY(${(1 - U.outCubic(U.p(t, 0.15, 0.6))) * 110}%)`;
      head.style.opacity = 1 - ov;
      count.style.opacity = U.p(t, T(0) + 0.3, 0.4) * (1 - ov);

      // Progress + marker travel to the active tick in step with the circle reveal
      let px = X0;
      for (let k = 0; k < n; k++) px = U.lerp(px, x(k), U.inOutCubic(U.p(t, T(k), 0.9)));
      px = U.lerp(px, X1, ov);
      fill.style.width = (px - X0) + 'px';
      marker.style.left = px + 'px';
      marker.style.transform = `scale(${U.outBack(U.p(t, T(0), 0.5))})`;

      // Which event is current (for counter + tick states)
      let cur = -1;
      for (let k = 0; k < n; k++) if (t >= T(k) + 0.3) cur = k;
      let rollY = 0;
      for (let k = 1; k < n; k++) rollY = U.lerp(rollY, k, U.inOutCubic(U.p(t, T(k) + 0.2, 0.5)));
      roll.style.transform = `translateY(${-rollY * 64}px)`;

      ticks.forEach((k, i) => {
        const on = U.p(t, 0.3 + i * 0.08, 0.4);
        const act = U.window(t, T(i) + 0.2, i === n - 1 ? END + 1 : T(i + 1) + 0.3, 0.3);
        k.tick.style.transform = `scale(${U.outBack(on) * (1 + 0.4 * act)})`;
        k.tick.style.borderColor = i <= cur ? 'var(--text)' : 'color-mix(in srgb, var(--text) 60%, transparent)';
        k.label.style.opacity = on * (0.55 + 0.45 * act) * (1 - ov * 0.5);
        k.label.style.transform = `translate(-50%, ${(1 - on) * 12 - act * 8}px) scale(${1 + act * 0.25})`;
        k.label.style.color = act > 0.5 ? 'var(--text)' : 'var(--text-muted)';
      });

      // Photos: circle bursts from the tick, then a slow Ken Burns drift
      shots.forEach((s, i) => {
        const rev = U.inOutCubic(U.p(t, T(i), 1.0));
        s.shot.style.clipPath = `circle(${rev * 2300}px at ${x(i)}px ${BAR_Y}px)`;
        s.shot.style.visibility = rev > 0 ? 'visible' : 'hidden';
        const kb = U.p(t, T(i), S + 1.2);
        const dir = i % 2 ? 1 : -1;
        s.img.style.transform = `scale(${1.18 - 0.14 * U.outCubic(kb)}) translate(${dir * 30 * kb}px, ${-10 * kb}px)`;
        s.img.style.filter = `brightness(${1 - 0.55 * ov}) blur(${ov * 6}px)`;
      });

      // Copy hand-over
      copies.forEach((c, i) => {
        const inT = T(i) + 0.45;
        const out = i === n - 1 ? U.inOutCubic(U.p(t, END - 0.1, 0.5)) : U.inOutCubic(U.p(t, T(i + 1) - 0.05, 0.45));
        c.c.style.visibility = t >= inT && out < 1 ? 'visible' : 'hidden';
        c.c.style.opacity = 1 - out;
        c.c.style.transform = `translateY(${-50 * out}px)`;
        c.rule.style.transform = `scaleX(${U.outExpo(U.p(t, inT, 0.6))})`;
        c.chars.forEach((ch, j) => {
          const k = U.outCubic(U.p(t, inT + 0.1 + j * 0.06, 0.6));
          ch.style.transform = `translateY(${(1 - k) * 105}%)`;
        });
        const ti = U.outCubic(U.p(t, inT + 0.35, 0.6));
        c.title.style.transform = `translateY(${(1 - ti) * 110}%)`;
        if (c.text) {
          const tx = U.outCubic(U.p(t, inT + 0.55, 0.6));
          c.text.style.opacity = tx;
          c.text.style.transform = `translateY(${(1 - tx) * 24}px)`;
        }
      });

      // End card
      end.style.visibility = ov > 0 ? 'visible' : 'hidden';
      endK.style.transform = `translateY(${(1 - U.outCubic(U.p(t, END + 0.2, 0.6))) * 110}%)`;
      endChars.forEach((ch, j) => {
        const k = U.outBack(U.p(t, END + 0.3 + j * 0.02, 0.55));
        ch.style.transform = `translateY(${(1 - k) * 50}px) scale(${0.9 + 0.1 * k})`;
        ch.style.opacity = U.p(t, END + 0.3 + j * 0.02, 0.2);
      });
    }
    return { update, duration };
  }

  const BUILD = { ribbon: buildRibbon, camera: buildCamera, filmstrip: buildFilmstrip };

  // ── Mount ────────────────────────────────────────────────────────────────
  function mount(variant) {
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
    const isRibbon = variant.layout === 'ribbon';

    const icons = {
      play: '<svg viewBox="0 0 16 16"><path d="M4 2.5v11l9-5.5z"/></svg>',
      pause: '<svg viewBox="0 0 16 16"><path d="M3.5 2h3v12h-3zM9.5 2h3v12h-3z"/></svg>',
      replay: '<svg viewBox="0 0 16 16"><path d="M8 3V0L4 4l4 4V5a4 4 0 1 1-4 4H2a6 6 0 1 0 6-6z"/></svg>',
    };
    const opts = (list) => list.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');

    document.body.insertAdjacentHTML('afterbegin', `
      <header class="app-bar">
        <a class="back" href="index.html">← All variants</a>
        <h1>Timeline · ${U.esc(variant.name)}</h1>
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
          <p class="hint">${U.esc(variant.note || '')} Space = play/pause · ←/→ = step 1 frame (Shift = 10) · Edit the events on the right; changes are shared by all layouts.</p>
        </section>
        <aside class="editor">
          <h2>Motion</h2>
          ${isRibbon ? `<div class="duo">
            <div class="field"><label>Comes in</label><select data-o="motion">${opts(MOTIONS)}</select></div>
            <div class="field"><label>Order</label><select data-o="order">${opts(ORDERS)}</select></div>
          </div>` : '<p class="cap">Comes in and Order apply to the Ribbon layout.</p>'}
          <div class="field"><label>Pace · gap between events and hold</label>
            <div class="seg" role="group" aria-label="Pace"><button data-pace="relaxed">Relaxed</button><button data-pace="normal">Normal</button><button data-pace="snappy">Snappy</button></div>
          </div>
          <h2>Heading</h2>
          <div class="field"><label>Kicker</label><input data-k="kicker"></div>
          <div class="field"><label>Heading</label><input data-k="heading"></div>
          <h2>Events <span class="cap">(3–6 work best; up to ${MAX_EVENTS})</span></h2>
          <div class="items"></div>
          <div class="row">
            <button class="btn primary add">+ Add event</button>
            <button class="btn export">Export JSON</button>
            <label class="btn">Import<input class="import" type="file" accept="application/json" hidden></label>
            <button class="btn reset">Reset</button>
          </div>
        </aside>
      </main>`);

    const $ = (s) => document.querySelector(s);
    const viewport = $('.viewport'), bdHost = $('.bd-host'), stage = $('.stage'), scrub = $('.scrub'), timeEl = $('.time'), playBtn = $('.play');

    // Scale the fixed 1920×1080 stage to whatever space the viewport has.
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
      const items = data.items.slice(0, MAX_EVENTS);
      if (items.length) {
        const built = BUILD[variant.layout](stage, Object.assign({}, data, { items }), { motion: isRibbon ? data.motion : 'default', order: isRibbon ? data.order : 'forward', P });
        update = built.update; duration = built.duration;
      } else {
        stage.innerHTML = '<div style="position:absolute;inset:0;display:grid;place-items:center;color:var(--text-muted);font-size:40px">Add an event to start</div>';
        update = () => {}; duration = 1;
      }
      t = Math.min(t, duration);
      document.querySelectorAll('.seg [data-pace]').forEach((b) => b.classList.toggle('on', b.dataset.pace === data.pace));
      document.querySelectorAll('select[data-o]').forEach((s) => { s.value = data[s.dataset.o]; });
      render();
    }
    function render() {
      // Slow drift for the backdrop's soft shapes (a pure function of time, so scrubbing stays exact).
      const d = (k, ph, amp) => viewport.style.setProperty(k, (Math.sin(t * 0.35 + ph) * amp).toFixed(1));
      d('--d1x', 0, 26); d('--d1y', 1.2, 20); d('--d2x', 1.7, 26); d('--d2y', 2.9, 20); d('--d3x', 3.4, 26); d('--d3y', 4.6, 20);
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
    document.querySelectorAll('select[data-o]').forEach((s) => {
      s.onchange = () => { data[s.dataset.o] = s.value; changed(false); };
    });
    document.querySelectorAll('.seg [data-pace]').forEach((b) => {
      b.onclick = () => { data.pace = b.dataset.pace; changed(false); };
    });

    function mediaFields(it, i) {
      const m = it.media || { kind: 'image' };
      if (m.kind === 'text') {
        return `<input data-m="label" placeholder="Small label above the text" value="${U.esc(m.label || '')}"><textarea data-m="text" rows="2" placeholder="Text on the card">${U.esc(m.text || '')}</textarea>`;
      }
      if (m.kind === 'stat') {
        return `<div class="duo"><input data-m="prefix" placeholder="Prefix ($)" value="${U.esc(m.prefix || '')}"><input data-m="suffix" placeholder="Suffix (%, +)" value="${U.esc(m.suffix || '')}"></div>
          <input data-m="value" type="number" step="any" placeholder="Value" value="${m.value ?? ''}"><input data-m="label" placeholder="Label under the number" value="${U.esc(m.label || '')}">`;
      }
      return '';
    }

    function renderEditor() {
      const list = $('.items');
      list.innerHTML = '';
      data.items.forEach((it, i) => {
        const card = U.el('div', 'item');
        const kind = (it.media && it.media.kind) || 'image';
        card.innerHTML = `
          <div class="item-head">
            <span class="num">Event ${String(i + 1).padStart(2, '0')}</span>
            <span class="tools">
              <button data-a="up" title="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
              <button data-a="down" title="Move down" ${i === data.items.length - 1 ? 'disabled' : ''}>↓</button>
              <button data-a="del" title="Remove">✕</button>
            </span>
          </div>
          <input data-f="date" placeholder="Date / label" value="${U.esc(it.date)}">
          <input data-f="title" placeholder="Title" value="${U.esc(it.title)}">
          <textarea data-f="detail" rows="2" placeholder="Short description">${U.esc(it.detail)}</textarea>
          <div class="field"><label>Card media${isRibbon ? '' : ' (Ribbon only; this layout shows the picture)'}</label><select data-mk>${opts(MEDIA_KINDS)}</select></div>
          <div class="mfields">${mediaFields(it, i)}</div>
          <div class="thumb" style="background-image:url('${U.image(it, i).replace(/'/g, '%27')}')">
            <label class="upload">Upload image<input type="file" accept="image/*"></label>
          </div>
          <input data-f="image" placeholder="…or paste an image URL" value="${it.image && !it.image.startsWith('data:') ? U.esc(it.image) : ''}">`;
        card.querySelector('[data-mk]').value = kind;

        const thumb = card.querySelector('.thumb');
        const setImage = (src) => { it.image = src; thumb.style.backgroundImage = `url('${U.image(it, i).replace(/'/g, '%27')}')`; changed(false); };
        card.querySelectorAll('[data-f]').forEach((f) => {
          f.oninput = () => { if (f.dataset.f === 'image') setImage(f.value.trim()); else { it[f.dataset.f] = f.value; changed(false); } };
        });
        card.querySelector('[data-mk]').onchange = (e) => {
          const k = e.target.value;
          if (k === 'image') delete it.media;
          else if (k === 'text') it.media = { kind: 'text', text: 'A short line that sums this event up', label: '' };
          else it.media = { kind: 'stat', value: 100, prefix: '', suffix: '%', label: 'of something' };
          changed(true);
        };
        card.querySelectorAll('[data-m]').forEach((f) => {
          f.oninput = () => {
            const key = f.dataset.m;
            it.media[key] = key === 'value' ? (f.value === '' ? 0 : Number(f.value)) : f.value;
            changed(false);
          };
        });
        card.querySelector('.upload input').onchange = async (e) => { const file = e.target.files[0]; if (file) setImage(await readImage(file)); };
        thumb.ondragover = (e) => { e.preventDefault(); thumb.classList.add('drag'); };
        thumb.ondragleave = () => thumb.classList.remove('drag');
        thumb.ondrop = async (e) => {
          e.preventDefault(); thumb.classList.remove('drag');
          const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'));
          if (file) setImage(await readImage(file));
        };
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
      $('.add').disabled = data.items.length >= MAX_EVENTS;
    }

    $('.add').onclick = () => {
      if (data.items.length >= MAX_EVENTS) return;
      data.items.push({ date: String(new Date().getFullYear()), title: 'New milestone', detail: 'Describe what happened here.', image: '' });
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
      a.download = 'timeline.json';
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

    // Theme picker
    document.querySelectorAll('.themes button').forEach((b) => {
      b.onclick = () => {
        const th = THEMES.find((x) => x.id === b.dataset.themeId);
        if (!th) return;
        theme = th;
        applyTheme(th);
        try { localStorage.setItem(THEME_KEY, th.id); } catch (_) { /* storage unavailable */ }
        document.querySelectorAll('.themes button').forEach((x) => x.classList.toggle('on', x === b));
        renderEditor();   // placeholder thumbnails take the new theme's colours
        rebuild();
      };
    });

    renderEditor();
    fit();
    rebuild();
    requestAnimationFrame(tick);
  }

  window.TimelineSet = { mount, U, VARIANTS, DEFAULT_DATA, PACES, MOTIONS, ORDERS, LOOKS, lookFor };
})();
