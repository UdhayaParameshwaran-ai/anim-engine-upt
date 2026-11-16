import type { PromptSettings } from "./settings.js";

/**
 * What a video is for. The kind of explanation decides how it is planned and written: an algorithm is a run of an
 * example on data that stays on screen, a protocol is a conversation between the same parties, a comparison puts two
 * things on the same axes. The planner picks one (a `# usecase:` line in its plan); every scene call then gets that
 * use case's playbook. No extra LLM call: the choice rides on the planning call that already runs.
 */
export interface UseCase {
  name: string;
  /** When it applies, as the planner reads it. */
  when: string;
  /** How to plan the video (the planner reads this next to `when`). */
  plan: string;
  /** How to write each scene (every scene call of this video reads this). */
  scene: string;
  /** A free first guess from the topic's words; the planner confirms or changes it. */
  keywords: RegExp;
}

export const USE_CASES: readonly UseCase[] = [
  {
    name: "algorithm",
    when: "a procedure that runs step by step on data: sorting, searching, traversal, recursion, a pass over a list",
    plan: "Pick ONE small concrete example (4 to 6 values) and use it in every scene. Open on the idea or the data, never on a statistic or a cost. A title scene says what the algorithm does, then the run on that example, then the finished result and what it costs. Declare the data once in the cast and carry it, so the same values stay on screen from scene to scene. Never replace the data with icons.",
    scene:
      "Show the data itself (template=structure, one box per value, carried from the earlier scene). One compare or one swap per sentence: visit the pair, then swap it, so the viewer can follow every move; never chain several swaps in one sentence. Keep a label that names the current pass or step (pass = label \"Pass 1\") and change it with set pass to=\"Pass 2\". After each pass mark the values that are finished (mark … as=ok). Run the example all the way to its finished result; do not stop after the first pass. Say the actual values in the narration (\"4 is bigger than 2, so they swap\"). No decorative icons beside the data.",
    keywords: /\b(sort(ing)?|bubble|quick ?sort|merge ?sort|insertion|selection sort|binary search|linear search|search algorithm|algorithms?|traversal|bfs|dfs|recursion|dynamic programming|dijkstra|heap ?sort)\b/i,
  },
  {
    name: "protocol",
    when: "parties exchanging messages or requests over time: handshakes, authentication flows, request lifecycles, lookups",
    plan: "Use the same parties in every scene (declare them in the cast and carry them). One scene per phase of the conversation: the setup, the main exchange, the failure or retry, the result.",
    scene:
      "template=exchange with the parties as items and one arrow per message, in time order. Show each message with send; a lost or slow one with send fail=true or wait=…; mark the outcome ok or fail. Label arrows with the real message names (SYN, GET /, 200 OK).",
    keywords: /\b(handshake|protocols?|oauth|sso|authentication flow|auth flow|request lifecycle|dns (lookup|resolution)|tls|three-way|3-way)\b/i,
  },
  {
    name: "system",
    when: "how something is built from parts that work together: architectures, pipelines, compilers, operating systems",
    plan: "One scene for the whole picture (the parts and how they connect), then one scene per important part or stage, then one for how the parts behave together under load or when one fails. Carry the parts that stay in view.",
    scene:
      "Name each part with its real name and role. Draw the connections as labelled arrows and show data moving along them (send, stream). Use visit on the part being discussed and mark one that fails.",
    keywords: /\b(architecture|pipeline|components?|stages|how .* is built|how .* works internally|operating system|compiler)\b/i,
  },
  {
    name: "concept",
    when: "what something is and how it works as an idea: a token format, a data structure, a language feature, a field in a protocol",
    plan: "Start with the problem it solves, then its parts, then one worked example end to end, then the common mistake or limit.",
    scene:
      "Use a real example, not abstractions: show the actual value or snippet (anatomy or code) and point at each part with visit while it is named.",
    keywords: /\b(what is|what are|explain|anatomy|structure of|format)\b/i,
  },
  {
    name: "comparison",
    when: "two or more options set against each other: A vs B, which to choose, before and after",
    plan: "Show what they share, then the differences on the same few axes, then when to choose each, then a verdict. When the options change a picture (branches, a data layout, a diagram), draw the same starting picture and then the result of each option on it, so the viewer sees the difference instead of being told. Never explain an option with generic icons.",
    scene:
      "Put the same axes on each side so the eye can compare line by line. When the narration decides, mark the better side ok or strike the weaker one.",
    keywords: /\b(vs\.?|versus|difference between|differences|compare|comparison|which (one )?to (use|choose))\b/i,
  },
  {
    name: "howto",
    when: "doing something with commands or code, step by step: setting up, deploying, a workflow",
    plan: "State the goal, then the steps in order (one scene per step or small group of steps), then the visible result, then one common mistake.",
    scene:
      "Show the real commands or code (a code or terminal element), typed line by line. Each sentence is one step; show what the command changes and end on the visible result.",
    keywords: /\b(how to|set ?up|deploy(ing|ment)?|install|tutorial|step by step|commands?|workflow)\b/i,
  },
  {
    name: "lifecycle",
    when: "stages or states something goes through over time: an order, a connection, a build, a traffic light",
    plan: "One scene for the whole machine (all states and transitions), then walk one real item through it, then the unusual path (failure, timeout, retry).",
    scene:
      "template=states or steps. visit moves a ring through the stages as the item advances; mark failure or completion states.",
    keywords: /\b(state machine|lifecycle|life cycle|states of|life of|stages of)\b/i,
  },
  {
    name: "data",
    when: "numbers and what they show: performance, growth, statistics, benchmarks",
    plan: "The headline number first, then the trend or comparison that explains it, then what it means for the viewer.",
    scene:
      "Use stat, chart or comparison pages. Count a number up when it first appears and point at the bar or point being discussed.",
    keywords: /\b(statistics|stats|growth|trend|benchmark|percent|market share|revenue)\b/i,
  },
  {
    name: "history",
    when: "how something developed over time",
    plan: "A short timeline, then the two or three turning points explained, then where it stands now.",
    scene:
      "template=timeline; visit each event as its date is spoken and mark the turning point.",
    keywords: /\b(history of|timeline|evolution|origins? of)\b/i,
  },
];

export const findUseCase = (name: string | undefined): UseCase | undefined => USE_CASES.find((u) => u.name === (name ?? "").trim().toLowerCase());

/** The use case a topic's words suggest (a hint for the planner), or undefined. The order above is the order of precedence. */
export function guessUseCase(topic: string): UseCase | undefined {
  return USE_CASES.find((u) => u.keywords.test(topic));
}

/** The use case a plan names on its `# usecase:` line. */
export function useCaseOf(outline: string): UseCase | undefined {
  return findUseCase(/^\s*#\s*usecase:\s*([a-z-]+)/im.exec(outline)?.[1]);
}

/** The planner's menu: each use case, when it applies and how to plan it. */
export function useCaseCatalogue(): string {
  return USE_CASES.map((u) => `  ${u.name.padEnd(10)} ${u.when}\n             → ${u.plan}`).join("\n");
}

/** What every scene call of a video reads: the person's own playbook for the use case, else the built-in one. Empty when there is none. */
export function playbook(uc: UseCase | undefined, settings: PromptSettings = {}): string {
  if (!uc) return "";
  const own = settings.playbooks?.[uc.name];
  const text = own !== undefined ? own : uc.scene;
  return text.trim() ? `\nUSE CASE: ${uc.name} (${uc.when})\n${text.trim()}\n` : "";
}
