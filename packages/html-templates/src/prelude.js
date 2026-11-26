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
  function seek(t) {
    var s = scrub(), d = duration();
    if (!s || !d) return false;
    s.step = 'any';
    s.value = String(Math.min(1000, Math.max(0, (t / d) * 1000)));
    s.dispatchEvent(new Event('input'));
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

  window.__tpl = { ready: ready, seek: seek, duration: duration, starts: starts, config: cfg };
})();
