// Generates the icon data from the Lucide icon set (dev dependency `lucide-static`):
//   packages/engine/src/icons-lucide.ts     name → SVG markup on a 24×24 grid
//   packages/registry/src/icons-lucide.ts   name + search tags, for the asset library
// Interface-only icons (alignment, chevrons, panels, text formatting, brand logos) and
// modifier variants (-plus, -off, -2 ...) are left out: they mean nothing in an explainer
// and crowd the search. Run with `pnpm icons` after updating lucide-static.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const pkg = dirname(require.resolve("lucide-static/package.json"));
const nodes = JSON.parse(readFileSync(join(pkg, "icon-nodes.json"), "utf8"));
const tags = JSON.parse(readFileSync(join(pkg, "tags.json"), "utf8"));
const version = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8")).version;

// Families that only make sense in an app's interface, an editor or as a brand logo.
const UI =
  /^(a-|align|arrow|chevron|corner|move|panel|text|case|between|flip|fold|unfold|list|layout|columns|rows|grid|toggle|iteration|redo|undo|rotate|refresh|spell|heading|pilcrow|indent|outdent|wrap|gallery|grip|loader|maximize|minimize|more|mouse-pointer|pointer|option|command|separator|sidebar|skip|step|stretch|strikethrough|subscript|superscript|underline|italic|bold|baseline|remove-formatting|type|ligature|letter|scan|picture-in-picture|app-window|dock|fullscreen|shrink|expand|sort|git|github|gitlab|chrome|figma|framer|slack|twitter|facebook|instagram|linkedin|youtube|twitch|dribbble|codepen|codesandbox|trello|pocket|rail-symbol|badge|square-|circle-|triangle-|octagon-|hexagon-|diamond-|file-|folder-|message-square-|message-circle-|calendar-|clipboard-|bookmark-|user-round|users-round|book-|cloud-|monitor-|smartphone-|tablet-|laptop-|screen-|phone-|mail-|shield-|ticket-|table-|image-|copy|clipboard-copy|clipboard-paste|log-|import|export|save|share|upload|download|send-|reply|forward|scroll|view|zoom|crop|lasso|pen-|pencil-|eraser|brush|paint|pipette|frame|group|ungroup|bring|send-to|layers-|component|blocks|code|braces|brackets|terminal|regex|binary|variable|function|parentheses|webhook|workflow|waypoints|route-|signpost|navigation|locate|land-plot|spline|tangent|vector|section|form|keyboard|space|delete|backspace|eye|ellipsis|menu|equal|divide|percent|plus|minus|x$|check-|dot|hash|at-sign|asterisk|ampersand|slash|quote|radius|ratio|proportions|ruler-dimension|diff|replace|merge|split|combine|shuffle|repeat|rewind|fast-forward|play|pause|stop|circle-stop|volume|cast|airplay|captions|subtitles|closed-caption|voicemail|power-off|log|link-2|unlink|external-link|qr-code|barcode|nfc|rss|podcast|settings-2|sliders|filter|funnel-|list-|search-|scan-|tag|tags|pin-|map-pin-|star-|heart-|bell-|alarm-clock-|timer-|clock-[0-9]|clock-a|clock-f|wifi-|signal-|battery-|bluetooth-|usb|hard-drive-|server-|database-|cpu$|circuit|memory|pc-case|touchpad|mouse|gamepad|joystick|dices?|puzzle|toy|drama|venetian|party|cake-|candy-|lollipop|popcorn|popsicle|donut|croissant|dessert|ice-cream|sandwich|hop|ham|beef|drumstick|egg-|fish-|utensils-|cooking|microwave|refrigerator|washing|air-vent|heater|fan|lamp-|bath|shower|toilet|bed-|sofa|armchair|door-|blinds|fence|construction|brick|drill|hammer$|wrench|axe|pickaxe|shovel|saw|nut|bolt$|cable|plug-|unplug|ev-charger|fuel|parking|traffic|milestone|octagon|squircle|shapes|pentagon|hexagon$|diamond$|rectangle|circle$|square$|triangle$)/;
