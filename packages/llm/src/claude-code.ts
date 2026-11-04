import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { tmpdir } from "node:os";
import { LlmError, type ChatMessage, type ChatRequest, type ChatResult, type LlmClient, type Usage } from "./client.js";

/**
 * Claude through your own Claude subscription: each request runs the Claude
 * Code CLI headless (`claude -p`), which uses the account you logged in with
 * (`claude` → /login). No API key; calls count against the subscription's
 * usage limits.
 *
 * The CLI runs as a plain text generator: no tools, MCP servers, slash
 * commands, project settings or saved sessions, in a scratch directory so no
 * CLAUDE.md is picked up, and with our system prompt replacing Claude Code's.
 */

export interface ClaudeCodeOptions {
  /** Model id or alias (`claude-opus-5-5`, `sonnet`, …). */
  model: string;
  /** The CLI binary; default `claude`. */
  bin?: string;
  timeoutMs?: number;
  concurrency?: number;
  /** Injected for tests. */
  spawn?: (bin: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }) => ChildProcessWithoutNullStreams;
  env?: NodeJS.ProcessEnv;
}

/** Longer system prompts go into the prompt text instead (Windows caps a command line near 32k characters). */
const MAX_SYSTEM_ARG = 24_000;

interface ResultEvent {
  type: "result";
  result?: string;
  is_error?: boolean;
  subtype?: string;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
  modelUsage?: Record<string, unknown>;
}

export class ClaudeCodeClient implements LlmClient {
  readonly name: string;
  readonly concurrency: number;

  constructor(private readonly opts: ClaudeCodeOptions) {
    this.name = `claude:${opts.model}`;
    // Each request is a CLI process; a few at a time keeps memory in check.
    this.concurrency = opts.concurrency ?? 2;
  }

  chat(req: ChatRequest): Promise<ChatResult> {
    return this.stream(req, () => undefined);
  }

  stream(req: ChatRequest, onDelta: (text: string) => void): Promise<ChatResult> {
    const { system, prompt } = flatten(req.messages);
    const inline = system.length > MAX_SYSTEM_ARG;
    const args = [
      "-p",
      "--output-format", "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--model", this.opts.model,
      "--tools", "",
      "--strict-mcp-config",
      "--disable-slash-commands",
      "--no-session-persistence",
      "--setting-sources", "project",
      "--system-prompt", inline ? "Follow the instructions at the top of the user message exactly." : system || "Follow the user's instructions exactly.",
    ];
    const input = inline ? `${system}\n\n---\n\n${prompt}` : prompt;
    // An API key in the environment would be billed instead of the subscription.
    const env = { ...(this.opts.env ?? process.env) };
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;

    return new Promise<ChatResult>((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = (this.opts.spawn ?? defaultSpawn)(this.opts.bin ?? "claude", args, { cwd: tmpdir(), env });
      } catch (e) {
        return reject(new LlmError(`claude: could not start the Claude Code CLI: ${e instanceof Error ? e.message : String(e)}`));
      }
      let text = "";
      let buffer = "";
      let stderr = "";
      let result: ResultEvent | undefined;
      const timer = setTimeout(() => {
        child.kill();
        reject(new LlmError(`claude: no reply within ${Math.round((this.opts.timeoutMs ?? 300_000) / 1000)}s`, undefined, true));
      }, this.opts.timeoutMs ?? 300_000);

      const line = (raw: string) => {
        if (!raw.trim()) return;
        let event: { type?: string; event?: { type?: string; delta?: { type?: string; text?: string } } };
        try {
          event = JSON.parse(raw);
        } catch {
          return; // not an event line
        }
        const delta = event.type === "stream_event" && event.event?.type === "content_block_delta" && event.event.delta?.type === "text_delta" ? event.event.delta.text : undefined;
        if (delta) {
          text += delta;
          onDelta(delta);
        }
        if (event.type === "result") result = event as unknown as ResultEvent;
      };

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        buffer += chunk;
        let nl: number;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          line(buffer.slice(0, nl));
          buffer = buffer.slice(nl + 1);
        }
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => (stderr += chunk));
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(new LlmError(`claude: could not start the Claude Code CLI (${e.message}); install it and log in with \`claude\``));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        line(buffer);
        if (!result) return reject(new LlmError(`claude: CLI exited with code ${code} and no result: ${stderr.trim().slice(0, 400) || "no output"}`, undefined, true));
        if (result.is_error) {
          const msg = (result.result ?? result.subtype ?? "error").slice(0, 400);
          // Usage limits and overloads clear with time; anything else (not logged in, bad model) won't.
          return reject(new LlmError(`claude: ${msg}`, undefined, /limit|overload|rate|timeout|5\d\d/i.test(msg)));
        }
        const u = result.usage ?? {};
        const cached = u.cache_read_input_tokens ?? 0;
        const usage: Usage = {
          prompt: (u.input_tokens ?? 0) + cached + (u.cache_creation_input_tokens ?? 0),
          completion: u.output_tokens ?? 0,
          ...(cached && { cached }),
        };
        const model = Object.keys(result.modelUsage ?? {})[0] ?? this.opts.model;
        resolve({ text: text || result.result || "", provider: "claude", model, usage });
      });
      child.stdin.end(input, "utf8");
    });
  }
}

function defaultSpawn(bin: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }): ChildProcessWithoutNullStreams {
  return spawn(bin, args, { ...opts, stdio: "pipe", windowsHide: true });
}

/**
 * The CLI takes one prompt: system messages become the system prompt, and a
 * multi-turn exchange (a repair after a first reply) is written out as a
 * transcript ending with the latest request.
 */
export function flatten(messages: ChatMessage[]): { system: string; prompt: string } {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const turns = messages.filter((m) => m.role !== "system");
  if (turns.length <= 1) return { system, prompt: turns[0]?.content ?? "" };
  const last = turns.at(-1)!;
  const earlier = turns
    .slice(0, -1)
    .map((m) => `<${m.role}>\n${m.content}\n</${m.role}>`)
    .join("\n");
  return { system, prompt: `The conversation so far:\n${earlier}\n\nNow reply to this:\n${last.content}` };
}

let available: boolean | undefined;

/** Whether the Claude Code CLI is installed (checked once). */
export function claudeCliAvailable(bin = "claude"): boolean {
  if (available === undefined) {
    const r = spawnSync(bin, ["--version"], { encoding: "utf8", windowsHide: true, timeout: 15_000 });
    available = r.status === 0 && /claude/i.test(r.stdout ?? "");
  }
  return available;
}
