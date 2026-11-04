/**
 * Template cards: what each template means and when to use it, the single
 * source for the LLM prompts, the validator's misfit checks, the layout
 * engine's variant choice and the gallery.
 *
 * A scene's *shape* is the relationship it shows. The outline pass labels
 * every scene with one of these (a short fixed list, however many templates
 * there are); the router then offers only the templates of that shape.
 */
export const SHAPES = {
  intro: "the opening headline of the video (first scene only)",
  sequence: "stages that happen one after another in time (first, then, finally); not a set of options or methods",
  loop: "stages that repeat: the last leads back to the first",
  compare: "two things side by side: versus, before/after, pros/cons",
  "many-to-one": "several inputs or ingredients combine into one result (what a fire needs to burn, what a cake is made of)",
  "one-to-many": "one source produces or splits into several outputs",
  transform: "inputs go through a process and come out as outputs",
  hub: "aspects or factors of one abstract idea, each related to it (what makes a startup succeed, what affects health)",
  collection: "kinds, types, examples, options or methods of equal weight, in no order, each with a picture",
  timeline: "events with a date or year each, in chronological order",
  focus: "the physical parts of one object, labelled on its picture (parts of the heart, a leaf, a cell)",
  graph: "branches, decisions or dependencies between nodes",
} as const;

export type Shape = keyof typeof SHAPES;

export interface VariantGuide {
  /** When this arrangement fits, in a few words. */
  when: string;
  /** Item counts it lays out cleanly with typical labels (inclusive). */
  items?: readonly [number, number];
}

export interface TemplateGuide {
  shape: Shape;
  useWhen: string;
  avoidWhen: string;
  variants: Record<string, VariantGuide>;
  /** A minimal scene (scene line, elements, one narration line, actions). */
  example: string;
}

