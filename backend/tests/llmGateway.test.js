import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import app from "../app.js";
import { callLLM, getLLMStats, redactSecrets, resetLLMState } from "../services/llmGateway.js";

const originalFetch = globalThis.fetch;

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function openAiBody(content) {
  return { choices: [{ message: { content } }], usage: { prompt_tokens: 11, completion_tokens: 7 } };
}

function geminiBody(text) {
  return { candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3 } };
}

async function withEnv(vars, fn) {
  const saved = {};
  for (const [key, value] of Object.entries(vars)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
  resetLLMState();
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetLLMState();
  }
}

const userMessage = [{ role: "user", content: "Say hi as JSON" }];

test("LLM Gateway: external gateway is preferred and receives OpenAI-compatible payloads", async () => {
  await withEnv(
    {
      LLM_GATEWAY_URL: "https://gateway.example.com/v1/",
      LLM_GATEWAY_API_KEY: "gw-test-key-123456",
      LLM_GATEWAY_TEXT_MODELS: "groq/openai/gpt-oss-120b",
      GROQ_API_KEY: "gsk_testGroqKey1234567890abcdefghijklmnop",
    },
    async () => {
      const calls = [];
      globalThis.fetch = async (url, options) => {
        calls.push({ url, headers: options.headers, body: JSON.parse(options.body) });
        return jsonResponse(200, openAiBody('{"hello":"world"}'));
      };

      const result = await callLLM({ messages: userMessage });

      assert.deepStrictEqual(result.data, { hello: "world" });
      assert.strictEqual(result.provider, "gateway");
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0].url, "https://gateway.example.com/v1/chat/completions");
      assert.strictEqual(calls[0].headers.Authorization, "Bearer gw-test-key-123456");
      assert.strictEqual(calls[0].body.model, "groq/openai/gpt-oss-120b");
      assert.deepStrictEqual(calls[0].body.response_format, { type: "json_object" });
    }
  );
});

test("LLM Gateway: rate limit cascades to next model, auth failure skips the whole provider", async () => {
  await withEnv(
    { GROQ_API_KEY: "gsk_testGroqKey1234567890abcdefghijklmnop", GROQ_TEXT_MODELS: "m1,m2,m3", GEMINI_TEXT_MODELS: "g1" },
    async () => {
      const attempted = [];
      globalThis.fetch = async (url, options) => {
        if (url.includes("api.groq.com")) {
          const { model } = JSON.parse(options.body);
          attempted.push(model);
          if (model === "m1") return jsonResponse(429, { error: { message: "rate limited" } });
          return jsonResponse(401, { error: { message: "invalid key" } });
        }
        attempted.push("gemini");
        return jsonResponse(200, geminiBody('{"ok":true}'));
      };

      const result = await callLLM({ messages: userMessage });

      // m3 is never tried: the 401 on m2 marks the whole Groq provider as unusable.
      assert.deepStrictEqual(attempted, ["m1", "m2", "gemini"]);
      assert.strictEqual(result.provider, "gemini");
      assert.strictEqual(result.attempts, 3);
    }
  );
});

test("LLM Gateway: invalid model output fails over to the next model", async () => {
  await withEnv({ GEMINI_TEXT_MODELS: "bad-model,good-model" }, async () => {
    globalThis.fetch = async (url) =>
      jsonResponse(200, geminiBody(url.includes("bad-model") ? '{"title":""}' : '{"title":"Dal Tadka"}'));

    const result = await callLLM({
      messages: userMessage,
      validate: (recipe) => {
        if (!recipe.title) throw new Error("missing title");
      },
    });

    assert.strictEqual(result.model, "good-model");
    assert.strictEqual(result.data.title, "Dal Tadka");
  });
});

