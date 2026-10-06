/**
 * Browser entry for the headless exporter: the same engine as live preview,
 * driven frame by frame through the render hook.
 */
import { exposeForRender, Stage } from "@anim/engine";
import type { ResolvedTimeline, VideoIR } from "@anim/ir";

const w = window as unknown as {
  __DATA__: { ir: VideoIR; timeline: ResolvedTimeline };
  __ready: Promise<boolean>;
};

const stage = new Stage(document.getElementById("stage")!, w.__DATA__.ir, w.__DATA__.timeline, { autoFit: false });
exposeForRender(stage);
w.__ready = document.fonts.ready.then(() => true);
