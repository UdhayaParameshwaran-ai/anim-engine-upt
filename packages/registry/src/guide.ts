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
  interaction: "messages passed between parties over time: a request and its response, a handshake, a login",
  architecture: "a system's components and how they connect, grouped into tiers (client, servers, data)",
  layers: "layers stacked on each other, each built on the one below (network layers, a software stack)",
  structure: "a data structure and what happens to its values (array, linked list, stack, queue)",
  code: "real code, a query, a config or terminal commands, walked through line by line",
  hierarchy: "parents and their children: a file system, DNS, the DOM, an org chart, class inheritance",
  states: "the states something can be in and the events that move it between them (a TCP connection, an order, a traffic light)",
  branching: "a history that branches and merges (Git branches, merge vs rebase, versions)",
  format: "the parts of one message or format laid side by side (a URL, a packet's header and payload, a JWT, an email address)",
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
    useWhen: "2–6 stages in a fixed order, each happening after the previous",
    avoidWhen: "the items are options, methods or kinds with no order → cards; the last stage leads back to the first → cycle; stages branch → flow",
    variants: {
      row: { when: "2–5 steps with short labels, read left to right", items: [2, 5] },
      zigzag: { when: "4–6 steps; alternating heights add rhythm", items: [3, 6] },
      column: { when: "2–4 steps with long text, read top to bottom", items: [2, 4] },
      staircase: { when: "growth or progress: each step builds on the last", items: [3, 5] },
      grid: { when: "5–6 steps that do not fit one row", items: [4, 6] },
      arch: { when: "steps that rise to a peak in the middle and come back down", items: [3, 6] },
      pipeline: { when: "stages that data or work flows through, joined as one pipeline (CI/CD, ETL, a compiler)", items: [3, 6] },
    },
    example: `scene stages "From seed to tree" template=steps
title = title "From seed to tree"
s1 = icon:droplet "Water the seed"
s2 = icon:sprout "It sprouts"
s3 = asset:tree "It grows"
> {1}Water the seed, {2}it sprouts, {3}and it grows.
1 write title then pop s1
2 pop s2
3 pop s3`,
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
> {1}A leaf needs {2}sunlight {3}and water.
1 fade result
2 pop i1
3 pop i2`,
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
> {1}Glucose gives the plant {2}energy {3}and growth.
1 fade source
2 pop o1
3 pop o2`,
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
> {1}Light and water enter the leaf {2}and come out as glucose.
1 pop i1,i2 /0.2 then fade process
2 pop o1`,
  },

  // ------------------------------------------------- software & tech concepts

  exchange: {
    shape: "interaction",
    useWhen: "a sequence diagram: 2–5 parties exchange messages in order: a request and its response, a handshake, a login, a lookup",
    avoidWhen: "the parties and their links matter, not the order of messages → architecture; one thing passes through stages → steps",
    variants: {
      lanes: { when: "2–5 parties with up to 8 messages, labels like GET /users or 200 OK", items: [2, 5] },
      compact: { when: "2–3 parties and up to 4 messages, with bigger pictures", items: [2, 3] },
    },
    example: `scene request "Loading a page" template=exchange
browser = icon:globe "Browser"
server = icon:server "Web server"
db = icon:database "Database"
m1 = arrow browser->server "GET /home"
m2 = arrow server->db "SELECT posts"
m3 = arrow db->server "rows"
m4 = arrow server->browser "200 OK"
> The {1}browser asks the {2}server for the page.
1 pop browser
2 pop server then send m1
> The server {1}asks the database and {2}gets the rows back.
1 pop db then send m2
2 send m3
> Then it {1}sends the finished page to the browser.
1 send m4`,
  },
  architecture: {
    shape: "architecture",
    useWhen: "a system's components and their connections, grouped into tiers or zones (client, edge, services, data)",
    avoidWhen: "the order of messages is the point → exchange; layers built on each other → stack",
    variants: {
      tiers: { when: "zones as columns, left to right (client → servers → data); 2–4 zones, up to 10 components", items: [2, 14] },
      layers: { when: "zones as rows, top to bottom (users above, infrastructure below)", items: [2, 12] },
    },
    example: `scene system "A web app" template=architecture
