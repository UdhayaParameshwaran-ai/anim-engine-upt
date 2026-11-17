import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const html = readFileSync(join(import.meta.dirname, "../index.html"), "utf8");

describe("studio page", () => {
  it("uses data-tab only for the two main tabs, so the settings sheet's own tabs never switch the page", () => {
    const names = [...html.matchAll(/\sdata-tab="([^"]+)"/g)].map((m) => m[1]);
    expect(names.sort()).toEqual(["generate", "script"]);
    // Each main tab has its section, and the sheet's tabs have their panes.
    for (const n of names) expect(html).toContain(`id="tab-${n}"`);
    for (const t of [...html.matchAll(/data-sheet-tab="([^"]+)"/g)].map((m) => m[1])) expect(html, t).toContain(`data-pane="${t}"`);
  });

  it("has the history panel and both buttons that open it", () => {
    for (const id of ["history", "history-list", "history-count", "history-btn", "script-history", "gen-log"]) expect(html, id).toContain(`id="${id}"`);
  });

  it("keeps the key-status code away from the play button, which also carries data-state", () => {
    const main = readFileSync(join(import.meta.dirname, "../src/main.ts"), "utf8");
    expect(html).toMatch(/id="play"[^>]*data-state=/);
    // Every data-state selector in the script must be scoped, never the bare attribute.
    expect(main).not.toMatch(/querySelectorAll[^)]*\(\s*"\[data-state\]"/);
    for (const el of html.matchAll(/<small class="key-state" data-state="/g)) expect(el[0]).toContain("key-state");
  });
});
