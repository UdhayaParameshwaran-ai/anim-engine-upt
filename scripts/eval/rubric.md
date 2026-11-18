You are reviewing auto-generated narrated explainer videos (tech topics) to judge whether they ACTUALLY EXPLAIN the topic, not whether they are technically valid. Be a strict, honest reviewer, like a teacher judging whether a learner would understand the topic from the video. Do not be generous.

Videos to review: {{TOPICS}}

For each video, the folder is {{REVIEW_DIR}}\<topic>\ and contains:
- narration.md: every scene's spoken sentences in order (with scene id and template).
- <sceneId>.png: a contact sheet of 9 frames sampled evenly across that scene (left to right, top to bottom = time order).
Use the Read tool on narration.md first, then on every <sceneId>.png of the video (scene ids are listed in scenes.txt). The script source is at {{ARM_DIR}}\<topic>.txt if you need to check what was declared. Do not modify any files.

For EACH scene decide:
- What the narration says happens, and what the frames actually show.
- Verdict, one of: EXPLAINS (the picture shows the actual mechanism and changes as the narration describes), ILLUSTRATES (relevant picture but mostly static labels; the words do the explaining), DECORATES (generic icons/text pages that don't show the mechanism), BROKEN (overlap, cut off, empty frames, unreadable, wrong or misleading picture).
- If the picture states something false or contradicts the narration, add the tag MISLEADING to the defects.
- Concrete defects you can see (with frame numbers 1-9).
- What a good teacher would have drawn/animated here that this scene could not (missing capability), if any.

For EACH video: a score 1-5 for "a learner would understand the topic from this video" (5 = clearly, 3 = partly, the narration carries it, 1 = no), and the single biggest gap.

Reply in exactly this format, nothing else:
### <topic> — score N/5
- <sceneId> (<template>): VERDICT — <one line: what it shows vs says> | defects: <...or none> | missing: <...or none>
(one line per scene)
biggest gap: <one line>

Finish with a section:
### patterns across these videos
- 3–6 bullets on recurring problems (layout defects, wrong template choices, text pages instead of pictures, missing kinds of diagram or motion), each with which videos show it.
