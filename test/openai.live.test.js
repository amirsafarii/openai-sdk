import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntime } from "../src/runtime/AgentRuntime.js";
import { detectProvider } from "../src/runtime/provider.js";

test("live gateway agent run", async (t) => {
  const provider = detectProvider();
  if (provider.kind === "none") {
    t.skip("No OPENROUTER_API_KEY (gateway key) in environment");
    return;
  }
  if (process.env.LIVE_PROVIDER_TEST !== "1") {
    t.skip("Set LIVE_PROVIDER_TEST=1 to hit the real gateway");
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
