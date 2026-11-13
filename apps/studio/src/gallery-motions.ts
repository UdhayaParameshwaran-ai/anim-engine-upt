import type { Case, Group } from "./gallery-cases.js";

/** A one-scene script on a template, with the narration lines that carry the motion. */
function motionScript(attrs: string, decl: string[], lines: string[], head = ""): string {
  return `video 1 "Motion"\n${head}\nscene s "Example" ${attrs}\n${decl.join("\n")}\n${lines.join("\n")}\n`;
}

const EX2 = [`client = icon:laptop "Client"`, `server = icon:server "Server"`, `m1 = arrow client->server "GET /data"`, `m2 = arrow server->client "200 OK"`];
const ARCH = [`edge = zone "Edge"`, `cdn = icon:globe "CDN"`, `core = zone "Origin"`, `app = icon:server "App"`, `db = icon:database "Database"`, `l1 = arrow cdn->app "miss"`, `l2 = arrow app->db "SQL"`];
const CELLS = [`c1 = box "7"`, `c2 = box "3"`, `c3 = box "9"`, `c4 = box "5"`];
const BOXES = [`a = box "Status"`, `b = box "Hits"`, `c = box "Old API"`, `d = box "Copy A"`, `e = box "Copy B"`, `f = box "Merged"`];

const TWO_SCENES_CARRY = `video 1 "Motion"

scene a "Parts" template=cards
client = icon:laptop "Client"
server = icon:server "Server"
db = icon:database "Database"
> The {1}client, the {2}server and the {3}database.
1 pop client
2 pop server
3 pop db

scene b "One request" template=exchange carry=client,server
client = icon:laptop "Client"
server = icon:server "Server"
m1 = arrow client->server "GET /"
> The client {1}asks the server.
1 send m1
`;

const TWO_SCENES_INTO = `video 1 "Motion"

scene a "The stack" template=architecture
client = zone "Client"
browser = icon:laptop "Browser"
back = zone "Backend"
server = icon:server "Server"
db = icon:database "Database"
l1 = arrow browser->server "HTTP"
l2 = arrow server->db "SQL"
> The {1}browser asks the {2}server, which reads the {3}database.
1 pop browser
2 pop server then draw l1
3 pop db then draw l2

scene b "Inside the database" in=into:db template=steps
s1 = icon:file "Parse"
s2 = icon:search "Plan"
s3 = icon:database "Read"
> Inside, a query is {1}parsed, {2}planned, then {3}read.
1 pop s1
2 pop s2
3 pop s3
`;

/** The declarations of `list` that start with one of `ids` (a tile declares only what it shows). */
const only = (list: string[], ...ids: string[]) => list.filter((l) => ids.some((id) => l.startsWith(`${id} `)));

