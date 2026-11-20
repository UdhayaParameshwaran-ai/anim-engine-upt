import type { PromptSettings } from "./settings.js";
import type { Level } from "./teaching.js";

/**
 * What a video is for. The kind of explanation decides how it is planned and written: an algorithm is a run of an
 * example on data that stays on screen, a protocol is a conversation between the same parties, a comparison puts two
 * things on the same axes. The planner picks one (a `# usecase:` line in its plan); every scene call then gets that
 * use case's playbook. No extra LLM call: the choice rides on the planning call that already runs.
 *
 * A use case decides the pictures. The order of the ideas and how the words go belong to the teaching method
 * (teaching.ts): each use case names the method it uses by default and when to take another.
 */
export interface UseCase {
  name: string;
  /** When it applies, as the planner reads it. */
  when: string;
  /** How to plan the pictures of the video (the planner reads this next to `when`). The order of the ideas is the method's. */
  plan: string;
  /** The teaching method this kind of video uses unless the topic or audience calls for another (teaching.ts). */
  method: string;
  /** A different usual method for an audience level (concepts are taught to newcomers by analogy, to practitioners from a problem). */
  byLevel?: Partial<Record<Level, string>>;
  /** When to take another method instead, for the planner. */
  switch?: string;
  /** How to write each scene (every scene call of this video reads this). */
  scene: string;
  /** A free first guess from the topic's words; the planner confirms or changes it. */
  keywords: RegExp;
  /** A finished scene of the kind this use case needs most, shown to the one scene that needs it (never to the others). */
  example?: { template: string; text: string };
}

/** One row that stays on screen, one state per sentence, pointers that move, values marked as they are decided. Shows the pattern, not any topic. */
const SCAN_EXAMPLE = `scene scan "Finding the largest of five numbers" template=trace
nums = row
> Here are {1}five numbers, and we want {2}the largest one.
1 nums: 3 7 2 9 4
2 nums: 3+ 7 2 9 4 | i=0 best=0
> {1}Seven is bigger than three, so {2}it becomes the best.
1 nums: 3+ 7* 2 9 4 | i=1 best=0
2 nums: 3 7+ 2 9 4 | i=1 best=1
> {1}Two is smaller, so the best stays seven.
1 nums: 3 7+ 2* 9 4 | i=2 best=1
> {1}Nine is bigger again, so {2}it takes over.
1 nums: 3 7+ 2 9* 4 | i=3 best=1
2 nums: 3 7 2 9+ 4 | i=3 best=3
> {1}Four is smaller, so the largest is nine.
1 nums: 3 7 2 9+ 4* | i=4 best=3`;

/** Two options applied to the same starting row, each result in a panel beside it. Shows the pattern, not any topic. */
const ROW_EXAMPLE = `scene ops "Two ways to change one row" template=trace
base = row "Starting row"
add = row "Add five"
dbl = row "Double"
> Here is {1}one row of four values, the starting point for both options.
1 base: 10 20 30 40
> The first option {1}adds five to every value.
1 add: 15 25 35 45
> The second option {1}doubles every value.
1 dbl: 20 40 60 80
> Option one {1}shifts the row, and option two {2}stretches it.
1 highlight add
2 highlight dbl`;

