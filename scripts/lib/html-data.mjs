// Data builders, copy lengths and item ranges shared by the HTML template tools.
export const POOL = "the gateway checks the signature and the expiry time of each token then forwards the request to the matching internal service over a private link while the cache keeps recent answers close to the caller".split(" ");
/** About `len` characters of plain words, cut at a word boundary. */
export const copy = (len, seed = 0) => { let s = ""; for (let i = seed; s.length < len; i++) s += (s ? " " : "") + POOL[i % POOL.length]; return s.length > len + 6 ? s.slice(0, s.lastIndexOf(" ", len)) : s; };
export const LEVELS = [0, 1, 2, 3, 4, 5].map((k) => ({ k, title: 12 + 8 * k, detail: 30 + 18 * k }));
const icons = ["send", "search", "shield", "clock", "check", "user", "star", "key"];
const N = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const items = (n, L) => N(n, (i) => ({ title: copy(L.title, i * 3), detail: copy(L.detail, i * 5), icon: icons[i % icons.length] }));
const shell = (its) => ({ pace: "normal", motion: "default", order: "forward", kicker: "How it works", heading: "From request to response", items: its });
const kind = (key, make, codeMax, field) => ({ key, make, codeMax, field });

export const SETS = {
  steps: { dir: "process-steps-motion", ...kind("process-steps-data-v1", (n, L) => shell(items(n, L)), 6, "title+detail") },
  comparison: { dir: "comparison-motion", ...kind("comparison-data-v1", (n, L) => shell([{ title: "Sessions", detail: "Tokens" }, ...items(n - 1, L).map((x) => ({ title: copy(L.detail, 1), detail: copy(L.detail, 4), icon: x.icon }))]), 6, "row") },
  interaction: { dir: "interaction-motion", ...kind("interaction-kit-data-v1", (n, L) => shell(items(n, L)), 6, "title+detail") },
  bar: { dir: "charts/bar", ...kind("chart-bar-v1", (n, L) => shell(N(n, (i) => ({ title: copy(L.title, i), detail: `$${20 + i * 7}k` }))), 6, "label") },
  line: { dir: "charts/line", ...kind("chart-line-v1", (n, L) => shell(N(n, (i) => ({ title: copy(L.title, i), detail: `${12 + i * 5}k` }))), 6, "label") },
  donut: { dir: "charts/donut", ...kind("chart-donut-v1", (n, L) => shell(N(n, (i) => ({ title: copy(L.title, i), detail: `${40 - i * 6}%` }))), 6, "label") },
  stats: { dir: "stats-motion", ...kind("stats-data-v2", (n, L) => ({ pace: "normal", motion: "rise", order: "forward", kicker: "Load", heading: "Requests per second", items: N(n, (i) => ({ label: copy(L.title, i), value: String(1200 + i * 130), prefix: "", suffix: "k", delta: i ? String(10 + i) : "", deltaLabel: i ? "vs last" : "", icon: "user", highlight: i === n - 1 })) }), 6, "label") },
  timeline: { dir: "timeline-component", ...kind("timeline-component-data-v1", (n, L) => ({ kicker: "History", heading: "A long history", pace: "normal", motion: "default", order: "forward", items: N(n, (i) => ({ date: String(2019 + i), title: copy(L.title, i), detail: copy(L.detail, i), image: "" })) }), 8, "title+detail") },
  titles: { dir: "titles", ...kind("titles-data-v1", (n, L) => ({ pace: "normal", bg: "auto", playout: false, kicker: "Episode 01", title: copy(L.title * 1.6, 0), subtitle: copy(L.detail, 2), byline: "Dr. A. Rao", brand: "Tandemloop", icon: "shield" }), 0, "title+subtitle") },
  transitions: { dir: "transitions", ...kind("transitions-data-v1", (n, L) => ({ pace: "normal", dir: "left", hold: 1.0, a: { title: copy(L.title, 0), subtitle: copy(L.detail, 1), tint: "base" }, b: { title: copy(L.title, 2), subtitle: copy(L.detail, 3), tint: "deep" } }), 0, "title+subtitle") },
  text: { dir: "text-motion", ...kind("text-motion-data-v3", (n, L) => ({ wpm: 150, words: "narration", caps: "off", scheme: "auto", lines: N(n, (i) => ({ text: copy(L.detail, i), p: i % 3 === 2 ? 3 : i % 3 === 0 ? 1 : 2, cut: i === 4 })) }), 10, "line") },
};
// The designer's own table of item counts (min, max); the code may cap lower (codeMax).
export const RANGE = { "steps/v4-orbit": [3, 6], "steps/*": [2, 6], "stats/v1-tape-measure": [1, 6], "stats/v2-unit-swarm": [1, 6], "stats/v3-liquid-tubes": [2, 6], "stats/v4-bubble-pack": [2, 6], "stats/v5-scale-zoom": [2, 6], "stats/v6-comet-trail": [2, 8], "stats/v1-odometer": [1, 6], "stats/*": [1, 6], "interaction/v4-toggle-switches": [1, 5], "interaction/v5-touch-swipe": [2, 6], "interaction/*": [1, 6], "comparison/*": [2, 6], "bar/*": [2, 8], "line/*": [3, 8], "donut/v2-activity-rings": [2, 5], "donut/*": [2, 6], "timeline/*": [2, 8], "text/*": [1, 10], "titles/*": [0, 0], "transitions/*": [0, 0] };
export const rangeOf = (sid, v) => RANGE[`${sid}/${v}`] ?? RANGE[`${sid}/*`];
export const codeMaxOf = (sid, v, S) => (sid === "stats" && v === "v6-comet-trail" ? 8 : S.codeMax);


/**
 * Variants checked by eye (contact sheets from scripts/html-shots.mjs) where the automatic check is wrong or too weak.
 * `level` is the copy level seen to render cleanly; `max` caps the item count; `provisional` marks a value not yet seen.
 */
export const REVIEWED = {
  "steps/v2-card-deck": { level: 2, note: "checked by eye at 6 steps: a 28-character title wraps to 2-3 lines and a 66-character detail to 2; the automatic check flagged the cards flying into the tray" },
  "stats/v1-odometer": { level: 2, note: "digits roll through the frame on purpose; no defect seen at 6 items" },
  "stats/v2-unit-swarm": { level: 2, note: "clean at 6 items" },
  "line/v4-focus-zoom": { level: 2, note: "the camera frames the last point on purpose; labels outside the frame are expected" },
  "interaction/v5-touch-swipe": { level: 1, note: "cards slide in from off-frame on purpose" },
  "timeline/v1-ribbon": { level: 1, note: "clean at 8 events" },
  "timeline/v3-filmstrip": { level: 1, note: "the strip scrolls off-frame on purpose" },
  "titles/v3-logo": { level: 1, note: "clean" },
  "comparison/v4-flip-cards": { level: 1, note: "cards flip in 3D, so words overlap mid-turn; settled frames are clean" },
  "transitions/v6-split": { level: 1, note: "the halves leave the frame on purpose" },
  "stats/v4-bubble-pack": { level: 1, max: 3, provisional: true, note: "bubbles run off the bottom of the frame from the 4th (20-character labels); the designer's table says 6" },
  "stats/v5-scale-zoom": { level: 1, max: 3, provisional: true, note: "the nested labels overprint each other at 4 items; 3 not yet seen" },
  "bar/v5-glow-wipe": { level: 0, max: 5, labelChars: 14, note: "long labels wrap and overprint the next row; 5 rows with short labels are clean" },
};
