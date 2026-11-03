/**
 * Provider-neutral chat client. OpenRouter, Groq, Azure OpenAI (v1 API) and
 * Gemini (its OpenAI-compatible endpoint) all speak the OpenAI
 * chat-completions protocol, so one implementation covers them; a fallback
 * client tries providers in order.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface Usage {
  prompt: number;
  completion: number;
  /** Prompt tokens served from the provider's prompt cache, when reported. */
  cached?: number;
}

export interface ChatResult {
  text: string;
  provider: string;
  model: string;
  usage?: Usage;
}

export interface LlmClient {
  readonly name: string;
  /** Requests this provider handles well at once (free tiers have low tokens-per-minute caps). */
  readonly concurrency?: number;
  chat(req: ChatRequest): Promise<ChatResult>;
  /** Streams the reply; `onDelta` receives text as it arrives. */
  stream(req: ChatRequest, onDelta: (text: string) => void): Promise<ChatResult>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export interface ProviderPreset {
  baseUrl: string;
  defaultModel: string;
  keyEnv: string;
  modelEnv: string;
  headers?: Record<string, string>;
  /** Parallel requests; omitted = no limit beyond the caller's. */
  concurrency?: number;
  /** Env var holding the endpoint, for providers whose URL is per account (Azure). Overrides baseUrl. */
  baseUrlEnv?: string;
  /** Turns the configured endpoint into the chat-completions base URL. */
  endpoint?: (url: string) => string;
  /** How the key is sent; default `Authorization: Bearer`. */
  auth?: "bearer" | "api-key";
  /** Normalizes a configured model name (e.g. Gemini's "models/" prefix). */
  model?: (name: string) => string;
}

export const PROVIDERS: Record<"openrouter" | "groq" | "azure" | "gemini", ProviderPreset> = {
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "anthropic/claude-sonnet-4.5",
    keyEnv: "OPENROUTER_API_KEY",
    modelEnv: "ANIM_OPENROUTER_MODEL",
    headers: { "X-Title": "anim-engine-upt" },
  },
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "openai/gpt-oss-120b",
    keyEnv: "GROQ_API_KEY",
    modelEnv: "ANIM_GROQ_MODEL",
    // The free tier allows ~8k tokens per minute and each call sends a ~4k-token prompt.
    concurrency: 1,
  },
  azure: {
    baseUrl: "",
    baseUrlEnv: "AZURE_OPENAI_ENDPOINT",
    // https://<resource>.openai.azure.com/openai → .../openai/v1 (the v1 API takes the deployment as "model").
    endpoint: (url) => {
      const u = url.trim().replace(/\/+$/, "");
      if (/\/openai\/v1$/.test(u)) return u;
      return /\/openai$/.test(u) ? `${u}/v1` : `${u}/openai/v1`;
    },
    defaultModel: "gpt-4.1",
    keyEnv: "AZURE_OPENAI_API_KEY",
    modelEnv: "AZURE_OPENAI_DEPLOYMENT",
    auth: "api-key",
  },
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-3-flash-preview",
    keyEnv: "GEMINI_API_KEY",
    modelEnv: "ANIM_GEMINI_MODEL",
    model: (name) => name.replace(/^models\//, ""),
  },
};

export type ProviderName = keyof typeof PROVIDERS;

export interface CompatOptions {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  headers?: Record<string, string>;
  concurrency?: number;
  /** How the key is sent; default `Authorization: Bearer`. */
  auth?: "bearer" | "api-key";
  /** Retries for 429/5xx/network errors, with backoff. */
  retries?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
}

