import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detectProvider,
  configureProvider,
  providerBaseURL,
  providerModel,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL
} from "../src/runtime/provider.js";
import { createRuntime } from "../src/runtime/AgentRuntime.js";

function withEnv(t, values) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

async function mockGateway(t) {
  const requests = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      requests.push({
        url: req.url,
        authorization: req.headers.authorization,
        model: JSON.parse(body || "{}").model
      });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        id: "mock",
        object: "chat.completion",
        created: 1,
        model: "root",
        choices: [{ index: 0, message: { role: "assistant", content: "pong" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { requests, baseURL: `http://127.0.0.1:${server.address().port}/v1` };
}

test("provider defaults to the 9router gateway, never api.openai.com", (t) => {
  withEnv(t, {
    OPENROUTER_API_KEY: "gateway-key",
    OPENROUTER_BASE_URL: undefined,
    OPENROUTER_MODEL: undefined,
    OPENAI_API_KEY: undefined,
    OPENAI_BASE_URL: undefined,
    OPENAI_MODEL: undefined
  });
  assert.equal(providerBaseURL(), DEFAULT_BASE_URL);
  assert.equal(providerModel(), DEFAULT_MODEL);
  const detected = detectProvider();
  assert.equal(detected.kind, "9router");
  assert.equal(detected.api, "chat_completions");
});

test("OPENAI_* variables are treated as gateway fallbacks only", (t) => {
  withEnv(t, {
    OPENROUTER_API_KEY: undefined,
    OPENROUTER_BASE_URL: undefined,
    OPENROUTER_MODEL: undefined,
    OPENAI_API_KEY: "legacy-key",
    OPENAI_BASE_URL: undefined,
    OPENAI_MODEL: "some-model"
  });
  const detected = configureProvider();
  assert.equal(detected.kind, "9router");
  assert.equal(detected.baseURL, DEFAULT_BASE_URL);
  assert.ok(!detected.baseURL.includes("api.openai.com"));
});

test("runtime sends chat completions to the configured gateway", async (t) => {
  const gateway = await mockGateway(t);
  withEnv(t, {
    OPENROUTER_API_KEY: "gateway-key",
    OPENROUTER_BASE_URL: gateway.baseURL,
    OPENROUTER_MODEL: "root",
    OPENAI_API_KEY: undefined
  });
  const rootDir = await mkdtemp(join(tmpdir(), "provider-route-"));
  const runtime = await createRuntime({ rootDir, workspaceRoot: join(rootDir, "workspace") });
  const result = await runtime.startRun({ sessionId: "gateway", input: "ping", stream: false });
  assert.equal(result.status, "completed");
  assert.equal(String(result.finalOutput).trim(), "pong");
  assert.equal(gateway.requests.length, 1);
  assert.equal(gateway.requests[0].url, "/v1/chat/completions");
  assert.equal(gateway.requests[0].authorization, "Bearer gateway-key");
  assert.equal(gateway.requests[0].model, "root");
});