test("LLM Gateway: overall deadline caps the cascade", async () => {
  await withEnv({ GEMINI_TEXT_MODELS: "a,b,c,d,e", LLM_DEADLINE_MS: "2000", LLM_ATTEMPT_TIMEOUT_MS: "800" }, async () => {
    globalThis.fetch = (url, options) =>
      new Promise((_, reject) => {
        options.signal.addEventListener("abort", () => reject(options.signal.reason));
      });

    const startedAt = Date.now();
    await assert.rejects(() => callLLM({ messages: userMessage }), /timed out|deadline/);
    assert.ok(Date.now() - startedAt < 2_500, "cascade must stop at the deadline");
  });
});

test("LLM Gateway: Gemini adapter maps system prompts and base64 images", async () => {
  await withEnv({ GEMINI_VISION_MODELS: "vision-model" }, async () => {
    let captured = null;
    globalThis.fetch = async (url, options) => {
      captured = JSON.parse(options.body);
      return jsonResponse(200, geminiBody('{"ingredients":[]}'));
    };

    await callLLM({
      task: "vision",
      messages: [
        { role: "system", content: "Be precise." },
        {
          role: "user",
          content: [
            { type: "text", text: "What is this?" },
            { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } },
          ],
        },
      ],
      geminiSchema: { type: "OBJECT" },
    });

    assert.deepStrictEqual(captured.systemInstruction, { parts: [{ text: "Be precise." }] });
    assert.strictEqual(captured.contents[0].parts[0].text, "What is this?");
    assert.deepStrictEqual(captured.contents[0].parts[1], { inline_data: { mime_type: "image/png", data: "iVBORw0KGgo=" } });
    assert.deepStrictEqual(captured.generationConfig.responseSchema, { type: "OBJECT" });
  });
});

test("LLM Gateway: circuit breaker deprioritizes a repeatedly failing model and metrics track usage", async () => {
  await withEnv({ GEMINI_TEXT_MODELS: "flaky,stable" }, async () => {
    const attempted = [];
    globalThis.fetch = async (url) => {
      const model = url.includes("flaky") ? "flaky" : "stable";
      attempted.push(model);
      return model === "flaky"
        ? jsonResponse(503, { error: { message: "overloaded" } })
        : jsonResponse(200, geminiBody('{"ok":true}'));
    };

    for (let i = 0; i < 3; i += 1) await callLLM({ messages: userMessage });
    attempted.length = 0;
    await callLLM({ messages: userMessage });

    assert.deepStrictEqual(attempted, ["stable"]);
    const stats = getLLMStats();
    assert.strictEqual(stats.models["gemini:flaky"].circuitOpen, true);
    assert.strictEqual(stats.models["gemini:stable"].successes, 4);
    assert.strictEqual(stats.models["gemini:stable"].promptTokens, 20);
  });
});

test("LLM Gateway: secrets are redacted from error messages", async () => {
  await withEnv({ LLM_GATEWAY_API_KEY: "my-custom-gateway-secret" }, async () => {
    const redacted = redactSecrets(
      "bad key gsk_abcdefghijklmnopqrstuvwxyz0123 and AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6 and my-custom-gateway-secret"
    );
    assert.strictEqual(redacted.includes("gsk_"), false);
    assert.strictEqual(redacted.includes("AIza"), false);
    assert.strictEqual(redacted.includes("my-custom-gateway-secret"), false);
  });
});

test("LLM Gateway: /api/health/ai is hidden by default and token-protected when enabled", async () => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await withEnv({ LLM_STATS_TOKEN: "" }, async () => {
      assert.strictEqual((await fetch(`${baseUrl}/api/health/ai`)).status, 404);
    });
    await withEnv({ LLM_STATS_TOKEN: "stats-token-123" }, async () => {
      assert.strictEqual((await fetch(`${baseUrl}/api/health/ai`)).status, 401);
      const ok = await fetch(`${baseUrl}/api/health/ai`, { headers: { Authorization: "Bearer stats-token-123" } });
      assert.strictEqual(ok.status, 200);
      const data = await ok.json();
      assert.ok(Array.isArray(data.providers));
      assert.strictEqual(JSON.stringify(data).includes("test-gemini-key"), false);
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
