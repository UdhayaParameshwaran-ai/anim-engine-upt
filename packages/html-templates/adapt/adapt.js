/* Adaptive overlay for the designer's templates.
 *
 * The designer's pages size their text for short, hand-written copy. Ours is written by a model, so a title can be
 * twice as long as the card it sits in. This file makes any text that overflows its box shrink to fit, and clamp with an
 * ellipsis only when shrinking is not enough. It never edits the designer's files: load it before the page's own
 * scripts and it re-fits the stage whenever the page builds it (and again when the web fonts arrive).
 *
 *   window.AdaptFit.fit(stage)   fit one stage now (returns { fitted, clamped })
 *   window.AdaptFit.report       what the last pass did
 *
 * Measuring is done with every inline transform cleared, so the numbers are the settled layout and not a frame in the
 * middle of an animation. The transforms are put back before the function returns.
 */
(function () {
  'use strict';
  const MIN_SCALE = 0.5;        // text never shrinks below half its designed size
  const STEP = 0.94;
  const TOL = 1.5;              // px of slack before we call it overflow
  const BLOCK = '[class*="tx-"], .fx-w, .fx-m';

  const isClip = (cs) => /(hidden|clip)/.test(cs.overflow + cs.overflowX + cs.overflowY);

  /** Every element in the stage that has text of its own to place. */
  const textBlocks = (root) => {
    const set = new Set();
    root.querySelectorAll('[class*="tx-"]').forEach((e) => set.add(e));
    return [...set];
  };

  /** The box of all text inside `host`, from range rects (layout only; transforms are cleared by the caller). */
  const textExtent = (host) => {
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    for (let n; (n = walker.nextNode()); ) {
      if (!n.textContent.trim()) continue;
      const rg = document.createRange(); rg.selectNodeContents(n);
      for (const q of rg.getClientRects()) { if (q.width < 1 || q.height < 1) continue; l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom); }
    }
    return r < l ? null : { l, t, r, b };
  };

  const overflows = (host) => {
    const hb = host.getBoundingClientRect(), x = textExtent(host);
    if (!x) return false;
    const cs = getComputedStyle(host);
    const bl = parseFloat(cs.borderLeftWidth) || 0, bt = parseFloat(cs.borderTopWidth) || 0;
    const L = hb.left + bl, T = hb.top + bt, R = L + host.clientWidth, B = T + host.clientHeight;
    return x.l < L - TOL || x.t < T - TOL || x.r > R + TOL || x.b > B + TOL;
  };

  const withoutTransforms = (root, fn) => {
    const saved = [];
    root.querySelectorAll('*').forEach((e) => { if (e.style.transform) { saved.push([e, e.style.transform]); e.style.transform = 'none'; } });
    if (root.style.transform) { saved.push([root, root.style.transform]); root.style.transform = 'none'; }
    try { return fn(); } finally { saved.forEach(([e, v]) => { e.style.transform = v; }); }
  };

  /** Lines that fit in `host` for the text block `blk` (>= 1). */
  const linesFor = (host, blk) => {
    const lh = parseFloat(getComputedStyle(blk).lineHeight) || parseFloat(getComputedStyle(blk).fontSize) * 1.2;
    const space = host.clientHeight - (parseFloat(getComputedStyle(host).paddingTop) || 0) - (parseFloat(getComputedStyle(host).paddingBottom) || 0);
    return Math.max(1, Math.floor(space / lh));
  };

  function fit(stage) {
    const report = { fitted: 0, clamped: 0, hosts: [] };
    stage.querySelectorAll('[data-adapt]').forEach((e) => { e.style.fontSize = ''; e.style.webkitLineClamp = ''; e.style.display = e.dataset.adaptDisplay ?? ''; e.removeAttribute('data-adapt'); e.removeAttribute('data-adapt-display'); });
    withoutTransforms(stage, () => {
      const hosts = [...stage.querySelectorAll('*')].filter((e) => e !== stage && isClip(getComputedStyle(e)) && !e.classList.contains('fx-m') && !e.classList.contains('fx-w') && e.getBoundingClientRect().width > 8 && textExtent(e));
      // Outer boxes first: shrinking the text of a card also fixes the rows nested in it.
      hosts.sort((a, b) => (a.contains(b) ? -1 : b.contains(a) ? 1 : 0));
      for (const host of hosts) {
        if (!overflows(host)) continue;
        const blocks = (host.matches('[class*="tx-"]') ? [host] : []).concat(textBlocks(host));
        if (!blocks.length) continue;
        const base = blocks.map((b) => parseFloat(getComputedStyle(b).fontSize));
        let k = 1;
        while (overflows(host) && k > MIN_SCALE) {
          k = Math.max(MIN_SCALE, k * STEP);
          blocks.forEach((b, i) => { b.dataset.adapt = '1'; b.style.fontSize = `${(base[i] * k).toFixed(2)}px`; });
        }
        report.fitted++;
        if (overflows(host)) {
          blocks.forEach((b) => {
            const n = linesFor(host, b);
            b.dataset.adapt = '1'; b.dataset.adaptDisplay = b.style.display;
            b.style.display = '-webkit-box'; b.style.webkitBoxOrient = 'vertical'; b.style.webkitLineClamp = String(n); b.style.overflow = 'hidden';
          });
          report.clamped++;
        }
        report.hosts.push({ cls: String(host.className).slice(0, 30), scale: +k.toFixed(2), clamped: overflows(host) });
      }
    });
    return report;
  }

  let pending = 0;
  const run = () => {
    const stage = document.querySelector('.stage');
    if (!stage || !stage.children.length) return;
    window.AdaptFit.report = fit(stage);
  };
  const schedule = () => { cancelAnimationFrame(pending); pending = requestAnimationFrame(run); };

  window.AdaptFit = { fit, run, report: null };
  const start = () => {
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(run);
    schedule();
  };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
