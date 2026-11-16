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
});
