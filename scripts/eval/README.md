# Explanation eval

Measures whether generated videos *explain* their topic, not only whether they compile.

1. Generate: `bash scripts/eval/run.sh <arm> <haiku|sonnet> [topics.tsv] [parallel]` writes `out/eval/<arm>/`.
2. Render: `node scripts/eval/render.mjs <arm>` gives 9 frames and the narration per scene, under `out/eval/<arm>/review/`.
3. Sheets: `node scripts/eval/sheets.cjs <arm>` gives one 3×3 contact sheet per scene.
4. Review: in a Claude session, give reviewer agents `rubric.md` with `{{TOPICS}}` (8 per agent), `{{REVIEW_DIR}}` and
   `{{ARM_DIR}}` filled in, and save each reply as `out/eval/<arm>/review/report-N.md`.
5. Score: `node scripts/eval/score.mjs out/eval/<arm>/review/report-*.md --json out/eval/<arm>/score.json`.

Compare `score.json` across arms. Track the average (target ≥ 4), the misleading scenes (target 0) and the
EXPLAINS share. Also check that errors, repairs and tokens per video (from the `.log` files) don't regress.

Baseline (Haiku, 48 topics, before the explain-quality work): average 2.3/5, scores 4:1 · 3:12 · 2:33 · 1:2.
