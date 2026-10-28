/**
 * LLM Gateway — a single, provider-agnostic entry point for every model call.
 *
 * Routing order (each tier is skipped when its key is not configured):
 *   1. External OpenAI-compatible gateway (LLM_GATEWAY_URL), e.g. Cloudflare AI Gateway,
 *      Portkey or OpenRouter.
 *   2. Groq Cloud (direct).
 *   3. Google Gemini (direct, native generateContent API).
 *
 * Guarantees:
 *   - One overall deadline per request, so the cascade can never outlive the HTTP request.
 *   - Error classification: rate limits / overloads / timeouts move to the next model,
 *     auth failures skip the whole provider, bad requests skip to the next provider.
 *   - Per-model circuit breaker so a dead model stops costing a round trip on every request.
 *   - Output validation hook: a malformed answer fails over just like an HTTP error.
 *   - Structured per-attempt logs and in-memory usage metrics (latency, tokens, failures).
 *   - API keys are redacted from every error message that leaves this module.
 */

const DEFAULT_MODELS = {
  groq: {
    text: ["openai/gpt-oss-120b", "llama-3.3-70b-versatile", "openai/gpt-oss-20b", "llama-3.1-8b-instant"],
    vision: ["qwen/qwen3.8-27b"],
  },
  gemini: {
    text: ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.5-flash"],
    vision: ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.5-flash"],
  },
};

const BREAKER_FAILURE_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 60_000;
const MIN_ATTEMPT_BUDGET_MS = 1_500;

// ---------------------------------------------------------------------------
// Configuration (read lazily so tests and hot-reloaded env changes take effect)
// ---------------------------------------------------------------------------

function env(name) {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function envList(name, fallback) {
  const raw = env(name);
  if (!raw) return fallback;
  const list = raw.split(",").map((item) => item.trim()).filter(Boolean);
  return list.length ? list : fallback;
}

function envInt(name, fallback) {
  const parsed = parseInt(env(name), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getConfig() {
  return {
    deadlineMs: envInt("LLM_DEADLINE_MS", 55_000),
    attemptTimeoutMs: envInt("LLM_ATTEMPT_TIMEOUT_MS", 25_000),
    logging: env("LLM_LOG") !== "off",
  };
}

function buildProviders() {
  const providers = [];

  const gatewayUrl = env("LLM_GATEWAY_URL");
  if (gatewayUrl) {
    providers.push({
      name: "gateway",
      apiKey: env("LLM_GATEWAY_API_KEY"),
      endpoint: `${gatewayUrl.replace(/\/+$/, "")}/chat/completions`,
      format: "openai",
      models: {
        text: envList("LLM_GATEWAY_TEXT_MODELS", []),
        vision: envList("LLM_GATEWAY_VISION_MODELS", []),
      },
    });
  }

  const groqKey = env("GROQ_API_KEY");
  if (groqKey) {
    providers.push({
      name: "groq",
      apiKey: groqKey,
      endpoint: "https://api.groq.com/openai/v1/chat/completions",
      format: "openai",
      models: {
        text: envList("GROQ_TEXT_MODELS", DEFAULT_MODELS.groq.text),
        vision: envList("GROQ_VISION_MODELS", DEFAULT_MODELS.groq.vision),
      },
    });
  }

  const geminiKey = env("GEMINI_API_KEY");
  if (geminiKey) {
    providers.push({
      name: "gemini",
      apiKey: geminiKey,
      endpoint: "https://generativelanguage.googleapis.com/v1beta/models",
      format: "gemini",
      models: {
        text: envList("GEMINI_TEXT_MODELS", DEFAULT_MODELS.gemini.text),
        vision: envList("GEMINI_VISION_MODELS", DEFAULT_MODELS.gemini.vision),
      },
    });
  }

  return providers;
}

export function getConfiguredProviders() {
  return buildProviders().map((p) => p.name);
}

// ---------------------------------------------------------------------------
// Secret redaction
// ---------------------------------------------------------------------------

const SECRET_PATTERNS = [
  /gsk_[0-9A-Za-z_-]{20,}/g,
  /AIza[0-9A-Za-z_-]{30,}/g,
  /sk-[0-9A-Za-z_-]{20,}/g,
  /Bearer\s+[0-9A-Za-z._-]{10,}/gi,
];

export function redactSecrets(text) {
  if (typeof text !== "string") return "AI provider error";
  let output = text;
  for (const pattern of SECRET_PATTERNS) {
    output = output.replace(pattern, "[REDACTED]");
  }
  for (const name of ["GROQ_API_KEY", "GEMINI_API_KEY", "LLM_GATEWAY_API_KEY"]) {
    const secret = env(name);
    if (secret.length >= 8) output = output.split(secret).join("[REDACTED]");
  }
  return output;
}

// ---------------------------------------------------------------------------
// Errors & classification
// ---------------------------------------------------------------------------

export class LLMError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number, scope?: "model" | "provider", cause?: unknown }} [details]
   *   scope "model": try the next model; scope "provider": skip the rest of this provider.
   */
  constructor(message, { status = 0, scope = "model", cause } = {}) {
    super(redactSecrets(message));
    this.name = "LLMError";
    this.status = status;
    this.scope = scope;
    if (cause) this.cause = cause;
  }
}