/** Each story motion on a small sample: Play shows it happening, the tile shows where it ends. */
export function motionGroup(): Group {
  const one = (id: string, title: string, note: string, script: string): Case => ({ id: `motion-${id}`, title, note, script });
  return {
    id: "motions",
    title: "Story motions",
    intro: "Verbs that show what happens, not only what exists: a packet travels, a ring moves through a machine, a value changes. Press Play on a tile to watch it.",
    sections: [
      {
        title: "Along a connector",
        note: "send, stream",
        cases: [
          one("send", "send", "send m1 · a packet travels along the arrow, drawing it first", motionScript("template=exchange", EX2, ["> The {1}client and {2}server, then {3}a request and {4}its answer.", "1 pop client", "2 pop server", "3 send m1", "4 send m2"])),
          one("send-fail", "send fail=true", "the packet stops halfway and turns red", motionScript("template=exchange", only(EX2, "client", "server", "m1"), ["> The {1}client and {2}server, then {3}a request that is lost.", "1 pop client", "2 pop server", "3 send m1 fail=true then shake client"])),
          one("send-wait", "send wait=1", "the packet pauses halfway (a busy server), then goes on", motionScript("template=exchange", only(EX2, "client", "server", "m1"), ["> The {1}client and {2}server, then {3}a request that waits.", "1 pop client", "2 pop server", "3 send m1 wait=1"])),
          one("stream", "stream", "stream l1 count=4 · steady traffic", motionScript("template=architecture", ARCH, ["> The {1}CDN and the {2}app, then {3}steady traffic, then {4}the database.", "1 pop cdn", "2 pop app", "3 stream l1 count=4", "4 pop db then draw l2"])),
        ],
      },
      {
        title: "Position and status",
        note: "visit, mark, shake",
        cases: [
          one("visit", "visit", "one ring of “you are here” moves from element to element", motionScript("template=states", [`s1 = node "Idle"`, `s2 = node "Running"`, `s3 = node "Done"`, `t1 = arrow s1->s2 "start"`, `t2 = arrow s2->s3 "finish"`], ["> It is {1}idle, then {2}running, then {3}done.", "1 pop s1 then visit s1", "2 pop s2 then draw t1 then visit s2", "3 pop s3 then draw t2 then visit s3"])),
          one("mark", "mark", "mark x as=ok|fail|visited leaves a status tint", motionScript("template=exchange", only(EX2, "client", "server"), ["> The {1}client and {2}server; {3}the answer is fine and {4}the client is not.", "1 pop client", "2 pop server", "3 mark server as=ok", "4 mark client as=fail"])),
        ],
      },
      {
        title: "Structures",
        note: "drop, lift, swap",
        cases: [
          one("drop-lift", "drop · lift", "push onto a stack, pop off it", motionScript("template=structure variant=stack", CELLS, ["> Cells {1}drop onto the stack, then {2}the top one lifts off.", "1 drop c1,c2,c3,c4", "2 lift c4"])),
          one("swap", "swap", "two cells trade places along arcs (sorting)", motionScript("template=structure variant=array", CELLS, ["> The {1}cells, then {2}two trade places.", "1 pop c1,c2,c3,c4", "2 swap c1,c2"])),
        ],
      },
      {
        title: "Values",
        note: "set, count, strike, clone, merge",
        cases: [
          one("set", "set", 'set x to="404 Not Found" · the text changes in place', motionScript("template=cards", only(BOXES, "a", "b"), ["> A {1}status and a {2}counter, then {3}the status changes.", "1 pop a", "2 pop b", '3 set a to="404 Not Found"'])),
          one("count", "count", 'count x from=0 to=1200 suffix=" requests"', motionScript("template=cards", only(BOXES, "a", "b"), ["> A {1}status and a {2}counter that {3}climbs.", "1 pop a", "2 pop b", '3 count b from=0 to=1200 suffix=" requests"'])),
          one("strike", "strike", "a line through the element, which dims", motionScript("template=cards", only(BOXES, "a", "c"), ["> A {1}current option and an {2}old one, now {3}struck out.", "1 pop a", "2 pop c", "3 strike c"])),
          one("clone-merge", "clone · merge", "copies fly out of one element; two fly into one", motionScript("template=cards", only(BOXES, "a", "d", "e", "f"), ["> One {1}status, {2}copied twice, then {3}two merge.", "1 pop a", "2 clone a,d,e", "3 merge d,e,f"])),
        ],
      },
      {
        title: "Camera and scenes",
        note: "frame, frame=close, emphasis, carry, into",
        cases: [
          one("frame", "frame", "frame a,b,c · the camera frames a group", motionScript("template=architecture", ARCH, ["> The {1}CDN, the {2}app and the {3}database, then {4}a close look at the origin.", "1 pop cdn", "2 pop app then draw l1", "3 pop db then draw l2", "4 frame app,db"])),
          one("frame-close", "frame=close", "opens close on the first item and pulls out", motionScript("template=cards frame=close", [`a = icon:sun "Solar"`, `b = icon:wind "Wind"`, `c = icon:droplet "Hydro"`], ["> {1}Solar, {2}wind and {3}hydro.", "1 pop a", "2 pop b", "3 pop c"])),
          one("emphasis", "emphasis=last", "the last item gets the most room (any template)", motionScript("template=architecture emphasis=last", ARCH, ["> The {1}CDN, the {2}app and the {3}database.", "1 pop cdn", "2 pop app then draw l1", "3 pop db then draw l2"])),
          one("carry", "carry=", "two scenes: Client and Server stay and glide into the next layout", TWO_SCENES_CARRY),
          one("into", "in=into:", "two scenes: the first zooms into the database, the second starts inside it", TWO_SCENES_INTO),
        ],
      },
      {
        title: "Decor kits",
        note: "kit plain | dashed | bold | soft",
        cases: ["plain", "dashed", "bold", "soft"].map((k) =>
          one(`kit-${k}`, `kit ${k}`, `kit ${k} · the lines and cards of the whole video`, motionScript("template=architecture", ARCH, ["> The {1}CDN, the {2}app and the {3}database.", "1 pop cdn", "2 pop app then draw l1", "3 pop db then draw l2"], `kit ${k}`)),
        ),
      },
    ],
  };
}