client = zone "Client"
browser = icon:globe "Browser"
backend = zone "Backend"
api = icon:server "API server"
cache = icon:zap "Cache"
data = zone "Data"
db = icon:database "Database"
l1 = arrow browser->api "HTTPS"
l2 = arrow api->cache
l3 = arrow api->db "SQL"
> Users reach the app from a {1}browser.
1 pop browser
> Requests go to the {1}API server, {2}which checks a cache first.
1 pop api then draw l1
2 pop cache then draw l2
> Anything missing comes from the {1}database.
1 pop db then draw l3
end send l1`,
  },
  stack: {
    shape: "layers",
    useWhen: "2–7 layers stacked on each other, each built on or using the one below (network layers, a software stack, abstraction levels)",
    avoidWhen: "the layers happen one after another in time → steps; the parts are equal and unordered → cards",
    variants: {
      bands: { when: "full-width bands, top layer first; box items with a short label each", items: [2, 7] },
      centered: { when: "a narrower stack in the middle, 2–5 layers", items: [2, 5] },
    },
    example: `scene layers "The web stack" template=stack
app = box "Your app"
http = box "HTTP"
tcp = box "TCP"
ip = box "IP"
> Your {1}app talks HTTP, which {2}rides on TCP.
1 fade app then fade http
2 fade tcp
> And TCP is carried by {1}IP across the internet.
1 fade ip`,
  },
  structure: {
    shape: "structure",
    useWhen: "a data structure made of 2–8 values (array, linked list, stack, queue) and what happens to them: adding, removing, finding, sorting",
    avoidWhen: "a hierarchy of parent and children → flow; parts of an idea → hub",
    variants: {
      array: { when: "values in a row with their indexes; pointers above cells (binary search, sorting)", items: [2, 8] },
      list: { when: "a linked list: each node points to the next", items: [2, 6] },
      stack: { when: "a stack: values piled bottom to top, push and pop at the top", items: [2, 6] },
      queue: { when: "a queue: values in line, joining at the back and leaving from the front", items: [2, 7] },
    },
    example: `scene search "Binary search" template=structure variant=array
c1 = box "3"
c2 = box "8"
c3 = box "15"
c4 = box "23"
c5 = box "42"
mid = label "mid" @above:c3
> A {1}sorted array lets us search fast.
1 pop c1,c2,c3,c4,c5 /0.1
> We look at the {1}middle value first.
1 fade mid then highlight c3
> 42 is bigger, so we {1}move right.
1 move mid @above:c5`,
  },
  tree: {
    shape: "hierarchy",
    useWhen: "parents and their children, 3–12 nodes: folders, DNS, the DOM, an org chart, class inheritance",
    avoidWhen: "the order of stages matters → steps; a decision with branches → flow; a central idea with aspects → hub",
    variants: {
      down: { when: "root at the top, children below; up to 4 levels", items: [3, 12] },
      right: { when: "root at the left, children to the right: long labels (paths, names)", items: [3, 10] },
    },
    example: `scene files "A project's folders" template=tree
root = icon:folder "project"
src = icon:folder "src"
docs = icon:folder "docs"
app = icon:file "app.js"
util = icon:file "utils.js"
readme = icon:file-text "README.md"
l1 = line root->src
l2 = line root->docs
l3 = line src->app
l4 = line src->util
l5 = line docs->readme
> A {1}project folder holds {2}source code and {3}docs.
1 pop root
2 pop src then draw l1
3 pop docs then draw l2
> The {1}source folder has two files, and {2}docs has a readme.
1 pop app,util then draw l3,l4
2 pop readme then draw l5`,
  },
  states: {
    shape: "states",
    useWhen: "2–8 states and the events that move something between them: a connection, an order, a login session, a traffic light",
    avoidWhen: "one-way stages that never return → steps; a yes/no decision → flow",
    variants: {
      across: { when: "states left to right; transitions back curve above", items: [2, 6] },
      down: { when: "states top to bottom: many states or long names", items: [3, 8] },
    },
    example: `scene order "An order's life" template=states
