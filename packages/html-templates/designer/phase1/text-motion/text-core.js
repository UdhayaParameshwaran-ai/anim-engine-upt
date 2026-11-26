/* Text Motion — shared runtime.
 *
 * Eight VARIATIONS = eight different ways the text itself animates (pop, fade, typing, decode, masked rise,
 * tracking, flip, karaoke). Everything else is shared, so the variations differ in the thing you can see: how the
 * words arrive.
 *
 * What every variation shares:
 *   Weight   — a line is Weak (1), Medium (2) or Strong (3). Weak is a small tracked caption that sets the scene up,
 *              Medium is the statement, Strong is the point: about 7× bigger than Weak, gradient-filled, and it lands
 *              with more weight than the rest. A number in a Strong line counts up. *Asterisks* mark accent words.
 *   Narration — the speed (words per minute) sets when each word is spoken; the picture leads the voice by a hair,
 *              commas and full stops add a breath, and a beat of silence precedes a Strong line. A line can be pinned
 *              to a cue time. The motion itself gets quicker with a faster voice and softer with a slower one.
 *   Scenes   — "Start a new scene here" begins a fresh beat with a new background tint and the variation's own
 *              scene change; each scene pushes in slowly so the frame is never still.
 *   Theme    — colours, fonts and radii all come from the active theme.
 *
 * Each variant page calls  TextMotion.mount(id).  build() makes the DOM once and returns update(seconds): a pure
 * function of time, so the playhead can be scrubbed, looped or rendered frame by frame.
 */
