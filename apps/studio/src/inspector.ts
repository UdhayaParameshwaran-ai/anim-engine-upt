import type { Moment } from "./inspect.js";
import { escape } from "./util.js";

/** Renders a Moment: position in the structure, then one row per element. */
export function renderInspector(root: HTMLElement, m: Moment): void {
  if (!m.scene) {
    root.innerHTML = `<p class="muted">nothing on screen</p>`;
    return;
  }
  const step = m.scene.steps[m.stepIndex];
  const head =
    `<dl class="where">` +
    `<dt>scene</dt><dd>${escape(m.scene.id)}</dd>` +
    `<dt>step</dt><dd>${escape(step?.id ?? String(m.stepIndex + 1))}</dd>` +
    `<dt>beat</dt><dd>${m.beat ? `<a data-line="${m.beat.line}">L${m.beat.line}</a>${m.beat.hold ? ` <span class="muted">hold ${m.beat.hold.toFixed(2)}s</span>` : ""}` : "—"}</dd>` +
    `<dt>word</dt><dd>${m.word ? `“${escape(m.word)}”` : "—"}</dd>` +
    `</dl>`;
  const rows = m.elements
    .map((e) => {
      const p = e.props;
      const n = (v: unknown, d = 2) => (typeof v === "number" ? String(Math.round(v * 10 ** d) / 10 ** d) : "");
      const extra = [
        n(p.draw) !== "1" && n(p.draw) ? `draw ${n(p.draw)}` : "",
        n(p.reveal) !== "1" && n(p.reveal) ? `reveal ${n(p.reveal)}` : "",
        n(p.tint) !== "0" && n(p.tint) ? `tint ${n(p.tint)}` : "",
        n(p.scale) !== "1" && n(p.scale) ? `×${n(p.scale)}` : "",
      ].filter(Boolean).join(" ");
      const d = e.driver;
      const driver = d ? `<a data-line="${d.line}" class="${e.active ? "running" : ""}" title="${escape(`${d.prop} ${d.t0.toFixed(2)}–${d.t1.toFixed(2)}s`)}">${escape(d.verb)}${d.line ? ` L${d.line}` : ""}</a>` : "";
      return (
        `<tr class="${e.visible ? "" : "hidden"}${e.active ? " active" : ""}">` +
        `<td><a data-line="${e.line}">${escape(e.id)}</a></td>` +
        `<td class="muted">${escape(e.kind.replace(/@\d+$/, ""))}</td>` +
        `<td>${n(p.opacity)}</td>` +
        `<td>${Math.round(e.box.x + e.box.w / 2)},${Math.round(e.box.y + e.box.h / 2)}</td>` +
        `<td>${extra}</td><td>${driver}</td></tr>`
      );
    })
    .join("");
  root.innerHTML = `${head}<table><thead><tr><th>id</th><th>kind</th><th>opacity</th><th>center</th><th></th><th>driven by</th></tr></thead><tbody>${rows}</tbody></table>`;
}
