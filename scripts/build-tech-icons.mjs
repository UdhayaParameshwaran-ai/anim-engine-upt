// Generates the technology icons from the Tabler icon set (dev dependency `@tabler/icons`, MIT):
//   packages/engine/src/icons-tabler.ts     name → SVG markup on a 24×24 grid (same format as the Lucide icons)
//   packages/registry/src/icons-tabler.ts   name, category and search tags, for the asset library
//
// Tabler has 5,500 icons; an explainer about software needs a few hundred of them. They are picked by
// category (Development, Database, Computers, Version control, Logic...), by tag for the rest (a lock,
// a router, a CPU), plus a list of technology brands. Modifier variants (-off, -plus, -x...) and
// interface-only icons are left out, so the library stays small enough to search and to show a model.
//
// `pnpm icons:tech` regenerates the files; `--list` prints what was picked, grouped by category.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const pkg = dirname(require.resolve("@tabler/icons/package.json"));
const nodes = JSON.parse(readFileSync(join(pkg, "tabler-nodes-outline.json"), "utf8"));
const meta = JSON.parse(readFileSync(join(pkg, "icons.json"), "utf8"));
const version = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8")).version;

/** Categories that are about technology in full. */
const CATEGORIES = new Set(["Development", "Database", "Computers", "Version control", "Logic", "Extensions", "Charts", "Electrical"]);

/** Elsewhere an icon is picked when its name or a tag says it is about technology. */
const TECH = /\b(server|cloud|network|networking|security|encrypt|encryption|password|authentication|auth|code|developer|programming|software|hardware|computer|cpu|gpu|chip|memory|storage|api|database|terminal|wifi|bluetooth|router|usb|monitor|laptop|robot|ai|machine learning|cache|firewall|vpn|bug|debug|deploy|container|docker|bandwidth|latency|protocol|packet|ethernet|data center|datacenter|backup|log|analytics|dashboard|iot|sensor|blockchain|token|certificate|ssl|cyber|hacker|malware|virus|phishing|fingerprint|vault|hierarchy|stack|template)\b/;
const TECH_CATEGORIES = new Set(["Devices", "System", "Document", "Design", "Math", "Buildings", "Weather", "Communication", "Media", "Map", "Text", "E-commerce", "Games", "Shapes", "Symbols", "Health", "Arrows", "Badges", "Photography"]);

/** Variants of a base icon that add a small modifier; they say nothing new in an explainer. */
const MODIFIER = /-(off|x|minus|plus|cancel|heart|star|dollar|pin|pause|question|exclamation|spark|sparkle|sparkles|share|bolt|flame|bitcoin|down|up|key|code|cog|search|check|smile|ai|2|3|4|5|6|l|r|ring)$/;
/** Icons crossed out: the same picture, switched off. */
const OFF = /-(off|x|cancel)$/;
/** Families that are about one product or one decoration, not a concept. */
const NOISE = /^(airpods|device-airpods|device-imac|devices-|device-desktop-|device-ipad|device-mobile|device-tablet|device-watch|device-vision|align-box|antenna-bars|cell-signal|signal-|wifi-[0-9]|home-|building-airport|vacuum|wood|barrel|bucket|hammer-drill|dialpad|steam|butterfly|spider|meeple|mood|nut$|poker|currency-|coin-bitcoin|eye-bitcoin|file-bitcoin|flag-bitcoin|lock-bitcoin|cloud-bitcoin|user-bitcoin|user-|users-|face-mask|alarm-smoke|brightness|photo-sensor|wand|rosette|heart-|music-|camera-|photo-|folder-spark|folder-flame|file-spark|file-text-spark|timeline-event|apps-|assembly-|code-circle|code-dots|code-asterisk|link-code|code-variable-|variable-|shield-chevron|shield-half|shield-checkered|lock-open-2|logout-2|login-2|scan-|text-scan|input-|slashes|social|zsh|canary|thinking-|image-generation|zero-config|bot-id|api-book|device-3d|device-airtag|device-cctv|device-sd|device-sim|device-floppy|devices-pc|device-heart|device-unknown|device-analytics|device-computer-camera|dual-screen|earphone|screen-share|qrcode|mobiledata|home$|category|hexagons|cube-send|cube-spark|restore|face-id|password-|secret|eye-|settings-|adjustments-|filter-|bell-|calendar-|clock-|pointer-|flag-|location-|map-|world-|navigation-|zoom-|basket-|cash-|shopping-|tag-|mail-|message-|bookmark-|pencil-|droplet-|layout-board)/;

