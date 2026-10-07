/**
 * Browser entry for the headless exporter: the same engine as live preview,
 * driven frame by frame through the render hook.
 */
import { exposeForRender, Stage } from "@anim/engine";
import type { ResolvedTimeline, VideoIR } from "@anim/ir";

const w = window as unknown as {
  __DATA__: { ir: VideoIR; timeline: ResolvedTimeline };
  __FONTS__: string;
  __ready: Promise<boolean>;
};

const stage = new Stage(document.getElementById("stage")!, w.__DATA__.ir, w.__DATA__.timeline, { autoFit: false, fontBase: w.__FONTS__ });
exposeForRender(stage);
// Frames are captured only once the look's fonts are in.
w.__ready = stage.fontsReady().then(() => document.fonts.ready).then(() => true);