export const TEMPLATE_GUIDES: Record<string, TemplateGuide> = {
  title: {
    shape: "intro",
    useWhen: "the first scene: the headline with at most 3 small visuals",
    avoidWhen: "it is not the first scene; a closing takeaway → a grid page (quote, bullets or stat) or a diagram that recaps",
    variants: {
      center: { when: "a single headline, optional subtitle and up to 3 icons below", items: [0, 3] },
      left: { when: "a left-aligned headline with 1–3 visuals stacked beside it", items: [0, 3] },
      split: { when: "headline and one supporting visual given equal halves", items: [0, 2] },
    },
    example: `scene intro "Photosynthesis" template=title
title = title "Photosynthesis"
subtitle = text "How plants make food from light"
> {1}Plants make their own food {2}from sunlight.
1 write title
2 fade subtitle`,
  },
  compare: {
    shape: "compare",
    useWhen: "exactly two things are contrasted: A vs B, before/after, problem/solution",
    avoidWhen: "three or more things → cards or hub",
    variants: {
      side: { when: "two things of equal weight, side by side" },
      stacked: { when: "two wide things (long text, charts) one above the other" },
      diagonal: { when: "a before → after or problem → solution contrast" },
      asymmetric: { when: "one side matters more (set emphasis=left|right)" },
    },
    example: `scene cells "Two kinds of cell" template=compare
title = title "Plant vs animal cells"
left = asset:cell.plant "Plant cell"
right = asset:cell.animal "Animal cell"
> {1}A plant cell has a wall; {2}an animal cell does not.
1 write title then fade left
2 fade right`,
  },
  steps: {
    shape: "sequence",
    useWhen: "2–6 stages in a fixed order, each happening after the previous (draw arrows between them)",
    avoidWhen: "the items are options, methods or kinds with no order → cards; the last stage leads back to the first → cycle; stages branch → flow",
    variants: {
      row: { when: "2–5 steps with short labels, read left to right", items: [2, 5] },
      zigzag: { when: "4–6 steps; alternating heights add rhythm", items: [3, 6] },
      column: { when: "2–4 steps with long text, read top to bottom", items: [2, 4] },
      staircase: { when: "growth or progress: each step builds on the last", items: [3, 5] },
      grid: { when: "5–6 steps that do not fit one row", items: [4, 6] },
      arch: { when: "steps that rise to a peak in the middle and come back down", items: [3, 6] },
    },
    example: `scene stages "From seed to tree" template=steps
title = title "From seed to tree"
s1 = icon:droplet "Water the seed"
s2 = icon:sun "It sprouts"
s3 = asset:tree "It grows"
a1 = arrow s1->s2
a2 = arrow s2->s3
> {1}Water the seed, {2}it sprouts, {3}and it grows.
1 write title then pop s1
2 draw a1 then pop s2
3 draw a2 then pop s3`,
  },
  cycle: {
    shape: "loop",
    useWhen: "3–6 stages that repeat forever (water cycle, life cycle, feedback loop)",
    avoidWhen: "the process has an end → steps",
    variants: {
      ring: { when: "a closed loop of 3–6 stages, optional centre element", items: [3, 6] },
      arc: { when: "3–5 stages along a rising arc, the loop implied", items: [3, 5] },
    },
    example: `scene loop "The water cycle" template=cycle
center = asset:earth "Earth"
c1 = icon:sun "Evaporation"
c2 = icon:cloud "Condensation"
c3 = icon:droplet "Rain"
> {1}Water rises, {2}forms clouds {3}and falls again.
1 fade center then pop c1
2 pop c2
3 pop c3`,
  },
  flow: {
    shape: "graph",
    useWhen: "branches, decisions or dependencies: a node can have several next nodes",
    avoidWhen: "a straight line of stages → steps",
    variants: {
      auto: { when: "let the engine choose the direction from the depth" },
      down: { when: "decision trees and hierarchies, up to 4 levels deep" },
      across: { when: "long chains of 5 or more levels, up to 7 nodes", items: [3, 7] },
    },
    example: `scene decide "What next?" template=flow
n1 = node "Hungry?"
n2 = node "Eat"
n3 = node "Keep working"
e1 = n1 -> n2 "yes"
e2 = n1 -> n3 "no"
> {1}If you are hungry, {2}eat; {3}otherwise keep working.
1 pop n1
2 draw e1 then pop n2
3 draw e2 then pop n3`,
  },
  timeline: {
    shape: "timeline",
    useWhen: "2–7 events, each item starting with its date or year (\"1969 · ARPANET\")",
    avoidWhen: "the stages have no dates → steps; never pad it with undated items",
    variants: {
      alternate: { when: "4–7 dated events, labels above and below the line", items: [3, 7] },
      line: { when: "2–5 events with short labels on one line", items: [2, 5] },
      vertical: { when: "events with long descriptions, top to bottom", items: [2, 5] },
    },
    example: `scene history "Vaccines" template=timeline
t1 = box "1796 · First vaccine"
t2 = box "1955 · Polio vaccine"
t3 = box "2020 · mRNA vaccines"
> {1}The first vaccine came in 1796, {2}polio in 1955, {3}mRNA in 2020.
1 pop t1
2 pop t2
3 pop t3`,
  },
  hub: {
    shape: "hub",
    useWhen: "one abstract idea with 2–8 aspects or factors that each relate to it",
    avoidWhen: "the items are physical parts of one object → spotlight; ingredients that combine into a result → converge; kinds or examples → cards",
    variants: {
      ring: { when: "a central idea with 3–8 aspects around it", items: [3, 8] },
      sides: { when: "2–6 aspects in two groups left and right (e.g. pros and cons)", items: [2, 6] },
    },
    example: `scene parts "What a cloud app needs" template=hub
center = icon:cloud "Cloud app"
h1 = icon:server "Servers"
h2 = icon:database "Data"
h3 = icon:user "Users"
> {1}A cloud app needs {2}servers, {3}data {4}and users.
1 pop center
2 pop h1
3 pop h2
4 pop h3`,
  },
  cards: {
    shape: "collection",
    useWhen: "2–9 kinds, types, examples, options or methods of equal weight, each a picture with a label",
    avoidWhen: "the items have an order → steps; they are parts of one central idea → hub; numbers, quotes or bullet text → a grid page",
    variants: {
      auto: { when: "2–9 equal cards in rows", items: [2, 9] },
      feature: { when: "one hero card (emphasis=) plus 2–4 supporting ones", items: [3, 5] },
      strip: { when: "2–4 cards in a single row", items: [2, 4] },
    },
    example: `scene sources "Energy sources" template=cards
title = title "Energy sources"
g1 = icon:sun "Solar"
g2 = icon:wind "Wind"
g3 = icon:droplet "Hydro"
> {1}Clean energy comes from {2}the sun, {3}wind {4}and water.
1 write title
2 pop g1
3 pop g2
4 pop g3`,
  },
  spotlight: {
    shape: "focus",
    useWhen: "one large picture (an asset with parts) and labels that name its parts",
    avoidWhen: "several pictures of equal weight → cards",
    variants: {
      center: { when: "one visual with 2–6 labels on both sides", items: [0, 6] },
      left: { when: "visual on the left, a column of 1–4 labels on the right", items: [0, 4] },
      right: { when: "visual on the right, a column of 1–4 labels on the left", items: [0, 4] },
    },
    example: `scene heart "The heart" template=spotlight
main = asset:heart.anatomy "Heart"
l1 = label "Atria"
l2 = label "Ventricles"
> {1}The heart has {2}two atria {3}and two ventricles.
1 fade main
2 write l1
3 write l2`,
  },
  converge: {
    shape: "many-to-one",
    useWhen: "2–5 inputs combine into one result (ingredients → dish, causes → effect)",
    avoidWhen: "the inputs happen in order → steps; something also comes out → process",
    variants: {
      left: { when: "2–3 inputs read left to right into the result", items: [2, 3] },
      top: { when: "2–4 inputs above, falling into the result below", items: [2, 4] },
      around: { when: "3–5 equal inputs surrounding the result", items: [3, 5] },
    },
    example: `scene need "What a plant needs" template=converge
result = asset:leaf "Leaf"
i1 = icon:sun "Sunlight"
i2 = icon:droplet "Water"
a1 = arrow i1->result
a2 = arrow i2->result
> {1}A leaf needs {2}sunlight {3}and water.
1 fade result
2 pop i1 then draw a1
3 pop i2 then draw a2`,
  },
  diverge: {
    shape: "one-to-many",
    useWhen: "one source produces or splits into 2–5 outputs (uses, effects, products)",
    avoidWhen: "the outputs are just related aspects with no flow → hub",
    variants: {
      right: { when: "2–3 outputs read left to right from the source", items: [2, 3] },
      bottom: { when: "2–4 outputs below the source", items: [2, 4] },
      around: { when: "3–5 equal outputs surrounding the source", items: [3, 5] },
    },
    example: `scene uses "What glucose does" template=diverge
source = icon:cube "Glucose"
o1 = icon:bolt "Energy"
o2 = asset:tree "Growth"
a1 = arrow source->o1
a2 = arrow source->o2
> {1}Glucose gives the plant {2}energy {3}and growth.
1 fade source
2 draw a1 then pop o1
3 draw a2 then pop o2`,
  },
  process: {
    shape: "transform",
    useWhen: "inputs go through one process and come out as different outputs (a reaction, a machine, a recipe)",
    avoidWhen: "nothing comes out → converge; several stages → steps",
    variants: {
      across: { when: "1–4 inputs and 1–4 outputs left to right, the default", items: [2, 6] },
      down: { when: "inputs on top, process in the middle, outputs below; short labels", items: [2, 6] },
      equation: { when: "a reaction or formula on one line: in + in → process → out + out", items: [2, 5] },
    },
    example: `scene make "Making food" template=process
i1 = icon:sun "Light"
i2 = icon:droplet "Water"
process = asset:leaf "Photosynthesis"
o1 = icon:cube "Glucose"
a1 = arrow i1->process
a2 = arrow i2->process
a3 = arrow process->o1
> {1}Light and water enter the leaf {2}and come out as glucose.
1 pop i1 then pop i2 then draw a1 then draw a2 then fade process
2 draw a3 then pop o1`,
  },
};