export const USE_CASES: readonly UseCase[] = [
  {
    name: "algorithm",
    when: "a procedure that runs step by step on data or values: sorting, searching, traversal, recursion, optimization (gradient descent), a cache or hash table at work, building a heap or tree, a pass over a list",
    plan: "One small example (4 to 6 values) runs through the video. The core is ONE growing scene that is ALWAYS template=trace with shape: structure (never flow, cycle, steps or structure: those cannot show data changing) and runs the example from start to finished result, one chapter per pass or round. What it costs can have a scene of its own.",
    method: "worked-example",
    switch: "discovery when the next step can be predicted and the surprise teaches (the viewer guesses, then the run shows it)",
    scene: "Write the state after each sentence: one compare or one swap per cue, with the pointers (i, j, mid, best) where they are and the finished values marked +. Panels (a queue, a visited set, a table of distances) beside the main row show what the algorithm keeps. Run the example to its finished result, and say the actual values in the narration. No decorative icons beside the data.",
    example: { template: "trace", text: SCAN_EXAMPLE },
    keywords: /\b(sort(ing)?|bubble|quick ?sort|merge ?sort|insertion|selection sort|binary search|linear search|search algorithm|algorithms?|traversal|bfs|dfs|recursion|dynamic programming|dijkstra|heap ?sort)\b/i,
  },
  {
    name: "protocol",
    when: "parties exchanging messages or requests over time: handshakes, authentication flows, request lifecycles, lookups",
    plan: "The same parties throughout. The core is ONE growing exchange scene (template=exchange), one chapter per phase: the setup, the main exchange, the failure or retry, the result.",
    method: "causal",
    switch: "socratic when most people hold a wrong idea about it (what blocks what, who decides)",
    scene:
      "template=exchange with the parties as items and one arrow per message, in time order. Show each message with send; a lost or slow one with send fail=true or wait=…; mark the outcome ok or fail. Label arrows with the real message names (SYN, GET /, 200 OK).",
    keywords: /\b(handshake|protocols?|oauth|sso|authentication flow|auth flow|request lifecycle|dns (lookup|resolution)|tls|three-way|3-way)\b/i,
  },
  {
    name: "system",
    when: "how something is built from parts that work together: architectures, pipelines, compilers, operating systems",
    plan: "The core is ONE growing scene that draws the whole system (architecture or flow), one chapter per part or stage, following one request or one piece of data through it; how it behaves under load or when one part fails can have a scene of its own.",
    method: "causal",
    byLevel: { practitioner: "problem-based" },
    switch: "problem-based for practitioners, starting from the failure they meet at work",
    scene: "",
    keywords: /\b(architecture|pipeline|components?|stages|how .* is built|how .* works internally|operating system|compiler)\b/i,
  },
  {
    name: "concept",
    when: "what something is and how it works as an idea: a token format, a data structure, a language feature, a field in a protocol",
    plan: "Show its parts on one picture, and run one example through it end to end on screen. Separate scenes are fine here.",
    method: "feynman",
    byLevel: { new: "analogical", practitioner: "problem-based" },
    switch: "socratic when a common wrong idea is the point",
    scene: "",
    keywords: /\b(what is|what are|anatomy|structure of|format)\b/i,
  },
  {
    name: "comparison",
    when: "two or more options set against each other: A vs B, which to choose, before and after",
    plan: "Two kinds. If the options CHANGE A PICTURE or can be RUN on data (branches, a data layout, two data structures, two algorithms, a diagram): ONE growing scene draws the shared starting point first, then applies each option to the SAME data in its own chapter (for data structures, each one's operations on the same row of values; for algorithms, both runs on the same input), so the viewer sees both results side by side; then a separate scene for when to choose each. Otherwise: put the options on the same few axes in one picture (template=compare, or a table page). Never explain an option with generic icons.",
    method: "contrastive",
    scene: "",
    example: { template: "trace", text: ROW_EXAMPLE },
    keywords: /\b(vs\.?|versus|difference between|differences|compare|comparison|which (one )?to (use|choose))\b/i,
  },
  {
    name: "howto",
    when: "doing something with commands or code, step by step: setting up, deploying, a workflow",
    plan: "One scene per step or small group of steps, each showing the real command or code and what it changes, up to the visible result.",
    method: "worked-example",
    byLevel: { practitioner: "problem-based" },
    switch: "problem-based when the viewer arrives with a failure to fix",
    scene:
      "Show the real commands or code (a code or terminal element), typed line by line. Each sentence is one step; show what the command changes and end on the visible result.",
    keywords: /\b(how to|set ?up|deploy(ing|ment)?|install|tutorial|step by step|commands?|workflow)\b/i,
  },
  {
    name: "lifecycle",
    when: "stages or states something goes through over time: an order, a connection, a build, a traffic light",
    plan: "The core is ONE growing scene (template=states or steps): the whole machine first, then one real item walked through it with visit, one chapter per stage, including the unusual path (failure, timeout, retry).",
    method: "causal",
    switch: "worked-example when one real item is followed through every state",
    scene: "",
    keywords: /\b(state machine|lifecycle|life cycle|states of|life of|stages of)\b/i,
  },
  {
    name: "data",
    when: "numbers and what they show: performance, growth, statistics, benchmarks",
    plan: "Show the real numbers: a stat that counts up, a chart of the trend or the comparison. Separate scenes are fine here.",
    method: "problem-based",
    switch: "contrastive when the numbers compare two options",
    scene: "",
    keywords: /\b(statistics|stats|growth|trend|benchmark|percent|market share|revenue)\b/i,
  },
  {
    name: "history",
    when: "how something developed over time",
    plan: "A timeline scene with the two or three turning points shown on it.",
    method: "causal",
    scene: "",
    keywords: /\b(history of|timeline|evolution|origins? of)\b/i,
  },
];

export const findUseCase = (name: string | undefined): UseCase | undefined => USE_CASES.find((u) => u.name === (name ?? "").trim().toLowerCase());

/** The method a use case usually teaches with, for this audience level. */
export function defaultMethodFor(uc: UseCase | undefined, level: Level): string | undefined {
  return uc ? (uc.byLevel?.[level] ?? uc.method) : undefined;
}

/** The use case a topic's words suggest (a hint for the planner), or undefined. The order above is the order of precedence. */
export function guessUseCase(topic: string): UseCase | undefined {
  return USE_CASES.find((u) => u.keywords.test(topic));
}

/** The use case a plan names on its `# usecase:` line. */
export function useCaseOf(outline: string): UseCase | undefined {
  return findUseCase(/^\s*#\s*usecase:\s*([a-z-]+)/im.exec(outline)?.[1]);
}

/** The planner's menu: each use case, when it applies and how to plan it. */
export function useCaseCatalogue(level: Level = "familiar", pictures = true): string {
  return USE_CASES.map((u) => {
    const usual = defaultMethodFor(u, level)!;
    // The alternative is left out where the level already made it the usual method.
    const other = u.switch && !u.switch.startsWith(usual) ? ` (or ${u.switch})` : "";
    return `  ${u.name.padEnd(10)} ${u.when}${pictures ? `\n             → pictures: ${u.plan}` : ""}\n             → method: ${usual}${other}`;
  }).join("\n");
}

/** What every scene call of a video reads: the person's own playbook for the use case, else the built-in one. Empty when there is none. */
export function playbook(uc: UseCase | undefined, settings: PromptSettings = {}): string {
  if (!uc) return "";
  const own = settings.playbooks?.[uc.name];
  const text = own !== undefined ? own : uc.scene;
  return text.trim() ? `\nUSE CASE: ${uc.name} (${uc.when})\n${text.trim()}\n` : "";
}

/** The example of a use case for a scene of this template, when it has one. */
export function exampleFor(uc: UseCase | undefined, template: string | undefined): string {
  return uc?.example && uc.example.template === template ? uc.example.text : "";
}
