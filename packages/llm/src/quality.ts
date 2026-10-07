import { compile } from "@anim/compiler";

/**
 * Quality checks for a scene that compiles: problems the validator lets
 * through because the script is valid, but the video would be weak or
 * misleading. Each issue reads like a diagnostic so it can go straight
 * into a repair prompt.
 */
export interface QualityIssue {
  code: "Q1" | "Q2" | "Q3";
  /** Scene-relative line, when the issue belongs to one element. */
  line?: number;
  message: string;
}

/** Kinds that carry meaning by themselves (a picture, data or a diagram node). */
const VISUAL = new Set(["icon", "asset", "chart", "node", "formula"]);
/** Kinds that only frame or connect. */
const FRAME = new Set(["title", "footer", "arrow", "line", "edge"]);
/** Attributions that name nobody in particular. */
const VAGUE = /^\W*(an?\s+)?(unknown|anonymous|someone|expert|scientist|researcher|atmospheric scientist|professor|doctor|teacher|historian|author|source)s?\W*$/i;

export function qualityIssues(header: string, sceneText: string): QualityIssue[] {
  const offset = header.split("\n").length;
  const { script, diagnostics } = compile(`${header}\n${sceneText}\n`);
  const scene = script.scenes[0];
  if (!scene) return [];
  const issues: QualityIssue[] = [];
  const elements = scene.steps.flatMap((s) => s.elements);

  // Q1: a diagram made only of boxes and words.
  const content = elements.filter((e) => !FRAME.has(e.kind));
  if (!scene.attrs.grid && scene.attrs.template !== "flow" && content.length >= 2 && !content.some((e) => VISUAL.has(e.kind))) {
    issues.push({ code: "Q1", message: `scene \`${scene.id}\` shows only boxes and text; show the ideas with listed icons or assets whose meaning matches their labels` });
  }

  // Q2: assets that will render as grey placeholders.
  for (const d of diagnostics) {
    if (d.code === "NAR306" && d.fixed?.includes("placeholder")) {
      issues.push({ code: "Q2", line: d.span.line - offset, message: `${d.message}; it will render as a grey placeholder, so use a listed asset instead` });
    }
  }

  // Q3: quotes nobody can be held to.
  for (const e of elements) {
    if (e.kind !== "quote") continue;
    const who = e.texts[1]?.trim() ?? "";
    if (!who || VAGUE.test(who)) {
      issues.push({ code: "Q3", line: e.span.line - offset, message: `quote \`${e.id}\` is attributed to ${who ? `"${who}"` : "nobody"}; quote a real, named person's actual words, or use callout/body instead` });
    }
  }
  return issues;
}

/** Issues as report lines, matching the diagnostic format used in repair prompts. */
export function qualityReport(issues: QualityIssue[]): string {
  return issues.map((q) => `${q.line ? `L${q.line} ` : ""}${q.code} quality: ${q.message}`).join("\n");
}
