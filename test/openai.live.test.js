import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntime } from "../src/runtime/AgentRuntime.js";
import { detectProvider } from "../src/runtime/provider.js";

test("live OpenAI/OpenRouter agent run", async (t) => {
  const provider = detectProvider();
  if (provider.kind === "none") {
    t.skip("No OPENAI_API_KEY or OPENROUTER_API_KEY in environment");
    return;
  }
  const rootDir = await mkdtemp(join(tmpdir(), "agent-live-"));
  const runtime = await createRuntime({
    rootDir,
    workspaceRoot: join(rootDir, "workspace"),
    tracingDisabled: true
  });
  const result = await runtime.startRun({
    sessionId: "live",
    input: "Reply with the single word pong and nothing else."
  });
  assert.ok(["completed", "waiting_for_approval"].includes(result.status));
  if (result.status === "completed") {
    assert.ok(String(result.finalOutput || "").toLowerCase().includes("pong"));
  }
});
