# Eval results

Reviewer scores (1–5, "a learner would understand the topic from the video"), one reviewer agent per 8 videos,
frames and narration only, Haiku generations. Single runs: differences of a few tenths are within noise.

| Run | Videos | Average | 4s | 3s | 2s | 1s |
|---|---|---|---|---|---|---|
| baseline (before explain-quality work) | 48 | 2.25 | 1 | 12 | 33 | 2 |
| h1: polish + trace slice 1 | 48 (same topics) | 2.81 | 8 | 23 | 17 | 0 |
| h1: all topics | 62 | 2.82 | 10 | 31 | 21 | 0 |
| h2: + chains, buckets, graphs, trees, heaps, plots, rings | 48 (same topics) | 3.00 | 8 | 28 | 12 | 0 |
| h2: all topics | 62 | 3.05 | 11 | 43 | 8 | 0 |

## h1 per video

4: deadlock, nat, cookies-sessions, db-index, message-queue, cap-theorem, huffman, blockchain, jwt, bubble-sort
3: linked-list, bst, recursion, dynamic-programming, lru-cache, process-thread, cpu-pipeline, garbage-collection,
event-loop, websockets, rest-graphql, browser-render, acid, sharding, sql-join, raft, kubernetes, serverless,
rate-limit, neural-network, utf8, floating-point, bloom-filter, cicd-pipeline, compiler-stages, dns-hierarchy,
dom-tree, http-request-format, order-status, traffic-light, url-anatomy
2: quicksort, bfs-dfs, dijkstra, binary-heap, hash-collisions, virtual-memory, cors, mapreduce, consistent-hashing,
public-key, sql-injection, xss, totp, gradient-descent, attention, decision-tree, regex, file-system, git-branching,
merge-rebase, tcp-states

## What the review shows

- Videos that use a trace scene average 3.15 (13 videos); the others 2.73.
- Trace scenes are rated EXPLAINS where the data is a flat sequence (bubble sort, recursion call stack, Huffman
  weights, blockchain tamper, db-index search, LRU, rate limit, Bloom filter bits).
