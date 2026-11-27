/*
 * Override for the designer's comparison / Split Wipe page (v1-split-wipe.html). The designer's files stay as delivered; this runs in
 * front of them (src/files.mjs) and changes what the page does with its divider:
 *   - it draws a slider pill with an arrows glyph on the divider; a divider is all the page needs, so the pill is hidden;
 *   - the divider overshoots the middle as it sweeps in, and on every row it nudges 26px to the side and back ("like someone dragging
 *     to compare"). It now sweeps in once, stops in the middle and stays there; each point is carried by the row itself (its words
 *     wipe in, its icon pops on the divider).
 * If the designer changes the page, check these selectors (.cs-handle, .cs-after) and the sweep (0.2s to 1.2s) again.
 */
(function () {
  var MID = 960; // half of the 1920px stage
  var css = document.createElement('style');
  css.textContent = '.cs-handle b{display:none!important}';
  document.head.appendChild(css);
  if (!window.__tpl || !window.__tpl.afterSeek) return;
  window.__tpl.afterSeek(function (t) {
    var after = document.querySelector('.cs-after'), handle = document.querySelector('.cs-handle');
    if (!after || !handle) return;
    var m = /translateX\(([-\d.]+)px\)/.exec(handle.style.transform || '');
    var x = m ? parseFloat(m[1]) : MID;
    // Left of the middle is the overshoot of the sweep; after the sweep every move is a nudge.
    if (x < MID || t >= 1.3) {
      after.style.clipPath = 'inset(0 0 0 ' + MID + 'px)';
      handle.style.transform = 'translateX(' + MID + 'px)';
    }
  });
})();
