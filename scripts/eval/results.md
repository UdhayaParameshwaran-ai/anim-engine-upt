# Eval results

Reviewer scores (1–5, "a learner would understand the topic from the video"), one reviewer agent per 8 videos,
frames and narration only, Haiku generations. Single runs: differences of a few tenths are within noise.

| Run | Videos | Average | 4s | 3s | 2s | 1s |
|---|---|---|---|---|---|---|
| baseline (before explain-quality work) | 48 | 2.25 | 1 | 12 | 33 | 2 |
| h1: polish + trace slice 1 | 48 (same topics) | 2.81 | 8 | 23 | 17 | 0 |
| h1: all topics | 62 | 2.82 | 10 | 31 | 21 | 0 |

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
