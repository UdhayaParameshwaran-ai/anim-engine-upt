import type { Stage } from "@anim/engine";
import type { Moment } from "./inspect.js";

const NS = "http://www.w3.org/2000/svg";

/**
 * Debug overlay drawn on top of the stage: each element's current box and
 * id, following the camera. Lives inside the stage root so it shares the
 * stage's fit-to-container scaling; the stage never touches it.
 */
export class Overlay {
  private readonly svg: SVGSVGElement;
  private readonly cam: SVGGElement;
  enabled = false;

  constructor(stage: Stage) {
    const { width, height } = stage.ir.canvas;
    this.svg = document.createElementNS(NS, "svg");
    this.svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    this.svg.setAttribute("class", "studio-overlay");
    Object.assign(this.svg.style, { position: "absolute", left: "0", top: "0", width: `${width}px`, height: `${height}px`, pointerEvents: "none" });
    this.cam = document.createElementNS(NS, "g");
    this.svg.append(this.cam);
    stage.root.append(this.svg);
  }

  update(m: Moment): void {
    this.svg.style.display = this.enabled ? "" : "none";
    if (!this.enabled) return;
    const { width } = this.svg.viewBox.baseVal;
    const cam = m.camera;
    this.cam.setAttribute("transform", cam ? `scale(${width / cam.w}) translate(${-cam.x} ${-cam.y})` : "");
    let html = "";
    for (const e of m.elements) {
      const cls = e.visible ? (e.active ? "active" : "shown") : "hidden";
      const b = e.box;
      html +=
        `<g class="${cls}"><rect x="${b.x.toFixed(1)}" y="${b.y.toFixed(1)}" width="${b.w.toFixed(1)}" height="${b.h.toFixed(1)}" />` +
        `<text x="${(b.x + 4).toFixed(1)}" y="${(b.y + 18).toFixed(1)}">${e.id}</text></g>`;
    }
    this.cam.innerHTML = html;
  }
}