// Variants of a base icon that add a small modifier.
const MODIFIER = /-(plus|minus|x|check|off|dot|dashed|alert|question|cog|lock|key|pen|input|output|sync|slash|mark|code|search|heart|star|ban|warning|[0-9]+)$/;
// Kept although a rule above would drop them: clear, common meanings.
const KEEP = new Set([
  "trending-up", "trending-down", "thumbs-up", "thumbs-down", "book-open", "folder-open", "file-text", "calendar-days", "clipboard-list", "clipboard-check",
  "message-circle", "message-square", "shield-check", "cloud-rain", "cloud-snow", "cloud-lightning", "cloud-sun", "cloud-drizzle", "cloud-fog", "sun-moon", "map-pin", "user-check",
  "heart-pulse", "heart-handshake", "badge-check", "circle-dollar-sign", "badge-dollar-sign", "hand-coins", "piggy-bank", "search", "eye", "filter", "share-2", "send", "link", "hammer",
  "wrench", "cpu", "plug", "play", "code", "terminal", "tag", "puzzle", "fan", "fuel", "construction", "cable", "circuit-board", "keyboard", "mouse", "gamepad-2", "ruler",
  "utensils", "house-plus", "phone", "mail", "monitor", "smartphone", "laptop", "tablet", "image", "table", "ticket", "shield", "bookmark", "calendar", "clipboard", "file", "folder", "users",
  "user", "star", "bell", "wifi", "signal", "battery", "bluetooth", "timer", "alarm-clock", "scale", "layers", "route", "split", "merge", "repeat", "shuffle", "funnel", "sliders-horizontal", "settings",
  "target", "x", "check", "plus", "minus", "equal", "percent", "divide", "hash", "infinity", "bed", "bath", "lamp", "door-open", "factory", "warehouse", "brick-wall", "traffic-cone", "milestone", "battery-charging", "battery-full", "battery-low",
  "hard-drive", "server", "database", "dna", "microscope", "telescope", "test-tube", "test-tubes", "flask-conical", "flask-round", "atom", "orbit", "magnet", "radiation", "biohazard", "syringe", "pill", "stethoscope", "thermometer",
  "egg", "fish", "beef", "apple", "carrot", "wheat", "milk", "coffee", "cake", "pizza", "salad", "soup", "cookie", "candy", "cherry", "grape", "banana", "citrus", "nut", "bean", "popcorn", "ice-cream-cone", "sandwich",
]);

// One icon per idea: no regional currency or arrow variants of the same picture.
const VARIANT = /(-(rupee|yen|ruble|franc|lira|sterling|euro|cent|bitcoin)$)|(-arrow-(up|down|left|right))|^(receipt|banknote|wallet|currency|badge)-/;
const MISLEADING = new Set(["waves-ladder", "waves-arrow-up", "waves-arrow-down", "ruler-dimension-line", "pencil-ruler", "tree-palm"]);
const names = Object.keys(nodes)
  .filter((n) => !MISLEADING.has(n) && (KEEP.has(n) || (!UI.test(n) && !MODIFIER.test(n) && !VARIANT.test(n))))
  .sort();

const attr = (v) => String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const markup = (name) =>
  nodes[name]
    .map(([tag, attrs]) => {
      // Stroke color and width come from the look; drop any the icon sets itself.
      const kept = Object.entries(attrs).filter(([k]) => !["key", "stroke", "stroke-width", "fill"].includes(k));
      return `<${tag} ${kept.map(([k, v]) => `${k}="${attr(v)}"`).join(" ")}/>`;
    })
    .join("");

const header = `// Generated by scripts/build-icons.mjs from lucide-static@${version}. Do not edit.
// Lucide icons: ISC License, Copyright (c) Lucide Contributors. Portions derived from
// Feather (MIT License, Copyright (c) 2013-2023 Cole Bemis). https://lucide.dev/license
`;

writeFileSync(
  join(repo, "packages/engine/src/icons-lucide.ts"),
  `${header}
/** Icon name → SVG markup on a 24×24 grid (strokes take the look's color and weight). */
export const LUCIDE: Record<string, string> = {
${names.map((n) => `  ${JSON.stringify(n)}: ${JSON.stringify(markup(n))},`).join("\n")}
};
`,
);

writeFileSync(
  join(repo, "packages/registry/src/icons-lucide.ts"),
  `${header}
/** Icon name and its search tags (space-separated), in name order. */
export const LUCIDE_ICONS: readonly (readonly [name: string, tags: string])[] = [
${names.map((n) => `  [${JSON.stringify(n)}, ${JSON.stringify((tags[n] ?? []).join(" "))}],`).join("\n")}
];
`,
);

console.log(`${names.length} of ${Object.keys(nodes).length} icons kept (lucide-static@${version})`);