function classifyHttpError(status, message) {
  if (status === 401 || status === 403) return "provider";
  const lower = message.toLowerCase();
  const modelProblem =
    status === 404 ||
    lower.includes("decommissioned") ||
    lower.includes("does not exist") ||
    lower.includes("not found") ||
    lower.includes("not supported");
  if (modelProblem) return "model";
  if (status === 408 || status === 429 || status >= 500) return "model";
  // Remaining 4xx: the payload itself was rejected; another provider may accept it.
  return "provider";
}

// ---------------------------------------------------------------------------
// Circuit breaker & metrics
// ---------------------------------------------------------------------------

const breakers = new Map();
const metrics = new Map();

function breakerKey(provider, model) {
  return `${provider}:${model}`;
}

function isBreakerOpen(key) {
  const state = breakers.get(key);
  return Boolean(state && state.openUntil > Date.now());
}

function recordBreaker(key, ok) {
  if (ok) {
    breakers.delete(key);
    return;
  }
  const state = breakers.get(key) || { failures: 0, openUntil: 0 };
  state.failures += 1;
  if (state.failures >= BREAKER_FAILURE_THRESHOLD) {
    state.openUntil = Date.now() + BREAKER_COOLDOWN_MS;
    state.failures = 0;
  }
  breakers.set(key, state);
}

function recordMetrics(key, { ok, latencyMs, usage, status }) {
  const entry = metrics.get(key) || {
    requests: 0,
    successes: 0,
    failures: 0,
    totalLatencyMs: 0,
    promptTokens: 0,
    completionTokens: 0,
    lastStatus: null,
    lastUsedAt: null,
  };
  entry.requests += 1;
  entry[ok ? "successes" : "failures"] += 1;
  entry.totalLatencyMs += latencyMs;
  entry.promptTokens += usage?.promptTokens || 0;
  entry.completionTokens += usage?.completionTokens || 0;
  entry.lastStatus = ok ? 200 : status || "error";
  entry.lastUsedAt = new Date().toISOString();
  metrics.set(key, entry);
}

/** Aggregated, secret-free usage statistics for the observability endpoint. */
export function getLLMStats() {
  const models = {};
  for (const [key, entry] of metrics) {
    models[key] = {
      requests: entry.requests,
      successes: entry.successes,
      failures: entry.failures,
      avgLatencyMs: entry.requests ? Math.round(entry.totalLatencyMs / entry.requests) : 0,
      promptTokens: entry.promptTokens,
      completionTokens: entry.completionTokens,
      lastStatus: entry.lastStatus,
      lastUsedAt: entry.lastUsedAt,
      circuitOpen: isBreakerOpen(key),
    };
  }
  return { providers: getConfiguredProviders(), models };
}