/** Wanted although a rule above would drop them. */
const KEEP = new Set([
  "firewall-check", "firewall-flame", "world-www", "terminal-2", "stack-2", "binary-tree-2", "bug", "api", "table", "schema",
  "cloud-download", "cloud-upload", "cloud-lock", "cloud-network", "cloud-data-connection", "shield-check", "shield-lock", "shield-x", "shield-half", "lock-password", "lock-open",
  "database-export", "database-import", "database-leak", "database-search", "table-export", "table-import", "table-alias", "table-shortcut", "git-branch-deleted", "chart-bar-popular",
  "api-app", "api-app-off", "device-desktop-code", "device-desktop-analytics", "device-mobile", "device-tablet", "device-watch", "device-desktop", "device-laptop", "device-tv", "device-usb", "device-imac",
  "devices", "devices-pc", "server-2", "server-bolt", "server-cog", "cpu-2", "gpu-2", "wifi-0", "wifi-1", "wifi-2", "signal-5g", "signal-4g", "signal-lte", "antenna-bars-5", "cell-signal-5",
  "message-chatbot", "mail-code", "file-code-2", "file-lock", "folder-lock", "home-signal", "user-key", "user-shield", "user-scan", "user-code", "face-id", "scan-eye", "text-scan-ai", "input-ai",
  "settings-code", "settings-ai", "eye-code", "robot-face", "password-user", "password-fingerprint", "password-mobile-phone", "secret-phrases", "world-code", "world-download", "world-upload",
  "cloud-up", "cloud-down", "cloud-cog", "cloud-bolt", "cloud-x", "cloud-check", "cloud-search", "cloud-plus", "cloud-minus", "cloud-share", "cloud-code", "cloud-exclamation",
  "bell-code", "calendar-code", "clock-code", "clock-shield", "adjustments-code", "filter-code", "map-code", "flag-code", "location-code", "pointer-code", "camera-code", "photo-code", "music-code",
  "code-variable", "ai-agent", "ai-agents", "ai-gateway", "ai", "model-ai", "mcp", "prompt", "thinking-high", "thinking-low", "thinking-medium", "code-ai", "image-generation",
]);

/** Technology brands, as Tabler spells them. Trademarks of their owners; used to name the product, as a logo of it. */
const BRANDS = `adobe airtable algolia amazon amd android angular ansible apple appstore astro auth0 aws azure bitbucket bootstrap bulma c-sharp chrome cloudflare codecov codepen codesandbox couchdb cpp css3 cypress d3 databricks debian deno discord django docker dropbox edge elastic ember figma filezilla firebase firefox flutter framer gatsby git github github-copilot gitlab gmail golang google google-analytics google-big-query google-drive google-maps google-play graphql html5 intercom javascript jira kotlin laravel linkedin mailgun mastercard medium meta mongodb mysql netbeans nextcloud nextjs nodejs notion npm nuxt oauth office onedrive open-source openai openvpn opera paypal php planetscale pnpm powershell prisma python react react-native redhat redux rust safari sass sentry slack snowflake socket-io solidjs stackoverflow storybook stripe sublime-text supabase svelte swift symfony tailwind telegram terraform threejs trello twilio typescript ubuntu unity vercel visa visual-studio vite vscode vue webflow whatsapp windows wordpress x xamarin yarn youtube zapier zoom`
  .split(/\s+/)
  .map((b) => `brand-${b}`);

const picked = new Map();
const add = (name, why) => {
  if (nodes[name] && !picked.has(name)) picked.set(name, why);
};
for (const [name, m] of Object.entries(meta)) {
  if (!nodes[name] || m.category === "Brand") continue;
  const text = [name.replace(/-/g, " "), ...(m.tags ?? [])];
  const byCategory = CATEGORIES.has(m.category);
  const byTag = TECH_CATEGORIES.has(m.category) && text.some((t) => TECH.test(t));
  if (!byCategory && !byTag) continue;
  // Categories about one family of things (network topologies, git, logic gates) keep their variants.
  const family = ["Computers", "Version control", "Logic", "Extensions", "Charts", "Electrical"].includes(m.category);
  if (!KEEP.has(name) && (OFF.test(name) || (!family && (MODIFIER.test(name) || NOISE.test(name))))) continue;
  add(name, m.category);
}
for (const name of KEEP) add(name, meta[name]?.category ?? "Keep");
const missingBrands = BRANDS.filter((b) => !nodes[b]);
for (const name of BRANDS) add(name, "Brand");

const names = [...picked.keys()].sort();

const attr = (v) => String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const markup = (name) =>
  nodes[name]
    .map(([tag, attrs]) => {
      // Stroke color and width come from the look; drop any the icon sets itself.
      const kept = Object.entries(attrs).filter(([k]) => !["key", "stroke", "stroke-width", "fill"].includes(k));
      return `<${tag} ${kept.map(([k, v]) => `${k}="${attr(v)}"`).join(" ")}/>`;
    })
    .join("");

if (process.argv.includes("--list")) {
  const by = {};
  for (const n of names) (by[picked.get(n)] ??= []).push(n);
  for (const [c, l] of Object.entries(by)) console.log(`\n## ${c} (${l.length})\n${l.join(" ")}`);
}

const header = `// Generated by scripts/build-tech-icons.mjs from @tabler/icons@${version}. Do not edit.
// Tabler Icons: MIT License, Copyright (c) 2020-2024 Paweł Kuna. https://tabler.io/icons
// Brand icons are trademarks of their owners; they name the product they show.
`;

writeFileSync(
  join(repo, "packages/engine/src/icons-tabler.ts"),
  `${header}
/** Icon name → SVG markup on a 24×24 grid (strokes take the look's color and weight). */
export const TABLER: Record<string, string> = {
${names.map((n) => `  ${JSON.stringify(n)}: ${JSON.stringify(markup(n))},`).join("\n")}
};
`,
);

writeFileSync(
  join(repo, "packages/registry/src/icons-tabler.ts"),
  `${header}
/** Icon name, its Tabler category and its search tags (space-separated), in name order. */
export const TABLER_ICONS: readonly (readonly [name: string, category: string, tags: string])[] = [
${names.map((n) => `  [${JSON.stringify(n)}, ${JSON.stringify(meta[n].category)}, ${JSON.stringify((meta[n].tags ?? []).join(" "))}],`).join("\n")}
];
`,
);

console.log(`${names.length} of ${Object.keys(nodes).length} icons kept (@tabler/icons@${version})`);
if (missingBrands.length) console.log(`brands not in this version: ${missingBrands.join(" ")}`);
