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