/** Test helper: clears breaker and metric state between scenarios. */
export function resetLLMState() {
  breakers.clear();
  metrics.clear();
}

function log(config, event) {
  if (!config.logging) return;
  const line = JSON.stringify({ event: "llm_attempt", ...event });
  if (event.ok) console.info(line);
  else console.warn(line);
}

// ---------------------------------------------------------------------------
// Provider adapters
// ---------------------------------------------------------------------------

function toGeminiPayload(messages, { temperature, json, geminiSchema }) {
  const systemText = messages
    .filter((m) => m.role === "system")
    .map((m) => (typeof m.content === "string" ? m.content : ""))
    .join("\n")
    .trim();

  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => {
      const parts = typeof m.content === "string"
        ? [{ text: m.content }]
        : m.content.map((part) => {
            if (part.type === "image_url") {
              const match = /^data:([^;]+);base64,(.*)$/s.exec(part.image_url?.url || "");
              if (!match) throw new LLMError("Gemini adapter only accepts base64 data URLs for images.", { scope: "provider" });
              return { inline_data: { mime_type: match[1], data: match[2] } };
            }
            return { text: part.text || "" };
          });
      return { role: m.role === "assistant" ? "model" : "user", parts };
    });

  const generationConfig = { temperature };
  if (json) generationConfig.responseMimeType = "application/json";
  if (json && geminiSchema) generationConfig.responseSchema = geminiSchema;

  const payload = { contents, generationConfig };
  if (systemText) payload.systemInstruction = { parts: [{ text: systemText }] };
  return payload;
}