- They fail where the structure is a graph, tree or pointer chain drawn as a row (bfs-dfs, bst, binary-heap,
  linked-list, decision-tree, Huffman's tree, dijkstra): those need graph, tree and pointer collections.
- The planner did not choose trace for quicksort, dijkstra or dynamic-programming on Haiku.
- Still frequent: text and icon pages for recaps and limits, tiny edge labels, and pictures that drop the half of a
  story that carries the point (responses, return paths, a crash).

## h2 (after graphs, trees, linked lists, buckets, heaps, plots and rings)

Generated before the last planner fix (worked-example grid pages and more data topics routed to a trace), so
gradient descent, hash collisions and a few others still got a grid table or icon chain instead of a plot.

- Data-structure and algorithm videos gained the most: dijkstra 2→4, linked-list 3→4, bst 3→4, recursion 3→4,
  quicksort 2→3, bfs-dfs 2→3, binary-heap 2→3, lru-cache 3→4, event-loop 3→4, file-system 2→4.
- Videos with a trace scene: 25 of 59 generated (13 before).
- Still 2/5: hash-collisions, cpu-pipeline, cors, totp, neural-network, gradient-descent, floating-point,
  bloom-filter. Most of these never got a trace, or a trace without its context (labels, source, request stream).
- Remaining defects named by reviewers in nearly every video: half-typed title in the first sampled frame, text
  or icon pages for recaps and limits, tiny edge labels, a worked example given as a table of numbers.
- Three topics (sharding, message-queue, mapreduce) timed out once in the Claude CLI under parallel load and
  were re-run.

## h3 (after lanes, networks, heading fade, routing fix)

| Run | Videos | Average | 4s | 3s | 2s | 1s |
|---|---|---|---|---|---|---|
| h3: all topics | 62 | 3.21 | 18 | 39 | 5 | 0 |

- Trace scenes in 38 of 62 videos (25 before). `lanes` and `net` were used by 3 videos only (the planner rarely
  picks them: neural-network and totp still got icon chains or a number-only trace).
- Still 2/5: process-thread, cookies-sessions, totp, regex, floating-point.
- Defects named in most videos: recap/limit pages that are bullet text, first frame of title slides typing, tiny
  labels, example values missing from the picture (pattern `c[ao]t` shown as `caot`, hex addresses, item names in a
  Bloom filter), trace cells without labels, relations drawn as rows (garbage-collection graph has no edges).
- Engine bugs found: backslash in text is eaten (file-system `C:\Users`), `|` leaks into grid bullets,
  `count` stat shows 0 then 1, struck-through compare side reads as "wrong", trace shows `null` and `i` index chrome
  on non-array data (order-status, traffic-light).

## h4 (after backslash/pipe/count fixes, Q7 graph/net/lanes repair, NAR613)

| Run | Videos | Average | 4s | 3s | 2s | 1s |
|---|---|---|---|---|---|---|
| h4: all topics | 62 | 3.02 | 13 | 37 | 12 | 0 |

h4 scored lower than h3 (3.21) although nothing in it should make a video worse. Single Haiku runs vary: the same
topic moved ±1 in both directions (huffman 4→2, raft 4→2, garbage-collection 3→4, cicd 3→4), so a difference of
0.2 on 62 videos is within noise. Only 28 videos got a trace scene (38 in h3): the planner's choice of template
changes from run to run, and a video without a trace scene stays around 3.
- The new kinds were rarely chosen (net 1, graph 3, plot 1, lanes 0 of 62): Haiku copies the row example even when
  the narration is about links, time or layers; Q7 asks for a rewrite but the rewrite is sometimes rejected.
- Still seen in most videos: recap/limit scenes as text, tiny labels, trace cells without labels, a state machine
  layout that clips or overlaps, titles typing in the first frame.
- The `|` in checklists (websockets, browser-render) survived because it was only a warning; list widgets now split
  on it too.

## s1: Sonnet generation, same 62 topics, same code as h4

| Run | Videos | Average | 5s | 4s | 3s | 2s |
|---|---|---|---|---|---|---|
| s1 (Sonnet) | 62 | 3.35 | 1 | 21 | 39 | 1 |

Sonnet scores about 0.15 above the best Haiku run and 0.3 above h4 on the same code. Trace scenes in 33 of 62
videos; lanes in 3, graph in 5, net in 1. Still seen: text recap/limit pages, tiny labels, state diagrams that
re-layout, flat pictures for things that need an animation (a token moving, a link cut, a vote tally).
Found while reading the Sonnet reports: `{2server}` and `{1payment clears}` (cue number glued to the first word)
silently dropped the word from the narration ("knock the  over"); the lexer now treats the number as the cue and
the letters as the first spoken word. A file path such as `C:\Users\Ana\Documents\notes.txt` still loses `\n`
(a newline escape), so the name shows as `otes.txt`.

## h5 (Haiku) and s2 (Sonnet): after Q8/Q9/Q10, camera keeps whole connectors, glued cue fix

| Run | Videos | Average | 4s | 3s | 2s | 1s |
|---|---|---|---|---|---|---|
| h5 (Haiku) | 62 | 3.16 | 18 | 36 | 8 | 0 |
| s2 (Sonnet) | 62 | 3.50 | 36 | 22 | 3 | 1 |

Sonnet: 36 of 62 videos at 4 (21 in s1). The 1 is compiler-stages, whose script kept validation errors after three
repairs (a quoted `"prod:"*` state item) and could not render. Haiku moved 3.02 to 3.16, back near h3 (3.21):
within run-to-run noise. Trace scenes: h5 and s2 about half the videos; lanes/net/graph still rarely chosen.

## Teaching arc (branch feature/teaching-arc): methods, audience levels, decide-then-fill, scenes in order

Planner only (`plan-check.mjs`, 16 topics x 3 audience levels, no scenes written):

| Planner | Plans passing every teaching rule | Method a teacher would accept |
|---|---|---|
| one call, Haiku / Sonnet | 75% / 96% | 94% / 92% |
| decide, then fill, Haiku / Sonnet | 98% / 100% | 91% / 96% |

The accepted methods were written down before the runs; they are a judgement, so read the second column as rough.

Narration (`narration-check.mjs`, the 8 topics of topics-8: dijkstra, cors, jwt, bloom-filter, consistent-hashing,
floating-point, cap-theorem, garbage-collection; same run settings as h5/s2). t-* = planner with methods only, v-* =
decide-then-fill plus scenes written in order with their part of the arc and the Q11-Q14 checks.

| | h5 | t-h | v-h | s2 | t-s | v-s |
|---|---|---|---|---|---|---|
| openings that take up their planned link | - | 12/31 | 28/29 | - | 10/32 | 30/31 |
| planned predictions asked, then paused | - | 1/6 | 8/8 | - | 0/2 | 6/6 |
| first scene asks a question its method does not use | - | 1 | 1 | - | 3 | 0 |
| sentences that are questions | 0.0% | 4.1% | 11.5% | 0.0% | 1.7% | 6.4% |
| sentences with you/your | 0.6% | 2.4% | 6.4% | 3.5% | 3.4% | 7.6% |
| text pages in 8 videos / videos ending on one | 10 / 6 | 5 / 4 | 3 / 3 | 8 / 6 | 7 / 2 | 3 / 1 |
| first scene ready (median) | 26s | 39s | 30s | 22s | 31s | 33s |
| estimated playback wait after the first scene (median / worst) | 9s / 94s | 10s / 111s | 7s / 36s | 3s / 4s | 0s / 17s | 1s / 27s |
| LLM calls per video | 8.8 | 8.6 | 9.6 | 9.1 | 9.9 | 10.9 |

Not yet measured: reviewer scores (rubric.md) on these videos. Seen in the frames: the arc carries the pictures where
the template fits (CORS: the guesses light up on the request path, the ending strikes the wrong model); a weighted
graph planned as template=flow draws as a column with hidden edges (Dijkstra's new-map question).

## Teaching arc v2 (branch feature/teaching-arc-2): intent picks the method, arcs written per length, cleaner hand-off

What changed: the decision call reads the use case (pictures), what the learner asks (intent: what, how, do, differ,
fix, predict, believe, evolve) and the wrong idea to bring out; code maps intent x use case x level to the method. Each
method's arc is written out per length (short merges beats into 2 scenes, long adds a round of the method's cycle,
deep repeats the cycle); core beats are kept at every length, and a plan with more or fewer scenes than slots gets its
slots split or merged instead of a repeated beat. The planner sees each beat's job and picture; scene writers get the
link as an idea (not words), "what was said wins", "do not re-ask", and checks Q15 (plan words spoken), Q16 (a
question asked twice) and Q17 (a core scene of one or two sentences).

Decision only (`decision-check.mjs`, TAG=3 QUICK=1: 95 topics at familiar + 29 gold topics at new and practitioner;
gold.json written before the runs):

| | Haiku | Sonnet |
|---|---|---|
| method accepted, new / familiar / practitioner | 90% / 97% / 90% | 83% / 97% / 83% |
| use case accepted (familiar) | 97% | 97% |
| every method reached by its one-per-method topic | all but analogical at familiar* | all but analogical at familiar* |
| socratic share of all 95 topics | 4% | 7% |
| length read right (earlier full run, TAG=2) | 100% none, 100% short, 93% long | 100% / 100% / 100% |

*analogical is used for newcomers (the level picks it); a topic that names "a padlock analogy" at familiar gets causal.
A first version of the intent rules made socratic nearly vanish (0-2%) and missed analogical for newcomers; both were
fixed before the planner and video runs (TAG=2 is that first version).

Planner only (`plan-check.mjs`, plan4-*: 16 topics x 3 levels at the default length + 8 one-per-method topics at
short and long):

| | Haiku | Sonnet | old planner (plan-*6, 4-6 scenes) |
|---|---|---|---|
| plans keeping every core beat | 64/64 | 64/64 | evidence/experiment cut at the default length |
| a text page on a beat that must show something | 0/93 | 0/94 | result on a text page 11x |
| worked example: the new case reuses the run's picture | 18/19 | 17/17 | 10/24 |
| last scene a text page / a card list | 4 / 2 of 64 | 1 / 11 of 64 | 11 / 18 of 94 |
| first scene a title card | 1/64 | 0/64 | 13/94 |
| method accepted (gold) | 88% | 91% | - |

Videos at the DEFAULT length (what a person gets; the earlier runs forced 4-6 scenes and so never showed the cut
beats): b-* = previous code, c-* = this branch, topics-8, `SCENES=` with run.sh.

| | b-h | c-h | b-s | c-s |
|---|---|---|---|---|
| arcs with their core beat | socratic without evidence (2), worked without reasoning (2), cors cut to 3 beats | all | socratic without evidence (3), worked without reasoning (3) | all |
| plan words spoken aloud | 2 | 0 | 0 | 0 |
| questions to the viewer / followed by a pause | 8 / 5 | 11 / 5 | 14 / 7 | 11 / 8 |
| planned predictions asked, then paused | 5/6 | 4/4 | 7/9 | 8/8 |
| openings that take up their planned link | 22/23 | 25/26 | 24/24 | 23/24 |
| scenes / sentences per scene | 3.9 / 4.7 | 4.3 / 5.6 | 4.0 / 6.9 | 4.0 / 6.7 |
| prompt / completion tokens per video | 66k / 27k | 77k / 38k | 74k / 14k | 73k / 12k |
| seconds per video | 122 | 145 | 97 | 91 |

Read by hand: every number in the 16 new scripts checks out (runs, new cases, answers); no cross-scene contradiction.
Haiku still re-runs the example in its reasoning and result scenes (Dijkstra, garbage collection, Bloom filter) and,
once, says the answer in the opening question (CORS). Haiku writes 5 scenes for a 4-slot arc about a third of the
time (the slots are split to fit), which with longer scenes is most of its token rise; its plan replies also vary
from 0.7k to 7k completion tokens for similar text (provider-side). Sonnet's cost went down.
