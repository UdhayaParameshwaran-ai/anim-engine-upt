/**
 * The designer's scene transitions (html-templates/designer/phase1/transitions/transitions-core.js), ported to the stage: the same
 * motion, as a pure function of the transition's progress, applied to our two scene layers instead of the demo's two scenes.
 *
 * Each scene is a frame (its background and everything in it) holding its content. A transition moves, clips, blurs or turns the
 * frames, shifts the content inside them a little (parallax, so the change has depth), and draws a few pieces of its own over both
 * (the wipe's light, the iris's ring, the split's seam, the panel).
 *
 * The one thing the stage cannot copy exactly is `split`: the designer cuts the old scene into two halves that slide apart, which
 * takes two copies of the scene. Here its two halves stay where they are and the gap between them opens (a scene that shows a
 * designer's page cannot be copied: the copy would be a second page).
 */

/** How a transition shows one scene at a moment. */
export interface SceneLook {
  /** On the scene's frame. */
  transform: string;
  /** transform-origin of the frame ("" = its centre). */
  origin: string;
  opacity: number;
  filter: string;
  /** clip-path on the frame ("" = none). */
  clip: string;
  shadow: string;
  /** The frame hides its back (the cube's faces). */
  backface: boolean;
  /** Drawn on top of the other scene. */
  top: boolean;
  visible: boolean;
  /** On the content inside the frame (parallax). */
  inner: string;
  innerFilter: string;
}

export type Css = [property: string, value: string][];

/** The transition's own pieces, drawn over both scenes ([] = not shown). */
export interface Overlays {
  edge: Css;
  ring: Css;
  seam: Css;
  panel: Css;
  sheen: Css;
  /** The ripple's distortion: how strong it is (0 = none). */
  ripple: number;
}

export interface CrossLook {
  a: SceneLook;
  b: SceneLook;
  overlays: Overlays;
}

export type Direction = "left" | "right" | "up" | "down";

export interface CrossOptions {
  width: number;
  height: number;
  /** Where the scenes travel (directional transitions). Default left, as in the designer's pages. */
  dir?: Direction;
  /** The look's colours for the transition's own pieces. */
  accent: string;
  cool: string;
}

export const still = (): SceneLook => ({ transform: "", origin: "", opacity: 1, filter: "", clip: "", shadow: "", backface: false, top: false, visible: true, inner: "", innerFilter: "" });
export const noOverlays = (): Overlays => ({ edge: [], ring: [], seam: [], panel: [], sheen: [], ripple: 0 });

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const expoOut = (k: number) => (k >= 1 ? 1 : 1 - Math.pow(2, -10 * k));
/** A smooth S that is gentler at both ends than an ease-in-out. */
const silk = (k: number) => k * k * k * (k * (k * 6 - 15) + 10);
/** 0 → 1 as p goes from a to a + d. */
const win = (p: number, a: number, d: number) => clamp((p - a) / Math.max(0.001, d));
const r = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const blur = (px: number) => (px > 0.3 ? `blur(${r(px, 1)}px)` : "");
const pct = (n: number) => `${r(n * 100, 3)}%`;

/**
 * Both scenes at progress p (0 → 1) through a transition. `a` is the scene being left, `b` the one arriving; either may be
 * missing on screen (before the first scene, after the last), in which case the stage's background stands in for it.
 */
