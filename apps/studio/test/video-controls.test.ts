// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VideoControls } from "../src/video-controls.js";

// The controls exactly as the Studio page has them.
const html = readFileSync(join(import.meta.dirname, "../index.html"), "utf8");
const markup = /<div id="vc"[\s\S]*?<div class="vc-flash vc-flash-right"[^>]*><\/div>\s*<\/div>/.exec(html)![0];

const click = (el: Element, detail = 1) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, detail }));

describe("VideoControls", () => {
  let root: HTMLElement;
  let toggle: ReturnType<typeof vi.fn>;
  let skip: ReturnType<typeof vi.fn>;
  let controls: VideoControls;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = markup;
    root = document.getElementById("vc")!;
    toggle = vi.fn();
    skip = vi.fn();
    controls = new VideoControls(root, { toggle, skip });
    controls.setEnabled(true);
  });
  afterEach(() => vi.useRealTimers());

  it("skips 10 s back and forward from the buttons, with a flash on that side", () => {
    const [back, , forward] = root.querySelectorAll<HTMLElement>(".vc-btn");
    click(back!);
    expect(skip).toHaveBeenLastCalledWith(-10);
    expect(root.querySelector(".vc-flash-left")!.classList.contains("on")).toBe(true);
    expect(root.querySelector(".vc-flash-left")!.textContent).toBe("−10 s");
    click(forward!);
    expect(skip).toHaveBeenLastCalledWith(10);
    expect(root.querySelector(".vc-flash-right")!.textContent).toBe("+10 s");
    vi.advanceTimersByTime(1000);
    expect(root.querySelector(".vc-flash.on")).toBeNull();
    expect(toggle).not.toHaveBeenCalled();
  });

  it("plays and pauses from the middle button at once", () => {
    click(root.querySelector(".vc-play")!);
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("plays or pauses on a click on the picture, and skips on a double click on a side", () => {
    const zone = (name: string) => root.querySelector(`[data-zone="${name}"]`)!;
    click(zone("middle"));
    expect(toggle).not.toHaveBeenCalled(); // waits: it may be a double click
    vi.advanceTimersByTime(300);
    expect(toggle).toHaveBeenCalledTimes(1);

    click(zone("left"), 1);
    click(zone("left"), 2);
    vi.advanceTimersByTime(300);
    expect(skip).toHaveBeenLastCalledWith(-10);
    expect(toggle).toHaveBeenCalledTimes(1); // the double click did not also play or pause

    click(zone("right"), 1);
    click(zone("right"), 2);
    vi.advanceTimersByTime(300);
    expect(skip).toHaveBeenLastCalledWith(10);
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("shows the playing state, and hides itself after a moment while playing", () => {
    controls.setPlaying(true);
    expect(root.dataset.state).toBe("playing");
    expect(root.querySelector(".vc-play")!.getAttribute("aria-label")).toBe("Pause");
    vi.advanceTimersByTime(3000);
    expect(root.classList.contains("idle")).toBe(true);
    root.dispatchEvent(new Event("pointermove"));
    expect(root.classList.contains("idle")).toBe(false);
    controls.setPlaying(false);
    vi.advanceTimersByTime(3000);
    expect(root.classList.contains("idle")).toBe(false);
    expect(root.querySelector(".vc-play")!.getAttribute("aria-label")).toBe("Play");
  });

  it("does nothing visible without a video", () => {
    controls.setEnabled(false);
    expect(root.hidden).toBe(true);
  });
});
