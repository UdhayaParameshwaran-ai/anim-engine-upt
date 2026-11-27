// Serves the designer's pages (with our prelude and fitting overlay put in front of their own scripts) and their font.
//
//   respond(url)       answer for a request to TEMPLATE_ORIGIN (the renderer's way), or null when the URL is not ours
//   respondPath(path)  answer for a path under the template root, e.g. `/phase1/process-steps-motion/v3-number-rail.html`
//                      (the Studio's way: its dev server mounts the root at /tpl)
//
// Nothing here touches the network: Inter comes from @fontsource, the same files the engine's own fonts use, and the pages'
// Google Fonts link is rewritten to a local stylesheet.
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");
const repoRoot = join(pkgRoot, "..", "..");

export const TEMPLATE_ORIGIN = "https://tpl.anim.local";
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg" };
const WEIGHTS = [400, 500, 600, 700, 800, 900];
const NOT_FOUND = { status: 404, type: "text/plain", body: Buffer.from("not found") };

/**
 * The code that goes first in every page: the prelude, then the fitting overlay. Read on every request (two small files): a Studio
 * dev server that started before an edit would otherwise keep serving the old prelude, and pages without `__tpl.measure` fall back to
 * the designer's own timing formulas, which are wrong for several variants (the timeline filmstrip lit the wrong event).
 */
function injection() {
  return `<script>${readFileSync(join(here, "prelude.js"), "utf8")}</script><script>${readFileSync(join(pkgRoot, "adapt", "adapt.js"), "utf8")}</script>`;
}

/** The Inter faces the pages use, from the local files (relative URLs, so any mount point works). */
function interCss() {
  return WEIGHTS.map((w) => `@font-face{font-family:"Inter";font-style:normal;font-weight:${w};font-display:block;src:url(_fonts/inter-latin-${w}-normal.woff2) format("woff2");}`).join("\n");
}

const within = (root, p) => {
  const n = normalize(p);
  return n.startsWith(root + sep) ? n : null;
};

/** Pages we correct (patches/): the designer's files stay as delivered, the override runs in front of them. Keyed by the path under designer/. */
const PATCHES = { "phase1/comparison-motion/v1-split-wipe.html": "compare-split.js" };
const patchFor = (file) => {
  const rel = normalize(file).split(sep).join("/");
  const hit = Object.keys(PATCHES).find((k) => rel.endsWith("/designer/" + k));
  return hit ? "<script>" + readFileSync(join(pkgRoot, "patches", PATCHES[hit]), "utf8") + "</script>" : "";
};

/** Answer for a path under the template root. */
export function respondPath(path) {
  if (path === "/_fonts.css") return { status: 200, type: TYPES[".css"], body: Buffer.from(interCss()) };
  if (path.startsWith("/_fonts/")) {
    const dir = join(repoRoot, "node_modules", "@fontsource", "inter", "files");
    const file = within(dir, join(dir, path.slice("/_fonts/".length)));
    return file && existsSync(file) ? { status: 200, type: TYPES[".woff2"], body: readFileSync(file) } : NOT_FOUND;
  }
  const file = within(join(pkgRoot, "designer"), join(pkgRoot, "designer", path));
  if (!file || !existsSync(file)) return NOT_FOUND;
  const type = TYPES[extname(file)] ?? "application/octet-stream";
  if (extname(file) !== ".html") return { status: 200, type, body: readFileSync(file) };
  const html = readFileSync(file, "utf8")
    .replace(/<link[^>]+fonts\.googleapis\.com\/css2[^>]*>/gi, '<link rel="stylesheet" href="../../_fonts.css">')
    .replace(/<head[^>]*>/i, (m) => m + injection() + patchFor(file));
  return { status: 200, type, body: Buffer.from(html) };
}

/** Answer for a request, or null when it is not for the templates (the caller lets it through or fails it). */
export function respond(url) {
  const u = new URL(url);
  if (u.hostname === "fonts.googleapis.com") return { status: 200, type: TYPES[".css"], body: Buffer.from(interCss()) };
  if (u.hostname === "fonts.gstatic.com") return NOT_FOUND;
  if (u.origin !== TEMPLATE_ORIGIN) return null;
  return respondPath(decodeURIComponent(u.pathname));
}
