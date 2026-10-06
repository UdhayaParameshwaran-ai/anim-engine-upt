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
| `packages/tts` | planned | Provider-neutral TTS + aligner |
| `packages/timeline` | planned | Anchor resolution → frame-quantized tweens |
| `packages/engine` | planned | Browser SVG/HTML engine, `render(t)` |
| `apps/render` | planned | Headless Chromium + ffmpeg exporter |
| `apps/studio` | planned | Debug/preview UI |

## Develop

Requires Node 24+ and pnpm.

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm check examples/photosynthesis.txt          # diagnostics
pnpm check my-script.txt --fixed --ir           # auto-fixed script + IR
```

## Git account for this repo

This repo pushes as the **UdhayaParameshwaran-ai** GitHub account, separate from any other account on the machine. It's configured per repo:

```sh
git config user.name  "Udhaya Parameshwaran"
git config user.email "UdhayaParameshwaran-ai@users.noreply.github.com"
git remote set-url origin https://UdhayaParameshwaran-ai@github.com/UdhayaParameshwaran-ai/anim-engine-upt.git
git config credential.https://github.com.username UdhayaParameshwaran-ai
```

The username in the remote URL makes Git Credential Manager use (or, on first push, ask for) that account's login. Other repos keep using their own accounts.