export function crossLook(type: string, p: number, o: CrossOptions): CrossLook {
  const a = still();
  const b = still();
  const ov = noOverlays();
  const { width: W, height: H } = o;
  /** px on the designer's 1920-wide stage → px on this one. */
  const k = W / 1920;
  const dir = o.dir ?? "left";
  const vx = dir === "left" ? -1 : dir === "right" ? 1 : 0;
  const vy = dir === "up" ? -1 : dir === "down" ? 1 : 0;
  const horiz = vx !== 0;
  const moving = p > 0 && p < 1;
  b.top = true;

  switch (type) {
    case "wipe": {
      // The new scene is uncovered by a soft-edged line with a thin light leading it; the old content slides away a little under a
      // slight blur while the new content slides in the other way.
      const e = silk(p);
      const rev = 1 - e;
      b.clip = e >= 1 ? "" : horiz ? (vx < 0 ? `inset(0 0 0 ${pct(rev)})` : `inset(0 ${pct(rev)} 0 0)`) : vy < 0 ? `inset(${pct(rev)} 0 0 0)` : `inset(0 0 ${pct(rev)} 0)`;
      if (moving) {
        const at = (horiz ? (vx < 0 ? rev : e) * W : (vy < 0 ? rev : e) * H) - 5 * k;
        ov.edge = [
          ["left", `${r(horiz ? at : 0)}px`],
          ["top", `${r(horiz ? 0 : at)}px`],
          ["width", `${r(horiz ? 10 * k : W)}px`],
          ["height", `${r(horiz ? H : 10 * k)}px`],
          ["opacity", String(r(Math.sin(p * Math.PI), 3))],
          ["background", `linear-gradient(${horiz ? 180 : 90}deg, ${o.accent}, ${o.cool})`],
          ["box-shadow", `0 0 ${r(50 * k)}px color-mix(in srgb, ${o.accent} 70%, transparent)`],
        ];
      }
      a.inner = `translate(${r(vx * e * 70 * k)}px, ${r(vy * e * 70 * k)}px)`;
      a.innerFilter = blur(e * 5 * k);
      b.inner = `translate(${r(-vx * rev * 120 * k)}px, ${r(-vy * rev * 120 * k)}px)`;
      break;
    }
    case "push": {
      // The new scene pushes the old one out; the old one moves less, and dims and shrinks as it goes, so the two sit at different depths.
      const e = expoOut(p) * 0.35 + silk(p) * 0.65;
      const rev = 1 - e;
      b.transform = `translate(${r(-vx * rev * W)}px, ${r(-vy * rev * H)}px)`;
      b.shadow = moving ? `${r(vx * 90 * k)}px ${r(vy * 90 * k)}px ${r(160 * k)}px rgba(0,0,0,.28)` : "";
      b.inner = `translate(${r(vx * rev * -60 * k)}px, ${r(vy * rev * -60 * k)}px)`;
      a.transform = `translate(${r(vx * e * 0.36 * W)}px, ${r(vy * e * 0.36 * H)}px) scale(${r(1 - 0.06 * e, 4)})`;
      a.opacity = 1 - 0.55 * e;
      a.filter = blur(e * 5 * k);
      break;
    }
    case "zoom": {
      // The camera flies into the old scene until it dissolves into blur; the new scene grows out of the distance into focus.
      const pa = silk(win(p, 0, 0.72));
      const pb = silk(win(p, 0.28, 0.72));
      a.top = true;
      b.top = false;
      a.transform = `scale(${r(1 + 3.2 * pa * pa, 4)})`;
      a.opacity = 1 - win(pa, 0.45, 0.55);
      a.filter = blur(pa * 22 * k);
      b.transform = `scale(${r(0.8 + 0.2 * pb, 4)})`;
      b.opacity = clamp(pb * 2);
      b.filter = blur((1 - pb) * 16 * k);
      break;
    }
    case "iris": {
      // A circle opens from the centre and the new scene fills it, a thin ring on its edge; the old scene eases back as it is covered.
      const e = silk(p) * 0.55 + expoOut(p) * 0.45;
      // the designer's 1300px on a 1920×1080 stage: a little past the corners
      const rad = e * 1.18 * Math.hypot(W, H) / 2;
      b.clip = e >= 1 ? "" : `circle(${r(rad, 1)}px at 50% 50%)`;
      if (moving && p < 0.97) {
        ov.ring = [
          ["left", `${r(W / 2 - rad, 1)}px`],
          ["top", `${r(H / 2 - rad, 1)}px`],
          ["width", `${r(rad * 2, 1)}px`],
          ["height", `${r(rad * 2, 1)}px`],
          ["opacity", String(r(1 - win(p, 0.5, 0.5), 3))],
          ["border", `${r(5 * k)}px solid color-mix(in srgb, #ffffff 75%, ${o.accent})`],
          ["box-shadow", `0 0 ${r(40 * k)}px color-mix(in srgb, ${o.accent} 50%, transparent)`],
        ];
      }
      a.transform = `scale(${r(1 - 0.07 * e, 4)})`;
      a.filter = blur(e * 4 * k);
      b.inner = `scale(${r(0.9 + 0.1 * e, 4)})`;
      break;
    }
    case "slats": {
      // The new scene arrives in eight strips that open one after another, alternating up and down, in the scenes' direction.
      const N = 8;
      const rects: string[] = [];
      let done = true;
      for (let i = 0; i < N; i++) {
        const order = (horiz ? vx < 0 : vy < 0) ? N - 1 - i : i; // the first strip is the one the motion starts from
        const e = silk(win(p, order * 0.07, 1 - (N - 1) * 0.07)); // the designer's 0.52, so the last strip lands as the change ends
        if (e < 1) done = false;
        if (e <= 0) continue;
        const up = i % 2 === 0;
        // each strip a hair wider than its share, so no seam shows between two open strips
        const [s0, s1] = horiz ? [(i * W) / N - 0.5, ((i + 1) * W) / N + 0.5] : [(i * H) / N - 0.5, ((i + 1) * H) / N + 0.5];
        const len = horiz ? H : W;
        const [l0, l1] = up ? [(1 - e) * len, len] : [0, e * len];
        const [x0, x1, y0, y1] = horiz ? [s0, s1, l0, l1] : [l0, l1, s0, s1];
        rects.push(`M${r(x0, 1)} ${r(y0, 1)}H${r(x1, 1)}V${r(y1, 1)}H${r(x0, 1)}Z`);
      }
      b.visible = rects.length > 0;
      b.clip = done ? "" : `path('${rects.join("")}')`;
      break;
    }
    case "split": {
      // The old scene parts down the middle like doors and uncovers the new one, which settles in from slightly larger.
      const e = silk(p);
      const m = e * 0.52;
      const hz = vy === 0;
      a.top = true;
      b.top = false;
      a.visible = e < 1;
      if (e > 0) {
        a.clip = hz
          ? `path('M0 0H${r((0.5 - m) * W, 1)}V${H}H0Z M${r((0.5 + m) * W, 1)} 0H${W}V${H}H${r((0.5 + m) * W, 1)}Z')`
          : `path('M0 0H${W}V${r((0.5 - m) * H, 1)}H0Z M0 ${r((0.5 + m) * H, 1)}H${W}V${H}H0Z')`;
      }
      b.transform = `scale(${r(1.1 - 0.1 * e, 4)})`;
      if (moving) {
        ov.seam = [
          ["left", `${r(hz ? W / 2 - 1.5 * k : 0)}px`],
          ["top", `${r(hz ? 0 : H / 2 - 1.5 * k)}px`],
          ["width", `${r(hz ? 3 * k : W)}px`],
          ["height", `${r(hz ? H : 3 * k)}px`],
          ["opacity", String(r(Math.sin(p * Math.PI) * 0.9, 3))],
          ["background", `linear-gradient(${hz ? 180 : 90}deg, transparent, rgba(255,255,255,.9), transparent)`],
        ];
      }
      break;
    }
    case "defocus": {
      // The old scene drifts out of focus and fades while the new one pulls into focus, with a soft bloom in the middle.
      const pa = silk(win(p, 0.1, 0.7));
      const pb = silk(win(p, 0, 0.8));
      const bloom = 1 + 0.22 * Math.sin(clamp(p) * Math.PI);
      const glow = bloom > 1.001 ? ` brightness(${r(bloom, 3)})` : "";
      a.top = true;
      b.top = false;
      a.opacity = 1 - pa;
      a.transform = `scale(${r(1 + 0.06 * pa, 4)})`;
      a.filter = pa > 0 ? `${blur(pa * 24 * k)}${glow}`.trim() : "";
      b.opacity = pb;
      b.transform = `scale(${r(0.94 + 0.06 * pb, 4)})`;
      b.filter = pb < 1 ? `${blur((1 - pb) * 24 * k)}${glow}`.trim() : "";
      break;
    }
    case "cube": {
      // The two scenes are faces of a cube that turns in 3D; the new face swings to the front.
      const axisY = horiz;
      const Z = axisY ? W / 2 : H / 2;
      const turn = axisY ? "rotateY" : "rotateX";
      const sign = axisY ? (vx < 0 ? -1 : 1) : vy < 0 ? 1 : -1;
      const face = axisY ? (vx < 0 ? 90 : -90) : vy < 0 ? -90 : 90;
      const e = silk(p);
      const ang = sign * 90 * e;
      const cube = `perspective(${r(2600 * k)}px) translateZ(${r(-Z)}px) ${turn}(${r(ang, 3)}deg)`;
      a.transform = `${cube} translateZ(${r(Z)}px)`;
      b.transform = `${cube} ${turn}(${face}deg) translateZ(${r(Z)}px)`;
      a.backface = b.backface = true;
      const dim = 1 - 0.3 * Math.sin(clamp(p) * Math.PI);
      a.filter = b.filter = dim < 0.995 ? `brightness(${r(dim, 3)})` : "";
      break;
    }
    case "panel": {
      // A block of the look's colour sweeps across and covers the frame; the scene changes behind it, and the block sweeps on and away.
      const p1 = silk(win(p, 0, 0.52));
      const p2 = silk(win(p, 0.48, 0.52));
      const fwd = horiz ? vx < 0 : vy < 0;
      b.visible = p1 >= 1;
      a.visible = p1 < 1;
      const cover = (q: number) => (horiz ? (fwd ? `inset(0 0 0 ${pct(1 - q)})` : `inset(0 ${pct(1 - q)} 0 0)`) : fwd ? `inset(${pct(1 - q)} 0 0 0)` : `inset(0 0 ${pct(1 - q)} 0)`);
      const leave = (q: number) => (horiz ? (fwd ? `inset(0 ${pct(q)} 0 0)` : `inset(0 0 0 ${pct(q)})`) : fwd ? `inset(0 0 ${pct(q)} 0)` : `inset(${pct(q)} 0 0 0)`);
      if (p > 0 && p2 < 1) {
        ov.panel = [
          ["clip-path", p1 < 1 ? cover(p1) : leave(p2)],
          ["background", `linear-gradient(135deg, ${o.accent}, color-mix(in srgb, ${o.cool} 72%, ${o.accent}))`],
        ];
        const s = -120 + 240 * (p1 < 1 ? p1 : p2);
        ov.sheen = [
          ["transform", `translate(${horiz ? r(s, 1) : 0}%, ${horiz ? 0 : r(s, 1)}%)`],
          ["background", "linear-gradient(100deg, transparent 32%, rgba(255,255,255,.3) 50%, transparent 68%)"],
        ];
      }
      break;
    }
    case "ripple": {
      // The old scene dissolves into the new one through a wave of distortion that swells at the middle of the change and calms again.
      const s = Math.sin(clamp(p) * Math.PI);
      b.opacity = silk(win(p, 0.2, 0.6));
      ov.ripple = s > 0.01 ? s : 0;
      a.transform = b.transform = `scale(${r(1 + 0.05 * s, 4)})`;
      break;
    }
    default: {
      // Not one of the designer's (an old script's IR): the new scene simply replaces the old one halfway.
      a.visible = p < 0.5;
      b.visible = p >= 0.5;
    }
  }
  return { a, b, overlays: ov };
}