/** OpenAI-compatible chat-completions client (OpenRouter, Groq, Azure, Gemini, ...). */
export class OpenAICompatibleClient implements LlmClient {
  readonly name: string;
  readonly concurrency?: number;
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: CompatOptions) {
    this.name = `${opts.name}:${opts.model}`;
    if (opts.concurrency) this.concurrency = opts.concurrency;
    this.fetchFn = opts.fetch ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  chat(req: ChatRequest): Promise<ChatResult> {
    return this.withRetries(async () => {
      const res = await this.post(req, false);
      const body = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
        model?: string;
        usage?: RawUsage;
      };
      const text = body.choices?.[0]?.message?.content;
      if (typeof text !== "string") throw new LlmError(`${this.opts.name}: response has no message content`);
      return { text, provider: this.opts.name, model: body.model ?? this.opts.model, ...(body.usage && { usage: usage(body.usage) }) };
    });
  }

  stream(req: ChatRequest, onDelta: (text: string) => void): Promise<ChatResult> {
    return this.withRetries(async () => {
      const res = await this.post(req, true);
      if (!res.body) throw new LlmError(`${this.opts.name}: streaming response has no body`);
      let text = "";
      let model = this.opts.model;
      let use: Usage | undefined;
      for await (const event of sse(res.body)) {
        if (event === "[DONE]") break;
        const chunk = JSON.parse(event) as {
          choices?: { delta?: { content?: string } }[];
          model?: string;
          usage?: RawUsage;
          x_groq?: { usage?: RawUsage };
          error?: { message?: string };
        };
        if (chunk.error) throw new LlmError(`${this.opts.name}: ${chunk.error.message ?? "stream error"}`, undefined, true);
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          text += delta;
          onDelta(delta);
        }
        if (chunk.model) model = chunk.model;
        const u = chunk.usage ?? chunk.x_groq?.usage;
        if (u) use = usage(u);
      }
      return { text, provider: this.opts.name, model, ...(use && { usage: use }) };
    });
  }

  private async post(req: ChatRequest, stream: boolean): Promise<Response> {
    let res: Response;
    // Reasoning models (gpt-5*, o1/o3/o4…) only accept the default temperature and use max_completion_tokens.
    const reasoning = isReasoningModel(this.opts.model);
    const auth: Record<string, string> = this.opts.auth === "api-key" ? { "api-key": this.opts.apiKey } : { authorization: `Bearer ${this.opts.apiKey}` };
    try {
      res = await this.fetchFn(`${this.opts.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...auth, ...this.opts.headers },
        body: JSON.stringify({
          model: this.opts.model,
          messages: req.messages,
          ...(!reasoning && { temperature: req.temperature ?? 0.4 }),
          ...(req.maxTokens && { [reasoning ? "max_completion_tokens" : "max_tokens"]: req.maxTokens }),
          stream,
          // Without this most providers send no token counts while streaming.
          ...(stream && { stream_options: { include_usage: true } }),
        }),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 180_000),
      });
    } catch (e) {
      throw new LlmError(`${this.opts.name}: request failed: ${e instanceof Error ? e.message : String(e)}`, undefined, true);
    }
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 500);
      const retryable = res.status === 429 || res.status >= 500;
      const err = new LlmError(`${this.opts.name}: HTTP ${res.status} ${detail}`, res.status, retryable);
      (err as LlmError & { retryAfter?: number }).retryAfter = Number(res.headers.get("retry-after")) || undefined;
      throw err;
    }
    return res;
  }

  private async withRetries<T>(fn: () => Promise<T>): Promise<T> {
    const retries = this.opts.retries ?? 2;
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (e) {
        // Rate limits clear within a minute (free tiers have low tokens-per-minute caps), so they get a bigger budget.
        const budget = e instanceof LlmError && e.status === 429 ? Math.max(retries, 6) : retries;
        if (!(e instanceof LlmError) || !e.retryable || attempt >= budget) throw e;
        const after = (e as LlmError & { retryAfter?: number }).retryAfter;
        await this.sleep(after ? after * 1000 : 1000 * 2 ** attempt);
      }
    }
  }
}

/** Tries each client in order; the first success wins. */
export class FallbackClient implements LlmClient {
  readonly name: string;
  readonly concurrency?: number;

  constructor(private readonly clients: LlmClient[]) {
    if (!clients.length) throw new Error("FallbackClient needs at least one client");
    this.name = clients.map((c) => c.name).join(" → ");
    // Any client may end up serving a request, so the strictest limit applies.
    const limits = clients.map((c) => c.concurrency).filter((n): n is number => n !== undefined);
    if (limits.length) this.concurrency = Math.min(...limits);
  }

  chat(req: ChatRequest): Promise<ChatResult> {
    return this.each((c) => c.chat(req));
  }

  stream(req: ChatRequest, onDelta: (text: string) => void): Promise<ChatResult> {
    // Only forward deltas from the attempt that ends up succeeding.
    return this.each(async (c) => {
      const parts: string[] = [];
      const result = await c.stream(req, (d) => parts.push(d));
      for (const p of parts) onDelta(p);
      return result;
    });
  }

  private async each(fn: (c: LlmClient) => Promise<ChatResult>): Promise<ChatResult> {
    const errors: string[] = [];
    for (const c of this.clients) {
      try {
        return await fn(c);
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }
    throw new LlmError(`all providers failed:\n- ${errors.join("\n- ")}`);
  }
}

export interface FromEnvOptions {
  /** Provider order; default $ANIM_LLM_PROVIDERS or "openrouter,azure,gemini,groq". */
  providers?: ProviderName[];
  /** Model override for the first provider. */
  model?: string;
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
}

/**
 * Builds a client from environment variables. Providers without an API key
 * are skipped; with several, the first is primary and the rest are fallbacks.
 */
export function clientFromEnv(opts: FromEnvOptions = {}): LlmClient {
  const env = opts.env ?? process.env;
  const order = opts.providers ?? ((env.ANIM_LLM_PROVIDERS ?? DEFAULT_ORDER).split(",").map((s) => s.trim()).filter(Boolean) as ProviderName[]);
  const clients: LlmClient[] = [];
  order.forEach((name, i) => {
    const preset = PROVIDERS[name];
    if (!preset) throw new Error(`unknown LLM provider \`${name}\` (known: ${Object.keys(PROVIDERS).join(", ")})`);
    const apiKey = env[preset.keyEnv];
    const configured = preset.baseUrlEnv ? env[preset.baseUrlEnv] : preset.baseUrl;
    if (!apiKey || !configured) return;
    const model = (i === 0 && opts.model) || env[preset.modelEnv] || preset.defaultModel;
    clients.push(
      new OpenAICompatibleClient({
        name,
        baseUrl: preset.endpoint ? preset.endpoint(configured) : configured,
        apiKey,
        model: preset.model ? preset.model(model) : model,
        ...(preset.auth && { auth: preset.auth }),
        ...(preset.headers && { headers: preset.headers }),
        ...(preset.concurrency && { concurrency: preset.concurrency }),
        ...(opts.fetch && { fetch: opts.fetch }),
      }),
    );
  });
  if (!clients.length) throw new Error(`no LLM API key found; set ${order.map((n) => required(PROVIDERS[n]).join(" + ")).join(" or ")} (see .env.example)`);
  return clients.length === 1 ? clients[0]! : new FallbackClient(clients);
}