(function () {
  'use strict';

  const F = 30;
  const W = 1920, H = 1080;
  const STORAGE_KEY = 'text-motion-data-v3';
  const MAX_LINES = 10;
  const LEAD = 0.1;                                   // the picture leads the voice by this much

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

  // ── Maths ────────────────────────────────────────────────────────────────
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  /** Fast start, slow settle (cubic-bezier .16,1,.3,1 in spirit). */
  const expoOut = (k) => (k >= 1 ? 1 : 1 - Math.pow(2, -10 * k));
  const inOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
  const quadOut = (k) => 1 - (1 - k) * (1 - k);
  /** Overshoots past 1 and settles. */
  const backOut = (k, s = 1.9) => { const c3 = s + 1; return 1 + c3 * Math.pow(k - 1, 3) + s * Math.pow(k - 1, 2); };
  /** A repeatable pseudo-random number from two integers. */
  const hash = (a, b) => { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); };

  const WORDS = [['narration', 'With the narration'], ['burst', 'Quick burst']];
  const CAPS = [['off', 'As typed'], ['on', 'CAPITALS']];
  const SCHEMES = [['auto', 'Cycle the scene tints'], ['base', 'Base'], ['tint', 'Tint'], ['deep', 'Deep']];
  const SPEEDS = [['slow', 'Slow', 120], ['normal', 'Normal', 150], ['fast', 'Fast', 190]];
  const PRIORITY = ['Weak', 'Medium', 'Strong'];
  const SIZES = [30, 92, 224];

  const VARIANTS = [
    { id: 'beats', file: 'v1-beats.html', name: 'Beats', anim: 'pop', trans: 'wipe',
      note: 'Pop: each word springs in with overshoot and a short vertical blur, on the beat of the voice. Strong words add a punch to the whole frame. Scenes change with a wipe.' },
    { id: 'fade', file: 'v2-fade.html', name: 'Fade', anim: 'fade', trans: 'fade',
      note: 'Fade: words dissolve in out of soft focus while drifting gently upward, slower for heavier lines. Calm and cinematic; scenes cross-dissolve.' },
    { id: 'typewriter', file: 'v3-typewriter.html', name: 'Typewriter', anim: 'type', trans: 'cut', chars: true,
      note: 'Typing: characters are typed one by one at the speed of the narration, each flashing the accent colour as it lands, with a caret that blinks when the voice pauses. Scenes cut.' },
    { id: 'decode', file: 'v4-decode.html', name: 'Decode', anim: 'decode', trans: 'cut', chars: true,
      note: 'Decode: each letter cycles through random glyphs before it locks onto the right character, left to right as the word is spoken, with a flash when it resolves.' },
    { id: 'rise', file: 'v5-rise.html', name: 'Rise', anim: 'rise', trans: 'slide', mask: true,
      note: 'Masked rise: words slide up from behind an invisible edge, with a slight tilt that straightens as they land. No fading, so it reads sharp and edited. Scenes slide up.' },
    { id: 'tracking', file: 'v6-tracking.html', name: 'Tracking', anim: 'track', trans: 'fade', chars: true,
      note: 'Tracking: letters start spread wide apart and blurred, then draw in together into the word. Heavier lines take longer, so the strong line feels like it is being pulled into focus.' },
    { id: 'flip', file: 'v7-flip.html', name: 'Flip', anim: 'flip', trans: 'flip',
      note: 'Flip: each word swings up on a hinge in 3D with a small overshoot. Strong words turn on their vertical axis instead. Scenes turn like a page.' },
    { id: 'karaoke', file: 'v8-karaoke.html', name: 'Karaoke', anim: 'karaoke', trans: 'fade',
      note: 'Karaoke: the whole sentence is already there, dimmed. Each word lights up exactly as it is spoken, with a soft highlight on the word being said. Good for long explanations.' },
  ];

  const DEFAULT_DATA = {
    wpm: 150, words: 'narration', caps: 'off', scheme: 'auto',
    lines: [
      { text: 'Every day your body meets new germs', p: 1 },
      { text: 'and most of them it handles *quietly*.', p: 2 },
      { text: 'A vaccine teaches it the shape of a threat', p: 1, cut: true },
      { text: '95%', p: 3 },
      { text: 'protection from severe illness', p: 1 },
      { text: 'So when the real one arrives', p: 1, cut: true },
      { text: "you're *ready*.", p: 3 },
    ],
  };

  // ── Timing: narration → seconds ─────────────────────────────────────────
  /** "*ready*." → { t: 'ready.', acc: true } (asterisks mark accent words, also across several words). */
  function parseWords(text) {
    let on = false;
    return String(text || '').trim().split(/\s+/).filter(Boolean).map((tok) => {
      const m = /^(\*)?(.*?)(\*)?([.,;:!?]*)$/.exec(tok);
      const start = !!m[1], end = !!m[3];
      if (start) on = true;
      const out = { t: (m[2] + m[4]) || tok.replace(/\*/g, ''), acc: on };
      if (end) on = false;
      return out;
    });
  }
  /** When each line starts and each word is spoken. */
  function plan(data) {
    const wps = clamp(data.wpm, 60, 300) / 60;
    let cursor = 0.8;
    const lines = [];
    data.lines.slice(0, MAX_LINES).forEach((ln) => {
      const words = parseWords(ln.text);
      if (!words.length) return;
      const p = ln.p === 1 || ln.p === 3 ? ln.p : 2;
      const first = lines.length === 0;
      const cut = !first && !!ln.cut;
      const cue = ln.at !== undefined && ln.at !== '' && ln.at !== null && !isNaN(Number(ln.at)) ? Number(ln.at) : null;
      const s = cue !== null ? cue : cursor + (first ? 0 : 0.26 + (p === 3 ? 0.3 : 0) + (cut ? 0.7 : 0));   // a beat of silence before a key line, more for a new scene
      let t = s;
      const wt = words.map((w) => {
        const at = t;
        t += 1 / wps + (/[,;:]$/.test(w.t) ? 0.14 : /[.!?]$/.test(w.t) ? 0.22 : 0);
        return at;
      });
      cursor = Math.max(cursor, t);
      const m = p === 3 && words.length === 1 ? /^([^\d]*)(\d[\d,]*\.?\d*)(\D*)$/.exec(words[0].t) : null;
      const stat = m ? { pre: m[1], to: parseFloat(m[2].replace(/,/g, '')), dec: (m[2].split('.')[1] || '').length, comma: m[2].includes(','), suf: m[3] } : null;
      lines.push({ i: lines.length, p, words, s, e: t, wt, cut, stat });
    });
    const last = lines.length ? lines[lines.length - 1].e : 1;
    return { lines, duration: last + 2.2, wps };
  }

  // ── Directional motion blur (SVG filters, one per element that needs it) ─
  function makeBlur(stage) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
    svg.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none';
    const defs = document.createElementNS(ns, 'defs');
    svg.append(defs);
    stage.append(svg);
    let n = 0;
    return function make() {
      const id = `mb${Math.random().toString(36).slice(2, 8)}${n++}`;
      const f = document.createElementNS(ns, 'filter');
      f.setAttribute('id', id);
      f.setAttribute('x', '-40%'); f.setAttribute('y', '-70%'); f.setAttribute('width', '180%'); f.setAttribute('height', '240%');
      f.setAttribute('color-interpolation-filters', 'sRGB');
      const g = document.createElementNS(ns, 'feGaussianBlur');
      g.setAttribute('stdDeviation', '0 0');
      f.append(g); defs.append(f);
      let last = '';
      return (target, bx, by) => {
        if (bx < 0.4 && by < 0.4) { if (last) { target.style.filter = ''; last = ''; } return; }
        const v = `${bx.toFixed(1)} ${by.toFixed(1)}`;
        if (v !== last) { g.setAttribute('stdDeviation', v); last = v; }
        if (!target.style.filter) target.style.filter = `url(#${id})`;
      };
    };
  }

  const fmtNum = (n, stat) => {
    const s = n.toFixed(stat.dec);
    return stat.comma ? Number(s).toLocaleString('en-US', { minimumFractionDigits: stat.dec, maximumFractionDigits: stat.dec }) : s;
  };
  const GLYPHS = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&@$+=<>?/';

  // ── Scene engine ────────────────────────────────────────────────────────
  function buildScenes(stage, data, V, PL) {
    const speedK = clamp(150 / data.wpm, 0.6, 1.4);                    // faster voice → quicker motion
    stage.classList.toggle('caps', data.caps === 'on');
    SIZES.forEach((s, i) => stage.style.setProperty(`--s${i + 1}`, `${s}px`));
    const mkBlur = makeBlur(stage);
    const chars = !!V.chars;

    const groups = [];
    PL.lines.forEach((L) => { if (!groups.length || L.cut) groups.push([]); groups[groups.length - 1].push(L); });
    const lastE = PL.lines[PL.lines.length - 1].e;

    const makeLine = (L, host) => {
      const ln = el('div', `ln p${L.p}`);
      const useChars = chars && !L.stat;
      if (L.stat) {
        ln.innerHTML = `<span class="w"><span class="wi stat"><span class="pre">${esc(L.stat.pre)}</span><span class="num">${esc(fmtNum(L.stat.to, L.stat))}</span><span class="unit">${esc(L.stat.suf)}</span></span></span>`;
      } else {
        ln.innerHTML = L.words.map((w) => `<span class="w${V.mask ? ' mask' : ''}"><span class="wi${w.acc ? ' acc' : ''}">${useChars ? Array.from(w.t).map((c) => `<span class="ch">${esc(c)}</span>`).join('') : esc(w.t)}</span></span>`).join(' ');
      }
      host.append(ln);
      const wis = [...ln.querySelectorAll('.wi')];
      const chs = wis.map((wi) => [...wi.querySelectorAll('.ch')]);
      const caret = V.anim === 'type' ? el('span', 'caret', '<i></i>') : null;
      const hls = V.anim === 'karaoke' && !L.stat ? wis.map((wi) => { const h = el('i', 'hl'); wi.parentElement.prepend(h); return h; }) : [];
      return { L, el: ln, wis, chs, blurs: wis.map(() => (L.p === 1 ? null : mkBlur())), num: ln.querySelector('.num'), caret, hls, lastCh: null, lastT: -1 };
    };

    const SCHEME_CYCLE = ['base', 'tint', 'deep'];
    const DIRS = ['up', 'left', 'down', 'right'];
    const scenes = groups.map((g, si) => {
      const scheme = data.scheme !== 'auto' ? data.scheme : SCHEME_CYCLE[si % 3];
      const sc = el('div', `sc sc-${scheme}`);
      sc.style.zIndex = String(si + 1);
      const bg = el('div', 'sc-bg');
      const inn = el('div', 'sc-in');
      const bar = el('i', 'sc-bar');
      sc.append(bg, inn, bar);
      stage.append(sc);
      const col = el('div', 'sc-col');
      inn.append(col);
      const lines = g.map((L) => makeLine(L, col));
      return { si, g, sc, bg, inn, bar, col, lines, dir: DIRS[(si - 1 + 8) % 4], t0: si === 0 ? 0 : Math.max(0, g[0].s - 1.0), blurOut: mkBlur() };
    });
    scenes.forEach((s, i) => { s.t1 = i + 1 < scenes.length ? scenes[i + 1].t0 : Infinity; });

    // Fit the strong line to the frame and fix character widths for the decode.
    let measured = false;
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { measured = false; });
    const fitAll = () => {
      scenes.forEach((s) => {
        s.lines.forEach((ln) => {
          if (ln.L.p === 3) {
            ln.el.style.fontSize = '';
            ln.el.style.whiteSpace = 'nowrap';
            const w = ln.el.scrollWidth;
            ln.el.style.whiteSpace = '';
            if (w > 1680) ln.el.style.fontSize = `calc(var(--s3) * ${Math.max(0.42, 1680 / w).toFixed(3)})`;
          }
          ln.chs.forEach((arr) => arr.forEach((ch) => { ch._w = ch.offsetWidth; }));
        });
      });
      measured = true;
    };

    const dur = (p, kind) => {
      const base = kind === 'fade' ? [0.7, 1.0, 1.5] : kind === 'track' ? [0.5, 0.75, 1.05] : kind === 'rise' ? [0.45, 0.55, 0.8] : kind === 'flip' ? [0.4, 0.5, 0.75] : [0.4, 0.46, 0.66];
      return base[p - 1] * speedK;
    };

    /** Animate one word at time t. Strong numbers always count up. */
    const animWord = (ln, j, t) => {
      const L = ln.L, P = L.p, wi = ln.wis[j], blur = ln.blurs[j];
      const ws = data.words === 'burst' ? L.s - LEAD + j * 0.05 : L.wt[j] - LEAD;
      const wEnd = j + 1 < L.words.length ? L.wt[j + 1] - LEAD : L.e - LEAD;
      const kind = L.stat ? 'pop' : V.anim;

      if (kind === 'pop') {
        const k = clamp((t - ws) / dur(P, 'pop'));
        if (k <= 0) { wi.style.opacity = '0'; if (blur) blur(wi, 0, 0); return; }
        const e = expoOut(k);
        let y, s, o, by = 0;
        if (P === 1) { y = (1 - e) * 14; s = 1; o = clamp(k * 4); }
        else if (P === 2) { const b = backOut(k, 1.7); y = (1 - e) * 44; s = 0.72 + 0.28 * b; o = clamp(k * 5); by = (1 - e) * 14; }
        else { const b = backOut(k, 2.5); y = (1 - e) * 90; s = 0.5 + 0.5 * b; o = clamp(k * 7); by = (1 - e) * 30; }
        if (L.stat) {
          const from = Math.round(L.stat.to * 0.46);
          const c = expoOut(clamp((t - ws) / (0.95 * speedK)));
          ln.num.textContent = fmtNum(from + (L.stat.to - from) * c, L.stat);
          by = Math.max(by, (1 - c) * 26);
          s *= 1 + (1 - c) * 0.05;
        }
        wi.style.opacity = o.toFixed(3);
        wi.style.transform = `translateY(${y.toFixed(1)}px) scale(${s.toFixed(4)})`;
        if (blur) blur(wi, 0, by);
        return;
      }

      if (kind === 'fade') {
        const k = clamp((t - ws) / dur(P, 'fade'));
        const e = quadOut(k);
        wi.style.opacity = e.toFixed(3);
        wi.style.transform = `translateY(${((1 - e) * (P === 3 ? 28 : P === 2 ? 16 : 8)).toFixed(1)}px) scale(${(0.97 + 0.03 * e).toFixed(4)})`;
        const b = (1 - e) * (P === 3 ? 18 : P === 2 ? 10 : 5);
        wi.style.filter = b > 0.3 ? `blur(${b.toFixed(1)}px)` : '';
        return;
      }

      if (kind === 'rise') {
        const k = clamp((t - ws) / dur(P, 'rise'));
        const e = expoOut(k);
        wi.style.opacity = k > 0 ? '1' : '0';
        wi.style.transformOrigin = '0 100%';
        wi.style.transform = `translateY(${((1 - e) * 112).toFixed(1)}%) rotate(${((1 - e) * (P === 3 ? 4 : 7)).toFixed(2)}deg)`;
        if (blur) blur(wi, 0, (1 - e) * (P === 3 ? 14 : 8));
        return;
      }

      if (kind === 'flip') {
        const k = clamp((t - ws) / dur(P, 'flip'));
        const b = backOut(k, P === 3 ? 2.0 : 1.5);
        wi.style.opacity = clamp(k * 5).toFixed(3);
        if (P === 3) { wi.style.transformOrigin = '50% 50%'; wi.style.transform = `rotateY(${((1 - b) * -95).toFixed(2)}deg)`; }
        else { wi.style.transformOrigin = '50% 100%'; wi.style.transform = `rotateX(${((1 - b) * -95).toFixed(2)}deg)`; }
        return;
      }

      if (kind === 'track') {
        const k = clamp((t - ws) / dur(P, 'track'));
        const e = expoOut(k);
        const chs = ln.chs[j], n = chs.length;
        chs.forEach((ch, c) => {
          const rel = (c - (n - 1) / 2) / Math.max(1, n);
          ch.style.transform = `translateX(${((1 - e) * rel * (P === 3 ? 2.6 : 1.9)).toFixed(3)}em)`;
        });
        wi.style.opacity = clamp(k * 3).toFixed(3);
        const b = (1 - e) * (P === 3 ? 12 : 7);
        wi.style.filter = b > 0.3 ? `blur(${b.toFixed(1)}px)` : '';
        return;
      }

      if (kind === 'type') {
        if (j !== 0) return;                                            // the whole line is typed as one continuous stream
        if (!ln.tm) {
          // Where a key is missed: a wrong letter, a short pause, a backspace, then the right letter. It is decided by the
          // line's text alone, so it plays the same way every time.
          let typo = null;
          const cand = L.words.map((w, k) => (w.t.replace(/[^A-Za-z]/g, '').length >= 4 && !w.acc ? k : -1)).filter((k) => k >= 0);
          if (L.p !== 3 && cand.length && hash(L.i * 7 + 1, 5) < 0.75) {
            const tj = cand[Math.floor(hash(L.i * 13 + 2, 8) * cand.length)];
            const arr = Array.from(L.words[tj].t);
            const tc = 1 + Math.floor(hash(L.i * 5 + tj, 4) * Math.max(1, arr.length - 2));
            const real = arr[tc] || '', lower = real.toLowerCase();
            let wrong = '';
            ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'].forEach((r) => { const k = r.indexOf(lower); if (k >= 0) wrong = r[k + 1] || r[k - 1]; });
            if (/[A-Za-z]/.test(real) && wrong) typo = { j: tj, c: tc, wrong: real === lower ? wrong : wrong.toUpperCase() };
          }
          const steps = [];
          ln.chs.forEach((chs, wj) => {
            chs.forEach((ch, c) => {
              const w = 0.82 + 0.36 * hash(L.i * 53 + wj * 11 + c, 3);
              const real = ch.dataset.c || (ch.dataset.c = ch.textContent);
              if (typo && typo.j === wj && typo.c === c) steps.push({ wj, c, k: 'wrong', w }, { wj, c, k: 'wait', w: 3.0 }, { wj, c, k: 'back', w: 1.2 }, { wj, c, k: 'right', w });
              else steps.push({ wj, c, k: 'type', w: w + (/[,;:]/.test(real) ? 0 : 0) });
              if (c === chs.length - 1 && /[,;:]$/.test(real)) steps.push({ k: 'rest', w: 2.5 });
              else if (c === chs.length - 1 && /[.!?]$/.test(real)) steps.push({ k: 'rest', w: 3.5 });
            });
            if (wj < ln.chs.length - 1) steps.push({ k: 'space', w: 1.1 });          // the space bar
          });
          const total = steps.reduce((x, st) => x + st.w, 0);
          const t0 = L.s - LEAD, span = Math.max(0.3, (L.e - L.s) * 0.94);
          let acc = 0;
          ln.tm = {};
          steps.forEach((st) => { st.t = t0 + span * (acc / total); acc += st.w; if (st.wj !== undefined) ln.tm[st.wj + ':' + st.c + ':' + st.k] = st.t; });
          ln.typo = typo;
        }
        ln.chs.forEach((chs, wj) => chs.forEach((ch, c) => {
          const real = ch.dataset.c || (ch.dataset.c = ch.textContent);
          const typo = ln.typo && ln.typo.j === wj && ln.typo.c === c;
          const key = wj + ':' + c + ':';
          const tFirst = typo ? ln.tm[key + 'wrong'] : ln.tm[key + 'type'];
          if (t < tFirst) { ch.style.opacity = '0'; return; }
          ch.style.transform = ''; ch.style.color = ''; ch.style.webkitTextFillColor = '';
          if (typo && t < ln.tm[key + 'back']) {
            ch.textContent = ln.typo.wrong; ch.style.opacity = '1';
            ln.lastCh = ch; ln.lastT = Math.max(ln.lastT, tFirst);
          } else if (typo && t < ln.tm[key + 'right']) {
            ch.style.opacity = '0';                                       // the backspace: the wrong letter is gone
            ln.lastT = Math.max(ln.lastT, ln.tm[key + 'back']);
          } else {
            ch.textContent = real; ch.style.opacity = '1';
            ln.lastCh = ch; ln.lastT = Math.max(ln.lastT, typo ? ln.tm[key + 'right'] : tFirst);
          }
        }));
        return;
      }

      if (kind === 'decode') {
        const chs = ln.chs[j], n = chs.length;
        const span = Math.max(0.12, wEnd - ws);
        const step = Math.min(0.08, span / (n + 0.6));
        const lead = 0.32 * speedK;
        chs.forEach((ch, c) => {
          const real = ch.dataset.c || (ch.dataset.c = ch.textContent);
          const at = ws + c * step;
          const age = t - at;
          if (/[^A-Za-z0-9]/.test(real)) { ch.style.opacity = age >= -0.05 ? '1' : '0'; return; }
          if (age < -lead) { ch.style.opacity = '0'; ch.style.width = ''; return; }
          if (age < 0) {
            ch.textContent = GLYPHS[Math.floor(hash(ln.L.i * 31 + j * 7 + c, Math.floor(t * 22)) * GLYPHS.length)];
            ch.style.opacity = '0.85'; ch.style.width = `${ch._w || 0}px`; ch.style.textAlign = 'center';
            ch.style.color = 'var(--acc)'; ch.style.webkitTextFillColor = 'var(--acc)';
            ch.style.transform = '';
            return;
          }
          ch.textContent = real; ch.style.width = ''; ch.style.opacity = '1';
          const f = clamp(age / 0.2);
          ch.style.color = f < 1 ? 'var(--acc)' : ''; ch.style.webkitTextFillColor = f < 1 ? 'var(--acc)' : '';
          ch.style.transform = `scale(${(1 + 0.18 * (1 - f)).toFixed(3)})`;
        });
        return;
      }

      if (kind === 'karaoke') {
        const nt = j + 1 < L.words.length ? L.wt[j + 1] : L.e;
        const lit = clamp((t - L.wt[j] + 0.04) / 0.16);
        const dur = Math.max(0.14, nt - L.wt[j]);
        const sweep = clamp((t - L.wt[j] + 0.04) / dur);                    // the fill runs the full width of the word while it is spoken
        const done = clamp((t - nt) / 0.35);
        const cur = clamp((t - L.wt[j] + 0.04) / 0.08) * (1 - done);
        wi.style.opacity = (0.24 + 0.76 * lit).toFixed(3);
        wi.style.transform = `scale(${(1 + (P === 3 ? 0.03 : 0.045) * cur).toFixed(4)})`;
        const h = ln.hls[j];
        if (h) {
          h.style.opacity = (t >= L.wt[j] - 0.04 ? 1 - done : 0).toFixed(3);
          h.style.transform = `scaleX(${expoOut(sweep).toFixed(4)})`;
        }
        return;
      }
    };

    return function update(t) {
      if (!measured) fitAll();
      const out = inOut(clamp((t - (lastE + 0.5)) / 0.8));

      scenes.forEach((S, si) => {
        const vis = t >= S.t0 && t < S.t1 + 0.7;
        S.sc.style.visibility = vis ? 'visible' : 'hidden';
        if (!vis) return;

        // ── scene change ──
        const trans = si === 0 && V.trans !== 'wipe' ? 'fade' : V.trans;
        const e = trans === 'cut' ? 1 : expoOut(clamp((t - S.t0) / (trans === 'fade' ? 0.7 : 0.55)));
        const dir = si === 0 ? 'up' : S.dir, rev = 1 - e;
        S.sc.style.opacity = trans === 'fade' ? e.toFixed(3) : trans === 'flip' ? clamp(e * 2).toFixed(3) : '1';
        S.sc.style.clipPath = trans === 'wipe' && e < 1
          ? (dir === 'up' ? `inset(${rev * 100}% 0 0 0)` : dir === 'down' ? `inset(0 0 ${rev * 100}% 0)` : dir === 'left' ? `inset(0 ${rev * 100}% 0 0)` : `inset(0 0 0 ${rev * 100}%)`)
          : 'none';
        S.sc.style.transform = trans === 'slide' ? `translateY(${(rev * 100).toFixed(2)}%)` : trans === 'flip' ? `perspective(1800px) rotateY(${(rev * -78).toFixed(2)}deg)` : 'none';
        if (trans === 'wipe') {
          const on = e > 0.01 && e < 0.995;
          S.bar.style.opacity = on ? '1' : '0';
          const bw = 16, st = S.bar.style;
          st.left = st.right = st.top = st.bottom = st.width = st.height = 'auto';
          if (dir === 'up') { st.left = '0'; st.right = '0'; st.height = bw + 'px'; st.top = 'calc(' + rev * 100 + '% - 2px)'; }
          else if (dir === 'down') { st.left = '0'; st.right = '0'; st.height = bw + 'px'; st.top = 'calc(' + e * 100 + '% - ' + (bw - 2) + 'px)'; }
          else if (dir === 'left') { st.top = '0'; st.bottom = '0'; st.width = bw + 'px'; st.left = 'calc(' + e * 100 + '% - ' + (bw - 2) + 'px)'; }
          else { st.top = '0'; st.bottom = '0'; st.width = bw + 'px'; st.left = 'calc(' + rev * 100 + '% - 2px)'; }
        } else S.bar.style.opacity = '0';

        // ── camera: slow push-in; a punch on strong words (Beats); the scene leaves in its own way ──
        const age = clamp((t - S.t0) / Math.max(2, S.g[S.g.length - 1].e - S.t0 + 1));
        let punch = 0;
        if (V.anim === 'pop') S.g.forEach((L) => { if (L.p === 3 && t >= L.s - LEAD) punch = Math.max(punch, (1 - expoOut(clamp((t - (L.s - LEAD)) / 0.4))) * 0.032); });
        const nxt = scenes[si + 1];
        const ek = nxt ? clamp((t - nxt.t0 + 0.06) / 0.45) : 0;
        let ox = 0, oy = 0, bx = 0, by = 0, rot = '', op = 1;
        if (ek > 0) {
          if (trans === 'wipe') {
            const d = expoOut(ek) * 220, m = nxt.dir;
            if (m === 'up') { oy = -d; by = ek * 34; } else if (m === 'down') { oy = d; by = ek * 34; } else if (m === 'left') { ox = d; bx = ek * 40; } else { ox = -d; bx = ek * 40; }
            op = 1 - ek * 0.7;
          } else if (trans === 'fade') op = 1 - ek;
          else if (trans === 'slide') { oy = -expoOut(ek) * 110; op = 1 - ek * 0.6; }
          else if (trans === 'flip') { rot = ` perspective(1800px) rotateY(${(ek * 60).toFixed(1)}deg)`; op = 1 - ek * 0.8; }
          else op = 1;
        }
        S.inn.style.transform = `translate(${ox.toFixed(1)}px, ${oy.toFixed(1)}px) scale(${(1 + 0.05 * age + punch).toFixed(4)})${rot}`;
        S.inn.style.opacity = op.toFixed(3);
        S.blurOut(S.inn, bx, by);

        // ── lines ──
        S.lines.forEach((ln, i) => {
          const L = ln.L;
          const nl = S.g[i + 1];
          let dim = 1;
          if (nl && V.anim !== 'karaoke') {
            const k = inOut(clamp((t - (nl.s - 0.1)) / 0.6));
            dim = 1 - (L.p === 1 ? 0.2 : 0.12) * k * (1 - out);
          }
          ln.lastCh = null; ln.lastT = -1;
          ln.wis.forEach((wi, j) => animWord(ln, j, t));
          if (V.anim === 'karaoke') {                       // the line itself arrives softly, words light up inside it
            const k = expoOut(clamp((t - (L.s - 0.45)) / (0.6 * speedK)));
            ln.el.style.transform = `translateY(${((1 - k) * 28).toFixed(1)}px)`;
            ln.el.style.filter = k < 0.98 ? `blur(${((1 - k) * 6).toFixed(1)}px)` : '';
            ln.el.style.opacity = (k * dim).toFixed(3);
          } else {
            ln.el.style.opacity = dim.toFixed(3);

          }
          if (ln.caret) {                                    // the typing caret: solid while typing, blinking in the pauses
            const active = t >= L.s - LEAD && t <= L.e + 1.0;
            if (!active) { if (ln.caret.parentNode) ln.caret.remove(); }
            else {
              const at = ln.lastCh;
              if (at) { if (at.nextSibling !== ln.caret) at.after(ln.caret); }
              else if (ln.el.firstChild !== ln.caret) ln.el.prepend(ln.caret);
              const typing = at && t - ln.lastT < 0.35;
              ln.caret.style.opacity = typing || Math.floor(t * 2.4) % 2 === 0 ? '1' : '0';
            }
          }
        });
      });
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) { const d = JSON.parse(raw); if (d && Array.isArray(d.lines)) return Object.assign({}, DEFAULT_DATA, d); }
    } catch (_) { /* storage unavailable — fall back to defaults */ }
    return structuredClone(DEFAULT_DATA);
  }
  function save(data) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (_) { /* quota / private mode */ }
  }

  // ── Mount ────────────────────────────────────────────────────────────────
  function mount(variantId) {
    const variant = VARIANTS.find((v) => v.id === variantId) || VARIANTS[0];
    const params = new URLSearchParams(location.search);
    const embed = params.has('embed');
    if (embed) document.body.classList.add('embed');
    let theme = pickTheme(params);
    applyTheme(theme);

    let data = load();
    const wpmQ = Number(params.get('wpm'));
    if (wpmQ >= 60 && wpmQ <= 300) data.wpm = wpmQ;
    if (WORDS.some((w) => w[0] === params.get('words'))) data.words = params.get('words');
    if (CAPS.some((w) => w[0] === params.get('caps'))) data.caps = params.get('caps');
    if (SCHEMES.some((w) => w[0] === params.get('scheme'))) data.scheme = params.get('scheme');
    let t = Number(params.get('t')) || 0;
    let playing = !params.has('paused');
    let duration = 1;
    let update = () => {};
    let PL = plan(data);

    const icons = {
      play: '<svg viewBox="0 0 16 16"><path d="M4 2.5v11l9-5.5z"/></svg>',
      pause: '<svg viewBox="0 0 16 16"><path d="M3.5 2h3v12h-3zM9.5 2h3v12h-3z"/></svg>',
      replay: '<svg viewBox="0 0 16 16"><path d="M8 3V0L4 4l4 4V5a4 4 0 1 1-4 4H2a6 6 0 1 0 6-6z"/></svg>',
    };
    const opts = (list) => list.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');

    document.body.insertAdjacentHTML('afterbegin', `
      <header class="app-bar">
        <a class="back" href="index.html">← All variants</a>
        <h1>Text Motion · ${esc(variant.name)}</h1>
        <nav class="variants">${VARIANTS.map((v) => `<a href="${v.file}" class="${v.id === variant.id ? 'on' : ''}">${v.name}</a>`).join('')}</nav>
        <nav class="themes" aria-label="Theme">${THEMES.map((th) => `<button data-theme-id="${th.id}" class="${th.id === theme.id ? 'on' : ''}" title="${esc(th.label)}"><i style="background:linear-gradient(135deg, ${th.swatch[1]} 50%, ${th.swatch[0]} 50%)"></i>${esc(th.label)}</button>`).join('')}</nav>
      </header>
      <main class="app">
        <section class="preview">
          <div class="viewport"><div class="stage"></div></div>
          <div class="voice" aria-label="Narration timeline"><div class="voice-bars"></div><b class="voice-head"></b></div>
          <div class="controls">
            <button class="play" aria-label="Play or pause">${icons.pause}</button>
            <button class="replay" aria-label="Replay from start">${icons.replay}</button>
            <input class="scrub" type="range" min="0" max="1000" value="0" aria-label="Playhead">
            <span class="time">0.0s / 0.0s</span>
          </div>
          <p class="hint">${esc(variant.note)} Space = play/pause · ←/→ = step 1 frame (Shift = 10) · The strip above the controls is the narration: taller bars are stronger lines.</p>
        </section>
        <aside class="editor noimg">
          <h2>Narration</h2>
          <div class="field"><label>Speed · <span class="wpm-label"></span></label>
            <input class="wpm" type="range" min="90" max="220" step="5">
            <div class="seg" role="group" aria-label="Speed">${SPEEDS.map(([id, l, w]) => `<button data-speed="${w}">${l}</button>`).join('')}</div>
          </div>
          <div class="duo">
            <div class="field"><label>Words appear</label><select data-o="words">${opts(WORDS)}</select></div>
            <div class="field"><label>Letters</label><select data-o="caps">${opts(CAPS)}</select></div>
          </div>
          <div class="field"><label>Scene tints</label><select data-o="scheme">${opts(SCHEMES)}</select></div>
          <h2>Lines <span class="cap">(up to ${MAX_LINES}; weight sets size and motion; *word* = accent colour)</span></h2>
          <div class="items"></div>
          <div class="row">
            <button class="btn primary add">+ Add line</button>
            <button class="btn export">Export JSON</button>
            <label class="btn">Import<input class="import" type="file" accept="application/json" hidden></label>
            <button class="btn reset">Reset</button>
          </div>
        </aside>
      </main>`);

    const $ = (s) => document.querySelector(s);
    const viewport = $('.viewport'), stage = $('.stage'), scrub = $('.scrub'), timeEl = $('.time'), playBtn = $('.play');
    const voiceBars = $('.voice-bars'), voiceHead = $('.voice-head');

    const fit = () => {
      const r = viewport.getBoundingClientRect();
      const s = Math.min(r.width / W, r.height / H);
      stage.style.transform = `translate(${(r.width - W * s) / 2}px, ${(r.height - H * s) / 2}px) scale(${s})`;
      viewport.style.setProperty('--s', s.toFixed(4));
    };
    new ResizeObserver(fit).observe(viewport);

    function rebuild() {
      stage.innerHTML = '';
      PL = plan(data);
      duration = PL.duration;
      if (PL.lines.length) update = buildScenes(stage, data, variant, PL);
      else { stage.innerHTML = '<div style="position:absolute;inset:0;display:grid;place-items:center;color:var(--text);font-size:40px">Add a line to start</div>'; update = () => {}; }
      voiceBars.innerHTML = PL.lines.map((L) => `<i class="p${L.p}${L.cut ? ' cut' : ''}" style="left:${(L.s / duration) * 100}%;width:${Math.max(0.6, ((L.e - L.s) / duration) * 100)}%"></i>`).join('');
      t = Math.min(t, duration);
      document.querySelectorAll('.seg [data-speed]').forEach((b) => b.classList.toggle('on', Number(b.dataset.speed) === data.wpm));
      $('.wpm').value = data.wpm;
      $('.wpm-label').textContent = `${data.wpm} words per minute · ${(data.wpm / 60).toFixed(1)} words a second`;
      document.querySelectorAll('select[data-o]').forEach((s) => { s.value = data[s.dataset.o]; });
      render();
    }
    function render() {
      update(t);
      scrub.value = String(Math.round((t / duration) * 1000));
      voiceHead.style.left = `${(t / duration) * 100}%`;
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

    const itemsEl = $('.items');
    function renderEditor() {
      itemsEl.innerHTML = data.lines.map((ln, i) => `
        <div class="item" data-i="${i}">
          <div class="item-head">
            <span class="num">Line ${i + 1}</span>
            <div class="seg pri" role="group" aria-label="Weight">${[1, 2, 3].map((p) => `<button data-p="${p}" class="${(ln.p || 2) === p ? 'on' : ''}">${PRIORITY[p - 1]}</button>`).join('')}</div>
            <div class="tools">
              <button data-act="up" ${i === 0 ? 'disabled' : ''} title="Move up">↑</button>
              <button data-act="down" ${i === data.lines.length - 1 ? 'disabled' : ''} title="Move down">↓</button>
              <button data-act="del" ${data.lines.length <= 1 ? 'disabled' : ''} title="Remove">✕</button>
            </div>
          </div>
          <div class="field"><textarea rows="2" data-f="text">${esc(ln.text)}</textarea></div>
          <label class="chk"><input type="checkbox" data-f="cut" ${ln.cut ? 'checked' : ''} ${i === 0 ? 'disabled' : ''}> Start a new scene here</label>
          <div class="field"><label>Cue (seconds) · optional: pin this line to the voice-over</label><input type="number" min="0" step="0.1" data-f="at" value="${ln.at ?? ''}" placeholder="auto"></div>
        </div>`).join('');
      $('.add').disabled = data.lines.length >= MAX_LINES;
    }
    itemsEl.addEventListener('input', (e) => {
      const it = e.target.closest('.item'); if (!it) return;
      const ln = data.lines[Number(it.dataset.i)];
      const f = e.target.dataset.f;
      if (f === 'text') ln.text = e.target.value;
      if (f === 'at') { if (e.target.value === '') delete ln.at; else ln.at = Number(e.target.value); }
      if (f === 'cut') ln.cut = e.target.checked;
      changed(false);
    });
    itemsEl.addEventListener('click', (e) => {
      const it = e.target.closest('.item'); if (!it) return;
      const i = Number(it.dataset.i);
      const pb = e.target.closest('[data-p]');
      if (pb) { data.lines[i].p = Number(pb.dataset.p); changed(true); return; }
      const act = e.target.closest('[data-act]');
      if (!act) return;
      if (act.dataset.act === 'del') data.lines.splice(i, 1);
      if (act.dataset.act === 'up' && i > 0) [data.lines[i - 1], data.lines[i]] = [data.lines[i], data.lines[i - 1]];
      if (act.dataset.act === 'down' && i < data.lines.length - 1) [data.lines[i + 1], data.lines[i]] = [data.lines[i], data.lines[i + 1]];
      changed(true);
    });
    $('.add').onclick = () => { if (data.lines.length < MAX_LINES) { data.lines.push({ text: 'A new line of narration.', p: 2 }); changed(true); } };
    $('.reset').onclick = () => { data = structuredClone(DEFAULT_DATA); changed(true); };
    $('.wpm').oninput = (e) => { data.wpm = Number(e.target.value); changed(false); };
    document.querySelectorAll('.seg [data-speed]').forEach((b) => { b.onclick = () => { data.wpm = Number(b.dataset.speed); changed(false); }; });
    document.querySelectorAll('select[data-o]').forEach((s) => { s.onchange = () => { data[s.dataset.o] = s.value; changed(false); }; });
    $('.export').onclick = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      a.download = 'text-motion.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    $('.import').onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const d = JSON.parse(await file.text());
        if (!Array.isArray(d.lines)) throw new Error('missing lines');
        data = Object.assign({}, DEFAULT_DATA, d);
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

  window.TextMotion = { mount, plan, VARIANTS, DEFAULT_DATA };
})();