async function sendRequest(provider, model, request, timeoutMs) {
  const { messages, temperature, json, geminiSchema } = request;

  let url;
  let headers;
  let body;
  if (provider.format === "gemini") {
    url = `${provider.endpoint}/${encodeURIComponent(model)}:generateContent`;
    headers = { "Content-Type": "application/json", "x-goog-api-key": provider.apiKey };
    body = toGeminiPayload(messages, { temperature, json, geminiSchema });
  } else {
    url = provider.endpoint;
    headers = { "Content-Type": "application/json" };
    if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`;
    body = { model, messages, temperature };
    if (json) body.response_format = { type: "json_object" };
  }

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify(body),
    });
  } catch (err) {
    const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
    throw new LLMError(
      timedOut ? `${provider.name}/${model} timed out after ${timeoutMs}ms` : `${provider.name}/${model} network error: ${err?.message}`,
      { status: timedOut ? 408 : 0, scope: "model", cause: err }
    );
  }

  let result;
  try {
    result = await response.json();
  } catch {
    throw new LLMError(`${provider.name}/${model} returned a non-JSON body (HTTP ${response.status})`, {
      status: response.status,
      scope: "model",
    });
  }

  if (!response.ok) {
    const message = typeof result?.error?.message === "string" ? result.error.message : `HTTP ${response.status}`;
    throw new LLMError(message, { status: response.status, scope: classifyHttpError(response.status, message) });
  }

  let text;
  let usage;
  if (provider.format === "gemini") {
    text = result.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
    usage = {
      promptTokens: result.usageMetadata?.promptTokenCount || 0,
      completionTokens: result.usageMetadata?.candidatesTokenCount || 0,
    };
  } else {
    text = result.choices?.[0]?.message?.content?.trim();
    usage = {
      promptTokens: result.usage?.prompt_tokens || 0,
      completionTokens: result.usage?.completion_tokens || 0,
    };
  }

  if (!text) {
    throw new LLMError(`${provider.name}/${model} returned an empty response.`, { status: response.status, scope: "model" });
  }

  return { text, usage };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Strips Markdown code fences and parses JSON. Throws on invalid JSON. */
export function parseCleanJson(text) {
  if (!text || typeof text !== "string") {
    throw new Error("AI provider returned an empty response.");
  }
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  }
  return JSON.parse(cleaned);
}

/**
 * Routes one logical LLM request through the provider/model cascade.
 *
 * @param {object} request
 * @param {"text" | "vision"} [request.task]  Selects the model list for each provider.
 * @param {Array<{role: string, content: string | Array<object>}>} request.messages  OpenAI-style messages.
 * @param {number} [request.temperature]
 * @param {boolean} [request.json]  Ask the provider for JSON output.
 * @param {object} [request.geminiSchema]  Optional Gemini responseSchema.
 * @param {(text: string) => any} [request.parse]  Converts raw text to a value; throwing fails over.
 * @param {(value: any) => void} [request.validate]  Throws to reject the output and fail over.
 * @returns {Promise<{ data: any, provider: string, model: string, latencyMs: number, attempts: number }>}
 */
export async function callLLM({
  task = "text",
  messages,
  temperature = 0.6,
  json = true,
  geminiSchema,
  parse = parseCleanJson,
  validate,
}) {
  const config = getConfig();
  const providers = buildProviders();
  if (providers.length === 0) {
    throw new LLMError("No AI provider is configured. Set GROQ_API_KEY, GEMINI_API_KEY or LLM_GATEWAY_URL.", { scope: "provider" });
  }

  const candidates = [];
  for (const provider of providers) {
    for (const model of provider.models[task] || []) {
      candidates.push({ provider, model, key: breakerKey(provider.name, model) });
    }
  }
  if (candidates.length === 0) {
    throw new LLMError(`No models are configured for task "${task}".`, { scope: "provider" });
  }

  // Healthy candidates first; circuit-open ones are kept as a last resort so a request
  // is never refused purely because every model recently failed.
  const ordered = [
    ...candidates.filter((c) => !isBreakerOpen(c.key)),
    ...candidates.filter((c) => isBreakerOpen(c.key)),
  ];

  const startedAt = Date.now();
  const skippedProviders = new Set();
  let attempts = 0;
  let lastError = null;

  for (const { provider, model, key } of ordered) {
    if (skippedProviders.has(provider.name)) continue;

    const remaining = config.deadlineMs - (Date.now() - startedAt);
    if (remaining < MIN_ATTEMPT_BUDGET_MS) {
      lastError = lastError || new LLMError("AI request deadline exceeded.", { status: 408 });
      break;
    }

    attempts += 1;
    const attemptStart = Date.now();
    try {
      const { text, usage } = await sendRequest(
        provider,
        model,
        { messages, temperature, json, geminiSchema },
        Math.min(config.attemptTimeoutMs, remaining)
      );

      let data;
      try {
        data = parse(text);
        if (validate) validate(data);
      } catch (validationErr) {
        throw new LLMError(`${provider.name}/${model} produced invalid output: ${validationErr.message}`, {
          status: 200,
          scope: "model",
        });
      }

      const latencyMs = Date.now() - attemptStart;
      recordBreaker(key, true);
      recordMetrics(key, { ok: true, latencyMs, usage });
      log(config, { task, provider: provider.name, model, ok: true, latencyMs, attempt: attempts, ...usage });

      return { data, provider: provider.name, model, latencyMs: Date.now() - startedAt, attempts };
    } catch (err) {
      const error = err instanceof LLMError ? err : new LLMError(err?.message || "Unknown AI error", { cause: err });
      const latencyMs = Date.now() - attemptStart;
      lastError = error;

      recordBreaker(key, false);
      recordMetrics(key, { ok: false, latencyMs, status: error.status });
      log(config, {
        task,
        provider: provider.name,
        model,
        ok: false,
        status: error.status,
        scope: error.scope,
        latencyMs,
        attempt: attempts,
        error: error.message.slice(0, 200),
      });

      if (error.scope === "provider") skippedProviders.add(provider.name);
    }
  }

  throw lastError || new LLMError("AI request failed across all providers.");
}
