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
  /** A finished scene of the kind this use case needs most, shown to the one scene that needs it (never to the others). */
  example?: { template: string; text: string };
}

/** One row that stays on screen, one step per sentence, a label that changes, values marked as they are decided. Shows the pattern, not any topic. */
const SCAN_EXAMPLE = `scene scan "Finding the largest of five numbers" template=structure variant=array
c1 = box "3"
c2 = box "7"
c3 = box "2"
c4 = box "9"
c5 = box "4"
best = label "Best: 3" @above:c3
step start "The row"
> Here are {1}five numbers, and we want {2}the largest one.
1 pop c1,c2,c3,c4,c5 then fade best
2 visit c1 then visit c5
step scan "One look at each"
> We keep a best so far, and {1}start with the first number, three.
1 visit c1 then mark c1 as=ok
> {1}Seven is bigger, so {2}it becomes the new best.
1 visit c2
2 set best to="Best: 7" then mark c2 as=ok
> {1}Two is smaller, so {2}the best stays seven.
1 visit c3
2 mark c3 as=fail
> {1}Nine is bigger again, so {2}nine is the new best.
1 visit c4
2 set best to="Best: 9" then mark c4 as=ok
step result "The answer"
> {1}Four is smaller, so {2}after one look at each number, the largest is nine.
1 visit c5 then mark c5 as=fail
2 visit c4`;

/** Two options applied to the same starting row, one after the other, and set side by side at the end. Shows the pattern, not any topic. */
const ROW_EXAMPLE = `scene ops "Two ways to change one row" template=structure variant=array
c1 = box "10"
c2 = box "20"
c3 = box "30"
c4 = box "40"
note = label "Original row" @above:c2
step start "The same row"
> Here is {1}one row of four values, {2}the starting point for both options.
1 pop c1,c2,c3,c4 then fade note
2 visit c1 then visit c4
step add "Option one: add five"
> The first option {1}adds five to every value.
1 set note to="Add 5" then set c1 to="15" then set c2 to="25" then set c3 to="35" then set c4 to="45"
> {1}Every value moves up by the same amount, so the gaps between them stay the same.
1 mark c1,c2,c3,c4 as=ok
step double "Option two: double"
> Go back to {1}the original row, and apply the second option.
1 set note to="Original row" then set c1 to="10" then set c2 to="20" then set c3 to="30" then set c4 to="40"
> It {1}doubles every value, so the gaps grow too.
1 set note to="Double" then set c1 to="20" then set c2 to="40" then set c3 to="60" then set c4 to="80"
> Option one {1}shifts the row, and option two {2}stretches it.
1 visit c1 then visit c2
2 visit c3 then visit c4`;

export const USE_CASES: readonly UseCase[] = [
  {
    name: "algorithm",
    when: "a procedure that runs step by step on data: sorting, searching, traversal, recursion, a pass over a list",
    plan: "One small example (4 to 6 values) runs through the video. Open on the idea or the data, never on a statistic. The core is ONE growing scene (template=structure) that runs the example from start to finished result, one chapter per pass or round; then what it costs, then a recap.",
    scene: "One compare or one swap per sentence: visit the pair, then swap it. A label names the current pass and changes with set. Mark finished values ok after each pass and run the example to its finished result. Say the actual values in the narration. No decorative icons beside the data.",
    example: { template: "structure", text: SCAN_EXAMPLE },
    keywords: /\b(sort(ing)?|bubble|quick ?sort|merge ?sort|insertion|selection sort|binary search|linear search|search algorithm|algorithms?|traversal|bfs|dfs|recursion|dynamic programming|dijkstra|heap ?sort)\b/i,
  },
  {
    name: "protocol",
    when: "parties exchanging messages or requests over time: handshakes, authentication flows, request lifecycles, lookups",
    plan: "The same parties throughout. The core is ONE growing exchange scene (template=exchange), one chapter per phase: the setup, the main exchange, the failure or retry, the result.",
    scene:
      "template=exchange with the parties as items and one arrow per message, in time order. Show each message with send; a lost or slow one with send fail=true or wait=…; mark the outcome ok or fail. Label arrows with the real message names (SYN, GET /, 200 OK).",
    keywords: /\b(handshake|protocols?|oauth|sso|authentication flow|auth flow|request lifecycle|dns (lookup|resolution)|tls|three-way|3-way)\b/i,
  },
  {
    name: "system",
    when: "how something is built from parts that work together: architectures, pipelines, compilers, operating systems",
    plan: "The core is ONE growing scene that draws the whole system (architecture or flow), one chapter per part or stage, following one request or one piece of data through it; then how it behaves under load or when one part fails.",
    scene: "",
    keywords: /\b(architecture|pipeline|components?|stages|how .* is built|how .* works internally|operating system|compiler)\b/i,
  },
  {
    name: "concept",
    when: "what something is and how it works as an idea: a token format, a data structure, a language feature, a field in a protocol",
    plan: "Start with the problem it solves, then its parts, then one worked example end to end, then the common mistake or limit. Separate scenes are fine here.",
    scene: "",
    keywords: /\b(what is|what are|explain|anatomy|structure of|format)\b/i,
  },
  {
    name: "comparison",
    when: "two or more options set against each other: A vs B, which to choose, before and after",
    plan: "Two kinds. If the options CHANGE A PICTURE or can be RUN on data (branches, a data layout, two data structures, two algorithms, a diagram): ONE growing scene draws the shared starting point first, then applies each option to the SAME data in its own chapter (for data structures, each one's operations on the same row of values; for algorithms, both runs on the same input), so the viewer sees both results side by side; then a separate scene for when to choose each. Otherwise: what they share, the differences on the same few axes, when to choose each, a verdict. Never explain an option with generic icons.",
    scene: "",
    example: { template: "structure", text: ROW_EXAMPLE },
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
    plan: "The core is ONE growing scene (template=states or steps): the whole machine first, then one real item walked through it with visit, one chapter per stage; then the unusual path (failure, timeout, retry).",
    scene: "",
    keywords: /\b(state machine|lifecycle|life cycle|states of|life of|stages of)\b/i,
  },
  {
    name: "data",
    when: "numbers and what they show: performance, growth, statistics, benchmarks",
    plan: "The headline number first, then the trend or comparison that explains it, then what it means for the viewer. Separate scenes are fine here.",
    scene: "",
    keywords: /\b(statistics|stats|growth|trend|benchmark|percent|market share|revenue)\b/i,
  },
  {
    name: "history",
    when: "how something developed over time",
    plan: "A short timeline, then the two or three turning points explained, then where it stands now.",
    scene: "",
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

/** The example of a use case for a scene of this template, when it has one. */
export function exampleFor(uc: UseCase | undefined, template: string | undefined): string {
  return uc?.example && uc.example.template === template ? uc.example.text : "";
}
