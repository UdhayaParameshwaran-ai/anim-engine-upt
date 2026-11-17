import type { PromptSettings } from "./settings.js";

/**
 * The prompts a person may rewrite. Each has a default text in which the parts the program generates
 * (the verb list, the templates, the pictures, the numbers a setting controls) are slots written {{name}};
 * an edited text keeps its slots, so it follows the registry when it changes.
 */
export const PROMPT_IDS = ["outline.system", "outline.user", "canvas.outline", "scene.system", "scene.user", "repair", "improve", "choose.system", "choose.user"] as const;
export type PromptId = (typeof PROMPT_IDS)[number];

/** Prompts of the one-call mode: built the same way but not offered for editing (every scene is written by its own call). */
type InternalPromptId = "single.system" | "single.user";

export const isPromptId = (v: unknown): v is PromptId => typeof v === "string" && (PROMPT_IDS as readonly string[]).includes(v);

/** Collects the generated parts while a prompt is built, then applies the person's version of it. */
export class Slots {
  private readonly values = new Map<string, string>();
  constructor(
    private readonly id: PromptId | InternalPromptId,
    private readonly settings: PromptSettings,
  ) {}

  /** A generated part: its value now, or its `{{name}}` slot when the default text is being shown. */
  v(name: string, value: string | number): string {
    const s = String(value);
    this.values.set(name, s);
    return this.settings.tokens ? `{{${name}}}` : s;
  }

  /** The built text, or the person's text with its slots filled in. */
  done(built: string): string {
    const mine = isPromptId(this.id) ? this.settings.prompts?.[this.id] : undefined;
    if (this.settings.tokens || !mine) return built;
    return mine.replace(/\{\{([a-z0-9_]+)\}\}/g, (whole, name: string) => this.values.get(name) ?? whole);
  }

  /** The slots this prompt had when it was built, for checking a person's text. */
  names(): string[] {
    return [...this.values.keys()];
  }
}

/** The slots a text uses that no prompt of that id has (typos), so the Studio can warn. */
export function unknownSlots(text: string, known: readonly string[]): string[] {
  return [...new Set([...text.matchAll(/\{\{([a-z0-9_]+)\}\}/g)].map((m) => m[1]!))].filter((n) => !known.includes(n));
}

export interface PromptInfo {
  title: string;
  stage: "Planning" | "Writing scenes" | "Checking";
  about: string;
}

export const PROMPT_INFO: Record<PromptId, PromptInfo> = {
  "outline.system": { title: "Planner: system prompt", stage: "Planning", about: "What the planner knows: the line format, the shapes and templates, the page layouts and the planning rules." },
  "outline.user": { title: "Planner: request", stage: "Planning", about: "The message that asks for the plan: topic, how to open and end, how many scenes." },
  "canvas.outline": { title: "Planner: one growing diagram", stage: "Planning", about: "The request when the whole video is one diagram that grows chapter by chapter." },
  "choose.system": { title: "Shape choice: system prompt", stage: "Planning", about: "The short call that picks one growing diagram or several scenes (mode Auto)." },
  "choose.user": { title: "Shape choice: request", stage: "Planning", about: "Its question about the topic." },
  "scene.system": { title: "Scene writer: system prompt", stage: "Writing scenes", about: "What each scene call knows: the script language, the rules for the chosen template, the verbs and the pictures." },
  "scene.user": { title: "Scene writer: request", stage: "Writing scenes", about: "The message that asks for one scene: the outline, what earlier scenes said, the template card." },
  repair: { title: "Repair: errors", stage: "Checking", about: "Sent with a scene that has errors." },
  improve: { title: "Repair: weak scene", stage: "Checking", about: "Sent with a valid scene that has quality problems." },
};

/** What each slot holds. A removed required slot is warned about: the model would lose that part. */
export const SLOT_INFO: Record<string, { about: string; required?: boolean }> = {
  topic: { about: "the topic the person typed", required: true },
  opening: { about: "how the video opens (chosen from the topic and the Director)" },
  closing: { about: "how the video ends" },
  variety: { about: "templates the last videos used, with a nudge to vary" },
  planning_advice: { about: "planning advice (Planning settings; empty at standard length)" },
  usecases: { about: "the use cases the planner chooses from, each with how to plan it", required: true },
  usecase_hint: { about: "the use case the topic's words suggest" },
  playbook: { about: "how scenes of the planned use case are written (Scene writing settings)" },
  house_style: { about: "audience, tone, language and notes from the settings above" },
  scenes: { about: "the scene range (Length or Scenes setting)", required: true },
  chapters: { about: "the chapter range of a growing diagram" },
  max_words: { about: "most words per sentence (Writing scenes setting)" },
  sentences: { about: "sentences per scene (Writing scenes setting)" },
  compose_patterns: { about: "the names of the compose patterns" },
  verbs: { about: "every verb with its category and summary", required: true },
  style_menu: { about: "the looks and motions to choose from, with the transitions" },
  templates: { about: "every template with when to use it", required: true },
  layouts: { about: "the layouts and their slot sizes" },
  slot_hints: { about: "the @slot names and relations" },
  element_kinds: { about: "every element kind with its summary", required: true },
  grid_elements: { about: "the page elements of grid scenes" },
  pictures: { about: "the available pictures", required: true },
  example: { about: "a complete example script" },
  shape_table: { about: "each scene shape with its templates", required: true },
  page_elements: { about: "page elements with the smallest slot each needs" },
  domain_plan: { about: "the extra planning text of the chosen domain" },
  scene_line: { about: "the scene line format of the planned template", required: true },
  edge_line: { about: "the edge line format (flow templates only)" },
  template_rules: { about: "the rules and motion hints of the planned template (Writing scenes settings)", required: true },
  elements: { about: "the element kinds of the planned template, or the page layout", required: true },
  outline: { about: "the whole planned outline", required: true },
  earlier_scenes: { about: "what earlier scenes already said" },
  template_card: { about: "the planned template's card, with an example" },
  scene_example: { about: "a finished scene of the use case's kind, shown only to the scene that needs it" },
  recurring: { about: "recurring elements (the cast)" },
  carried: { about: "elements carried from the previous scene" },
  task: { about: "the instruction to write this scene (or its chapters)", required: true },
  scene: { about: "the scene with line numbers", required: true },
  diagnostics: { about: "the errors or problems found", required: true },
};