placed = node "Placed"
paid = node "Paid"
shipped = node "Shipped"
done = node "Delivered"
t1 = arrow placed->paid "pay"
t2 = arrow paid->shipped "ship"
t3 = arrow shipped->done "deliver"
t4 = arrow paid->placed "refund"
> An order starts {1}placed, and {2}paying moves it on.
1 pop placed
2 pop paid then draw t1
> Then it is {1}shipped and {2}delivered.
1 pop shipped then draw t2
2 pop done then draw t3
> A {1}refund sends it back to placed.
1 draw t4 then highlight placed`,
  },
  gitgraph: {
    shape: "branching",
    useWhen: "commits on 1–3 branches that split and merge: Git branches, merge vs rebase, release lines",
    avoidWhen: "a history without branches → timeline; plain ordered steps → steps",
    variants: {
      lanes: { when: "each branch a lane, time left to right; up to 3 lanes and 10 commits", items: [2, 14] },
    },
    example: `scene branch "A feature branch" template=gitgraph
main = zone "main"
c1 = circle "init"
c2 = circle "login"
c3 = circle "merge"
feature = zone "feature"
f1 = circle "form"
f2 = circle "tests"
l1 = line c1->c2
l2 = line c2->f1
l3 = line f1->f2
l4 = line f2->c3
l5 = line c2->c3
> The {1}main branch has two commits.
1 pop c1,c2 then draw l1
> A {1}feature branch adds a form and tests.
1 pop f1,f2 then draw l2,l3
> Then it is {1}merged back into main.
1 pop c3 then draw l4,l5`,
  },
  anatomy: {
    shape: "format",
    useWhen: "the 2–7 parts of one message or format: a URL, an HTTP request, a packet's header and payload, a JWT, an email address",
    avoidWhen: "layers built on each other → stack; parts of a physical object → spotlight",
    variants: {
      bar: { when: "parts side by side on one bar, each named by a label @below:<part>; short parts", items: [2, 6] },
      stacked: { when: "parts as rows (a header above a body, nested fields); long parts", items: [2, 7] },
    },
    example: `scene url "Parts of a URL" template=anatomy
p1 = box "https://"
p2 = box "shop.example.com"
p3 = box "/products"
p4 = box "?id=42"
n1 = label "protocol" @below:p1
n2 = label "domain" @below:p2
n3 = label "path" @below:p3
n4 = label "query" @below:p4
> A URL starts with the {1}protocol and the {2}domain.
1 fade p1 then fade n1
2 fade p2 then fade n2
> Then comes the {1}path and the {2}query.
1 fade p3 then fade n3
2 fade p4 then fade n4`,
  },
  code: {
    shape: "code",
    useWhen: "real code, a query, a config file or terminal commands, walked through line by line (up to 14 lines)",
    avoidWhen: "the idea matters, not the syntax → a diagram template",
    variants: {
      notes: { when: "the code on the left, 1–4 short notes stacked beside it", items: [0, 4] },
      stacked: { when: "wide code on top, notes in a row below", items: [0, 3] },
      split: { when: "code next to its output: the item is a terminal or a second code panel", items: [1, 1] },
    },
    example: `scene fetch "Calling an API" template=code
code = code "const res = await fetch(url);\\nconst data = await res.json();\\nshow(data.items);" lang=js
n1 = label "Ask the server"
n2 = label "Read the JSON reply"
> First we {1}ask the server for data.
1 write code.1 then fade n1
> Then we {1}read its JSON reply.
1 write code.2 then fade n2
> And {1}show the items on screen.
1 write code.3 then highlight code.3`,
  },
};