const DEFAULT_ORDER = "openrouter,azure,gemini,groq";

/** The env vars a provider needs before it can be used. */
function required(p: ProviderPreset): string[] {
  return p.baseUrlEnv ? [p.baseUrlEnv, p.keyEnv] : [p.keyEnv];
}

/** Which providers have everything they need in `env`. */
export function configuredProviders(env: Record<string, string | undefined> = process.env): Record<ProviderName, boolean> {
  return Object.fromEntries(Object.entries(PROVIDERS).map(([name, p]) => [name, required(p).every((k) => Boolean(env[k]))])) as Record<ProviderName, boolean>;
}

export function isReasoningModel(model: string): boolean {
  return /(^|\/)(gpt-5|o[1-9])/.test(model);
}

interface RawUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
}

function usage(u: RawUsage): Usage {
  const cached = u.prompt_tokens_details?.cached_tokens;
  return { prompt: u.prompt_tokens ?? 0, completion: u.completion_tokens ?? 0, ...(cached && { cached }) };
}

/** Parses a server-sent-events stream into `data:` payloads. */
export async function* sse(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).replace(/\r$/, "");
      buffer = buffer.slice(nl + 1);
      if (line.startsWith("data:")) yield line.slice(5).trimStart();
    }
  }
  if (buffer.startsWith("data:")) yield buffer.slice(5).trimStart();
}
