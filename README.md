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
| `packages/timeline` | ✅ resolver + evaluator | Cues → absolute frame-quantized tweens; stateless `at(t)` |
| `packages/llm` | ✅ OpenRouter + Groq, generation pipeline | Prompt → outline → scenes → validate → LLM repair → auto-fix |
| `packages/engine` | ✅ stage, components, player | Browser SVG/HTML engine; stateless `render(t)`, audio-clocked player |
| `apps/preview` | ✅ dev preview | Edit a script, rebuild, play with audible word ticks, jump between cues |
| `apps/render` | ✅ MP4 exporter | Same engine stepped frame by frame in headless Chrome, parallel H.264 segments + mixed narration |
| `apps/studio` | planned | Debug/preview UI |

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
pnpm preview                                    # http://localhost:5199
pnpm render examples/cells.txt -o out/cells.mp4 # export MP4 (--workers=N --from=s --to=s --jpeg)
```

Rendering uses the installed Chrome or Edge (`CHROME_PATH` to override) and ffmpeg from `$FFMPEG_PATH`, the system `PATH`, or the bundled `ffmpeg-static` build.

The preview uses the mock voice, which plays a soft tick at the start of every word. Each visual should land on its tick.

## Git account for this repo

This repo pushes as the **UdhayaParameshwaran-ai** GitHub account, separate from any other account on the machine. It's configured per repo:

```sh
git config user.name  "Udhaya Parameshwaran"
git config user.email "UdhayaParameshwaran-ai@users.noreply.github.com"
git remote set-url origin https://UdhayaParameshwaran-ai@github.com/UdhayaParameshwaran-ai/anim-engine-upt.git
git config credential.https://github.com.username UdhayaParameshwaran-ai
```

The username in the remote URL makes Git Credential Manager use (or, on first push, ask for) that account's login. Other repos keep using their own accounts.
