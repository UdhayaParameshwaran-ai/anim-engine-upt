// Shared by the HTML template audit and the limits sweep.
// ── In-page checks ───────────────────────────────────────────────────────────
export const inPage = () => {
  const W = 1920, H = 1080, issues = [];
  const eff = (el) => { let o = 1; for (let e = el; e && e !== document.documentElement; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === "none" || cs.visibility === "hidden") return 0; o *= parseFloat(cs.opacity); } return o; };
  const clipper = (el) => { for (let e = el; e && e !== document.body; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.textOverflow === "ellipsis" || cs.webkitLineClamp !== "none" && cs.webkitLineClamp) return "ellipsis"; if (e !== el && !e.classList.contains("fx-m") && /(hidden|clip)/.test(cs.overflow + cs.overflowX + cs.overflowY) && e.getBoundingClientRect().width < W - 4) return e; } return null; };
  const nodes = [], walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = walker.nextNode()); ) {
    const text = n.textContent.trim(); const el = n.parentElement;
    if (!text || !el || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(el.tagName) || el.closest(".editor,.controls,.player,.bar,header,nav,aside,.chrome,.toolbar")) continue;
    const o = eff(el); if (o < 0.5) continue;
    const r = document.createRange(); r.selectNodeContents(n); const b = r.getBoundingClientRect(); if (b.width < 2 || b.height < 2) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize); nodes.push({ el, text, b, o, ghost: /^\d{1,3}$/.test(text) && fs >= 90 });
    if (b.left < -2 || b.right > W + 2 || b.top < -2 || b.bottom > H + 2) issues.push({ kind: "outside", text: text.slice(0, 40) });
    const c = clipper(el);
    if (c && c !== "ellipsis") { const cb = c.getBoundingClientRect(); if (b.left < cb.left - 3 || b.right > cb.right + 3 || b.top < cb.top - 3 || b.bottom > cb.bottom + 3) issues.push({ kind: "clipped", text: text.slice(0, 40), by: (c.className || c.tagName).toString().slice(0, 30) }); }
  }
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const a = nodes[i], c = nodes[j]; if (a.el === c.el || a.el.contains(c.el) || c.el.contains(a.el) || a.ghost || c.ghost || a.b.height < 18 || c.b.height < 18) continue;
    const w = Math.min(a.b.right, c.b.right) - Math.max(a.b.left, c.b.left), h = Math.min(a.b.bottom, c.b.bottom) - Math.max(a.b.top, c.b.top);
    if (w > 3 && h > 3 && (w * h) / Math.min(a.b.width * a.b.height, c.b.width * c.b.height) > 0.3) issues.push({ kind: "overlap", text: `${a.text.slice(0, 22)} | ${c.text.slice(0, 22)}` });
  }
  return issues;
};


/** Launch Chrome or Edge through playwright-core (never downloads a browser). */
export async function launch(require) {
  const { chromium } = require("playwright-core");
  for (const ch of ["chrome", "msedge"]) { try { return await chromium.launch({ channel: ch }); } catch { /* next */ } }
  throw new Error("no Chrome or Edge found");
}
