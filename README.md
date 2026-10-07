# anim-engine-upt

Prompt → narrated 2D explainer video, built from SVG/HTML visuals.

```
Prompt → LLM → Narrascript (DSL) → parse/validate → TTS → timeline resolver → engine → live / MP4
```

The LLM writes a compact plain-text **narration-first DSL**. Visual actions are tied to words in the narration, so animation stays in sync however long the TTS takes. The LLM picks templates, semantic assets and verbs. It never writes coordinates or code.

```
scene need "What a plant needs" template=steps
sun   = icon:sun
water = icon:droplet
> Every plant needs {1}sunlight and {2}water.
1 pop sun
2 pop water
```

## Docs

- [Architecture & implementation plan](docs/architecture.md)
- [DSL specification](docs/dsl-spec.md)
- [Examples](examples/)

## Layout

| Package | Status | Purpose |
|---|---|---|
| `packages/dsl` | ✅ parser, printer, diagnostics | Streamable, error-tolerant parser → AST with spans |
| `packages/registry` | ✅ v1 vocabulary | Verbs, templates, components, asset manifest types |
| `packages/ir` | ✅ types | VideoIR, word timings, ResolvedTimeline |
| `packages/validate` | ✅ L2–L4 checks + auto-fix | Schema, reference, template and visibility checks |
| `packages/compiler` | ✅ layout + lowering + CLI | DSL → VideoIR; the layout engine decides every coordinate |
| `packages/tts` | ✅ interface, mock, aligner, cache | Provider-neutral TTS; any timing granularity → word timings |
| `packages/tts-kokoro` | ✅ local neural voice | Kokoro-82M (q4f16 ONNX) on the CPU with exact word timings from the model's durations |
| `packages/timeline` | ✅ resolver + evaluator | Cues → absolute frame-quantized tweens; stateless `at(t)` |
| `packages/llm` | ✅ OpenRouter + Groq, generation pipeline | Prompt → outline → scenes → validate → LLM repair → auto-fix |
| `packages/engine` | ✅ stage, components, player | Browser SVG/HTML engine; stateless `render(t)`, audio-clocked player |
| `apps/render` | ✅ MP4 exporter | Same engine stepped frame by frame in headless Chrome, parallel H.264 segments + mixed narration |
| `apps/studio` | ✅ Studio | Editor with diagnostics, timeline panel, inspector, bounds overlay, generate-and-play while later scenes are still being written |

## Scene layouts

A scene picks one of two layout systems. The LLM never writes coordinates in either:

- `template=`: 9 diagram templates (`title`, `compare`, `steps`, `cycle`, `flow`, `timeline`, `hub`, `grid`, `spotlight`).
- `grid=`: editorial pages from the [Template Rule Book v2](docs/rulebook-v2.html). It has 27 slot layouts on a 12-column grid, 6 frame modes (header and footer on or off), and 32 elements (stats, charts, tables, lists, quotes, steppers, flowcharts, maps…), each with its own motion. Rules R1–R11 are checked and auto-fixed where possible. See `examples/rulebook-gallery.txt` for every element.

## Generate from a prompt

```sh
cp .env.example .env          # add OPENROUTER_API_KEY and/or GROQ_API_KEY
pnpm generate "how vaccines train the immune system" --render
```

OpenRouter is the primary provider and Groq the fallback. Change the order with `--provider=groq,openrouter` or `ANIM_LLM_PROVIDERS`, and the model with `--model=<id>` or `ANIM_OPENROUTER_MODEL` / `ANIM_GROQ_MODEL`. `--single` writes the whole script in one streamed pass instead of outline → scenes.

## Develop

Requires Node 24+ and pnpm.

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm check examples/photosynthesis.txt          # diagnostics
pnpm check my-script.txt --fixed --ir           # auto-fixed script + IR
pnpm check my-script.txt --timeline=tl.json     # mock TTS + resolved timeline
pnpm studio                                     # http://localhost:5199
pnpm render examples/cells.txt -o out/cells.mp4 # export MP4 (--voice=kokoro|beeps --speed=1 --workers=N --from=s --to=s --jpeg)
```

Rendering uses the installed Chrome or Edge (`CHROME_PATH` to override) and ffmpeg from `$FFMPEG_PATH`, the system `PATH`, or the bundled `ffmpeg-static` build.

## Studio

`pnpm studio` opens the debugging UI at http://localhost:5199.

- **Script tab:** edit a script and press Ctrl+Enter to rebuild. Lines with diagnostics are marked in the gutter, and the line being played is highlighted.
- **Generate tab:** enter a topic and play the video while the LLM writes it. Playback starts as soon as scene 1 is validated. Later scenes are appended without moving what has already played, and the player waits on the last frame if it catches up with generation. Without API keys, "replay an example" streams an example script through the same pipeline.
- **Timeline panel:** shows scenes, beats (inserted holds are hatched), words, cues (approximate ones in amber), sync-report flags, and one track per element with its tweens colored by verb category. Click to seek, click a bar to jump to its source line, and Ctrl+wheel to zoom.
- **Inspector:** shows the current scene, step, beat and word, each element's values, and the tween driving it. Click to jump to the source.
- **Bounds overlay** (O): shows each element's current box and id, following the camera.

The Studio and the renderer narrate with the local Kokoro voice by default. **Beeps** (Script tab, or `ANIM_TTS=beeps` in `.env`) swaps in the instant mock voice, which ticks at the start of every word: each visual should land on its tick.

## Looks and motion

Every script can be restyled without touching its content:

```
theme magazine        # 13 looks: palette, bundled fonts, shapes, shadows, emphasis
motion cinematic      # 7 personalities: how the same verbs move
```

The Studio's Script tab has **Look** and **Motion** menus that override the script, so you can flip one script through every combination. The LLM picks a look and a motion to suit each topic. See `docs/dsl-spec.md` §6b.

## Voice (local TTS)

Narration is synthesized on your machine with [Kokoro-82M](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX-timestamped) (Apache-2.0) through ONNX Runtime. There is no Python, GPU or API key involved.

- **Model:** the *timestamped* export, `q4f16` weights (155 MB), downloaded on first use to `.cache/models`. On a laptop CPU (i5-12500H) it runs at about 2.8× realtime after a ~1.5 s load. The 8-bit build is slower than full precision on CPUs, so it isn't the default.
- **Word timings:** besides the audio, the model returns how long it spends on every input token. Tokens are built word by word, so those durations give exact word starts and ends (`word` precision) for cue sync.
- **Pronunciation:** phrases between punctuation are phonemized whole (espeak-ng), so words keep their natural reduced and linked forms (*of the* → ʌvðə). The phrase's phonemes are then split back into words by aligning them with each word's own phonemes.
- **Voices:** a script's `voice` line can name any Kokoro English voice (`af_heart`, `am_michael`, `bf_emma`, …). Any other name uses `af_heart`.
- **Caching:** audio is cached per scene by text, voice and speed in `.cache/tts`, so a rebuild only synthesizes scenes that changed.

## Git account for this repo

This repo pushes as the **UdhayaParameshwaran-ai** GitHub account, separate from any other account on the machine. It's configured per repo:

```sh
git config user.name  "Udhaya Parameshwaran"
git config user.email "UdhayaParameshwaran-ai@users.noreply.github.com"
git remote set-url origin https://UdhayaParameshwaran-ai@github.com/UdhayaParameshwaran-ai/anim-engine-upt.git
git config credential.https://github.com.username UdhayaParameshwaran-ai
```

The username in the remote URL makes Git Credential Manager use (or, on first push, ask for) that account's login. Other repos keep using their own accounts.
