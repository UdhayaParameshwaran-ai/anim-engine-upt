/* Runs inside a designer page, before any of its own scripts (the server puts it first in <head>).
 *
 * It turns the page into a scene we can drive:
 *   - the data comes from the URL fragment (#<encoded JSON>), not from the page's localStorage; the fragment is never
 *     sent anywhere, and unlike `window.name` it survives the move to this origin;
 *   - `window.__tpl.seek(t)` shows the page at t seconds, exactly, any number of times, in any order;
 *   - `window.__tpl.ready` resolves once the page has built its stage, loaded its fonts and been fitted;
 *   - `window.__tpl.duration()` is the template's own length for this data.
 *
 * Seeking uses the page's scrubber: its `input` handler is the one place every designer set turns a time into a frame.
 * Everything here goes through that one handler, so when a later phase exposes a proper API only this file changes.
 */
(function () {
  'use strict';
  var cfg = {};
  try { cfg = JSON.parse(decodeURIComponent(location.hash.slice(1)) || '{}') || {}; } catch (_) { cfg = {}; }

  // The page reads and writes its data through localStorage. Behind our host that is not available (the origin is a made-up
  // one inside someone else's page), and even where it is, it must not be shared between scenes. So the page gets its own
  // in-memory store, holding only the data this scene was given.
  var mem = {};
  if (cfg.key) mem[cfg.key] = JSON.stringify(cfg.data);
  var store = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
    setItem: function () { /* the page's editor must not write back */ },
    removeItem: function () {},
    clear: function () {},
    key: function () { return null; },
    length: 0
  };
  try { Object.defineProperty(window, 'localStorage', { configurable: true, get: function () { return store; } }); } catch (_) { /* keep the original */ }

  var raf = function () { return new Promise(function (r) { requestAnimationFrame(function () { r(); }); }); };
  var ready = new Promise(function (resolve) {
    window.addEventListener('load', function () {
      // A page inside a hidden scene lays nothing out, so the browser would not fetch its font until the scene appears, and the
      // text would stay invisible while it loads. Ask for every weight now.
      var fonts = document.fonts && document.fonts.load
        ? Promise.all([400, 500, 600, 700, 800, 900].map(function (w) { return document.fonts.load(w + ' 32px "Inter"').catch(function () { return []; }); })).then(function () { return document.fonts.ready; })
        : Promise.resolve();
      fonts.then(raf).then(raf).then(raf).then(function () {
        if (window.AdaptFit && window.AdaptFit.run) window.AdaptFit.run();
        return raf();
      }).then(function () { resolve(true); });
    });
  });

  function scrub() { return document.querySelector('.scrub'); }
  function duration() {
    var el = document.querySelector('.time');
    var m = el && /\/\s*([\d.]+)s/.exec(el.textContent || '');
    return m ? Number(m[1]) : 0;
  }
  var afterSeek = [];
  function seek(t) {
    var s = scrub(), d = duration();
    if (!s || !d) return false;
    s.step = 'any';
    s.value = String(Math.min(1000, Math.max(0, (t / d) * 1000)));
    s.dispatchEvent(new Event('input'));
    // Overrides (patches/) correct what the page drew, after every frame it draws.
    for (var i = 0; i < afterSeek.length; i++) { try { afterSeek[i](t); } catch (_) { /* a broken override must not stop the page */ } }
    return true;
  }

  /**
   * When each item is spoken-about on the page, in the page's own time. The steps shell (steps, comparison, interaction, charts)
   * exposes its timing kit; stats and the timeline keep theirs inside, so their formulas are repeated here from the designer's
   * code (stats-fx.js: T0 + i * beat; timeline-core.js: the focus walk after the build). Titles have no items: null.
   */
  function starts(n, pace) {
    try {
      var kit = window.StepsFX && window.StepsFX.kit, sp = window.StepsMotion && window.StepsMotion.PACES;
      if (kit && kit.starts && sp) return kit.starts(n, sp[pace] || sp.normal);
      var st = window.StatsMotion && window.StatsMotion.PACES;
      if (st) {
        var P = st[pace] || st.normal, beat = 1.0 * P.stagger + 1.7 * P.hold, out = [];
        for (var i = 0; i < n; i++) out.push(0.6 + i * beat);
        return out;
      }
      var tl = window.TimelineSet && window.TimelineSet.PACES;
      if (tl) {
        var Q = tl[pace] || tl.normal, stag = Math.round(17 * Q.stagger) / 30, focus = Math.round(45 * Q.focus) / 30;
        var h0 = 0.9 + (n - 1) * stag + 1.0 + 0.4, res = [];
        for (var k = 0; k < n; k++) res.push(h0 + k * focus);
        return res;
      }
    } catch (_) { /* not exposed by this set */ }
    return null;
  }

  /*
   * What the page really does, measured. The formulas in `starts` come from the designer's code and are right for some pages and wrong
   * for others (comparison pages give their header the first slot, the timeline's camera takes longer per event, a bar chart shows its
   * bars 0.2s apart). So the page is scanned once, here: for every item, when its text first becomes visible on the page (`appear`) and
   * when it is fully there (`landed`). `items` is, per item, the strings it shows. A string that is already visible in the page's first
   * moments (the front of a flip card, a title) says nothing about when the item arrives and is ignored; an item none of whose strings
   * can be followed gets null (the caller falls back to `starts`).
   */
  var norm = function (s) { return String(s).split(' ').join('').split('\n').join('').split('\t').join('').toLowerCase(); };
  function scanText() {
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), nodes = [], full = '';
    for (var n; (n = walker.nextNode()); ) {
      var el = n.parentElement;
      if (!el || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
      var s = norm(n.data);
      if (!s) continue;
      nodes.push({ el: el, start: full.length, len: s.length });
      full += s;
    }
    return { nodes: nodes, full: full, cache: new Map() };
  }
  function effective(scan, el) {
    if (scan.cache.has(el)) return scan.cache.get(el);
    var o = 1;
    for (var e = el; e && e !== document.documentElement; e = e.parentElement) {
      var cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden') { o = 0; break; }
      o *= parseFloat(cs.opacity);
      var f = cs.filter || '';
      var at = f.indexOf('blur(');
      if (at >= 0 && parseFloat(f.slice(at + 5)) > 1.5) o *= 0.35;
    }
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.right < 0 || r.left > 1920 || r.bottom < 0 || r.top > 1080) o = 0;
    // Text slid behind a mask (words rising out of a clipped line, a strip scrolled out of its window) is not there: only the part
    // inside every clipping ancestor counts.
    if (o > 0) {
      var share = 1;
      for (var p = el.parentElement; p && p !== document.body && share > 0; p = p.parentElement) {
        var ps = getComputedStyle(p);
        if (ps.overflowX === 'visible' && ps.overflowY === 'visible') continue;
        var c = p.getBoundingClientRect();
        var w = Math.min(r.right, c.right) - Math.max(r.left, c.left), h = Math.min(r.bottom, c.bottom) - Math.max(r.top, c.top);
        share = Math.min(share, (Math.max(0, w) * Math.max(0, h)) / (r.width * r.height));
      }
      o *= share;
    }
    scan.cache.set(el, o);
    return o;
  }
  /** 0 to 1: how visible the text is (every character of it, so a half-typed or half-revealed string is not yet there). */
  function visibility(scan, text) {
    var nd = norm(text), best = 0, from = 0;
    if (!nd) return 0;
    for (;;) {
      var i = scan.full.indexOf(nd, from);
      if (i < 0) break;
      from = i + 1;
      var v = 1;
      for (var k = 0; k < scan.nodes.length; k++) {
        var node = scan.nodes[k];
        if (node.start + node.len <= i) continue;
        if (node.start >= i + nd.length) break;
        v = Math.min(v, effective(scan, node.el));
      }
      if (v > best) best = v;
    }
    return best;
  }
  function measure(items, step) {
    var d = duration(), dt = step || 0.1;
    if (!d) return null;
    var strings = items.map(function (list) {
      return list.filter(function (s) { var t = String(s).trim(); return (t.length >= 3 && /[A-Za-z]/.test(t)) || (t.length >= 2 && /[0-9]/.test(t)); }).map(function (s) { return String(s).trim().slice(0, 18); });
    });
    var rec = strings.map(function (list) { return list.map(function () { return { initial: false, appear: null, landed: null }; }); });
    for (var t = 0; t <= d + 1e-6; t += dt) {
      seek(t);
      var scan = scanText();
      strings.forEach(function (list, i) {
        list.forEach(function (text, j) {
          var v = visibility(scan, text), r = rec[i][j];
          if (t < 0.25 && v > 0.5) r.initial = true;
          // Half visible is "there"; a faint placeholder (a card waiting for its text) does not count.
          if (r.appear === null && v >= 0.5) r.appear = Math.round(t * 100) / 100;
          if (r.landed === null && v >= 0.9) r.landed = Math.round(t * 100) / 100;
        });
      });
    }
    seek(0);
    // Per item the earliest and the latest of its strings that are not there from the start: usually the same moment, but a flip card
    // shows its front at once and the answer on its back later, and only the caller can say which of the two the item is about.
    var pick = function (r) { return { appear: r.appear, landed: r.landed === null ? r.appear : r.landed }; };
    return rec.map(function (list) {
      var usable = list.filter(function (r) { return !r.initial && r.appear !== null; });
      if (!usable.length) return null;
      usable.sort(function (a, b) { return a.appear - b.appear; });
      return { first: pick(usable[0]), last: pick(usable[usable.length - 1]) };
    });
  }

  /*
   * Icons: every designer set draws them with `U.icon(name, size, strokeWidth)` from its own small table. Ours (cfg.icons: name ->
   * stroke-only markup) take precedence, so any icon name our scripts use works. The set's script assigns its global (StepsMotion,
   * StatsMotion, ...) before it mounts, so a setter on that global patches `U.icon` in time.
   */
  var iconTable = cfg.icons || {};
  function ownIcon(original) {
    return function (name, size, sw) {
      var body = iconTable[name];
      if (!body) return original.apply(this, arguments);
      size = size || 24; sw = sw == null ? 2 : sw;
      return '<svg class="ic" viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" stroke="currentColor" stroke-width="' + sw + '" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>';
    };
  }
  ['StepsMotion', 'StatsMotion', 'TimelineSet', 'Titles', 'Transitions', 'TextMotion'].forEach(function (g) {
    var value;
    Object.defineProperty(window, g, {
      configurable: true,
      get: function () { return value; },
      set: function (v) {
        value = v;
        if (v && v.U && typeof v.U.icon === 'function' && Object.keys(iconTable).length) v.U.icon = ownIcon(v.U.icon);
      }
    });
  });

  window.__tpl = { ready: ready, seek: seek, afterSeek: function (fn) { afterSeek.push(fn); }, duration: duration, starts: starts, measure: measure, config: cfg };
})();
