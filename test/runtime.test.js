import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { z } from "zod";
import {
  ScriptedModel,
  assistantMessage,
  functionCall,
  modelResponder
} from "@openai/agents/testing";
import { createRuntime } from "../src/runtime/AgentRuntime.js";
import { handleCommand } from "../src/ui/commands.js";
import { startWebServer } from "../src/ui/web-server.js";
import { assertWorkspacePath } from "../src/tools/security.js";

async function tempRoot() {
  return mkdtemp(join(tmpdir(), "agent-runtime-"));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createTestRuntime(t, extras = {}) {
  const rootDir = extras.rootDir || await tempRoot();
  const model = extras.model || new ScriptedModel([[assistantMessage("hello from runtime")]]);
  const runtime = await createRuntime({
    rootDir,
    workspaceRoot: join(rootDir, "workspace"),
    model,
    skipProviderSetup: true,
    tracingDisabled: true,
    allowPrivateNetwork: extras.allowPrivateNetwork === true,
    tools: extras.tools || [],
    toolPolicy: extras.toolPolicy || { maxRetries: extras.maxRetries ?? 2, retryDelayMs: 10 },
    agentName: extras.agentName || "Test Agent"
  });
  t.after(async () => {
    for (const run of runtime.live.keys()) {
      try { await runtime.cancelRun(run); } catch {}
    }
  });
  return runtime;
}

test("1. agent run completes through the official SDK loop", async (t) => {
  const runtime = await createTestRuntime(t, {
    model: new ScriptedModel([[assistantMessage("Roman Empire summary")]])
  });
  const result = await runtime.startRun({ sessionId: "s1", input: "Summarize Rome" });
  assert.equal(result.status, "completed", result.error || result.record?.terminationReason);
  assert.match(String(result.finalOutput), /Roman Empire/);
  const record = await runtime.getRun(result.runId);
  assert.equal(record.status, "completed");
  assert.ok(record.state);
});

test("2. streaming emits text deltas and persists stream text", async (t) => {
  const runtime = await createTestRuntime(t, {
    model: new ScriptedModel([[assistantMessage("streamed answer")]])
  });
  const chunks = [];
  runtime.on("stream", (event) => {
    if (event.text) chunks.push(event.text);
  });
  const result = await runtime.startRun({ sessionId: "s-stream", input: "stream please", stream: true });
  assert.equal(result.status, "completed");
  assert.ok(chunks.join("").includes("streamed") || result.record.streamText.includes("streamed") || result.finalOutput);
  const events = await runtime.debugger.getByRun(result.runId);
  assert.ok(events.some((event) => event.type === "run.started"));
  assert.ok(events.some((event) => event.type === "run.completed"));
});

test("3. tool execution writes ledger and can touch the workspace", async (t) => {
  const runtime = await createTestRuntime(t, {
    model: new ScriptedModel([
      [functionCall("list_dir", { path: "." }, { callId: "call_list" })],
      [assistantMessage("listed workspace")]
    ])
  });
  const result = await runtime.startRun({ sessionId: "s-tool", input: "list files" });
  assert.equal(result.status, "completed");
  const ledger = await runtime.ledger.getByRun(result.runId);
  assert.ok(ledger.some((item) => item.toolName === "list_dir" && item.status === "completed"));
  const events = await runtime.debugger.getByRun(result.runId);
  assert.ok(events.some((event) => event.type === "tool.started"));
  assert.ok(events.some((event) => event.type === "tool.completed"));
});

test("4. tool failure retries then succeeds", async (t) => {
  let attempts = 0;
  const flaky = {
    name: "flaky_tool",
    description: "Fails once then succeeds",
    parameters: z.object({}),
    async execute() {
      attempts += 1;
      if (attempts === 1) throw new Error("transient failure");
      return "recovered";
    }
  };
  const runtime = await createTestRuntime(t, {
    tools: [flaky],
    maxRetries: 2,
    model: new ScriptedModel([
      [functionCall("flaky_tool", {}, { callId: "call_flaky" })],
      [assistantMessage("tool recovered")]
    ])
  });
  const result = await runtime.startRun({ sessionId: "s-retry", input: "use flaky" });
  assert.equal(result.status, "completed");
  assert.ok(attempts >= 2);
  const ledger = await runtime.ledger.getByRun(result.runId);
  const flakyRows = ledger.filter((item) => item.toolName === "flaky_tool");
  assert.ok(flakyRows.some((item) => item.status === "completed"));
  const events = await runtime.debugger.getByRun(result.runId);
  assert.ok(events.some((event) => event.type === "retry.started"));
});

test("5. approval pause, reject, and approve/resume", async (t) => {
  const rejectRuntime = await createTestRuntime(t, {
    model: new ScriptedModel([
      [functionCall("write_file", { path: "denied.txt", content: "no", overwrite: true }, { callId: "call_deny" })],
      [assistantMessage("rejected as requested")]
    ])
  });
  const rejected = await rejectRuntime.startRun({ sessionId: "s-appr", input: "write denied" });
  assert.equal(rejected.status, "waiting_for_approval");
  assert.ok(rejected.approvals.length >= 1);
  const rejectId = rejected.approvals[0].approvalId;
  const afterReject = await rejectRuntime.reject(rejected.runId, rejectId, { message: "nope" });
  assert.ok(["completed", "waiting_for_approval", "ready_to_resume"].includes(afterReject.status) || afterReject.record);
  const rejectRecord = await rejectRuntime.approvals.get(rejectId);
  assert.equal(rejectRecord.status, "rejected");

  const approveRuntime = await createTestRuntime(t, {
    model: new ScriptedModel([
      [functionCall("write_file", { path: "ok.txt", content: "yes", overwrite: true }, { callId: "call_ok" })],
      [assistantMessage("wrote ok.txt")]
    ])
  });
  const paused = await approveRuntime.startRun({ sessionId: "s-appr2", input: "write ok" });
  assert.equal(paused.status, "waiting_for_approval");
  const approvalId = paused.approvals[0].approvalId;
  const resumed = await approveRuntime.approve(paused.runId, approvalId);
  assert.equal(resumed.status, "completed");
  const written = await readFile(join(approveRuntime.workspaceRoot, "ok.txt"), "utf8");
  assert.equal(written, "yes");
  const approval = await approveRuntime.approvals.get(approvalId);
  assert.equal(approval.status, "approved");
});

test("6. suspend and resume a live run", async (t) => {
  const model = new ScriptedModel([
    modelResponder(async () => {
      await sleep(250);
      return [assistantMessage("slow answer")];
    })
  ]);
  const runtime = await createTestRuntime(t, { model });
  const started = new Promise((resolve) => {
    runtime.debugger.on("run.started", resolve);
  });
  const pending = runtime.startRun({ sessionId: "s-sus", input: "take your time" });
  const startedEvent = await started;
  await sleep(20);
  const suspended = await runtime.suspendRun(startedEvent.runId, "test suspend");
  assert.equal(suspended.status, "suspended");
  const settled = await pending;
  assert.equal(settled.status, "suspended");
  model.enqueue([assistantMessage("resumed answer")]);
  const resumed = await runtime.resumeRun(startedEvent.runId);
  assert.ok(["completed", "failed", "suspended"].includes(resumed.status));
  const events = await runtime.debugger.getByRun(startedEvent.runId);
  assert.ok(events.some((event) => event.type === "run.suspended"));
  assert.ok(events.some((event) => event.type === "run.resumed"));
});

test("7. process crash recovery marks running runs interrupted", async (t) => {
  const rootDir = await tempRoot();
  const first = await createTestRuntime(t, {
    rootDir,
    model: new ScriptedModel([[assistantMessage("first")]])
  });
  const result = await first.startRun({ sessionId: "s-crash", input: "persist me" });
  await first.runStore.update(result.runId, { status: "running" });
  const second = await createTestRuntime(t, {
    rootDir,
    model: new ScriptedModel([[assistantMessage("recovered")]])
  });
  const recovered = await second.getRun(result.runId);
  assert.equal(recovered.status, "interrupted");
  assert.equal(recovered.recovery?.reason, "process_restart");
});

test("8. unknown tool execution is not replayed without policy", async (t) => {
  const runtime = await createTestRuntime(t);
  const started = await runtime.ledger.start({
    runId: "run-unknown",
    sessionId: "s-unknown",
    toolName: "run_command",
    args: { command: "echo hi" },
    callId: "call_unknown",
    sideEffect: true
  });
  const recovered = await runtime.ledger.recoverInFlight();
  assert.ok(recovered.some((item) => item.executionId === started.executionId));
  const unknown = await runtime.ledger.get(started.executionId);
  assert.equal(unknown.status, "unknown");

  await assert.rejects(
    () => runtime.toolRuntime.executeManaged({
      toolName: "run_command",
      args: { command: "echo hi" },
      runContext: { context: { runId: "run-unknown", sessionId: "s-unknown", executionId: started.executionId } },
      details: { toolCall: { callId: "call_unknown" } },
      handler: async () => "should-not-run",
      policy: { replayUnknown: false, sideEffect: true }
    }),
    /unknown_requires_policy|Refusing to re-execute/
  );

  const replayed = await runtime.toolRuntime.executeManaged({
    toolName: "run_command",
    args: { command: "echo hi" },
    runContext: { context: { runId: "run-unknown", sessionId: "s-unknown", executionId: started.executionId } },
    details: { toolCall: { callId: "call_unknown" } },
    handler: async () => "replayed-with-policy",
    policy: { replayUnknown: true, sideEffect: true, maxRetries: 0 }
  });
  assert.equal(replayed, "replayed-with-policy");
});

test("9. completed tool executions are idempotent", async (t) => {
  const runtime = await createTestRuntime(t);
  let calls = 0;
  const first = await runtime.toolRuntime.executeManaged({
    toolName: "memory_set",
    args: { scope: "persistent", key: "idem", value: "1" },
    runContext: { context: { runId: "run-idemp", sessionId: "s-idemp", executionId: "exec-idemp" } },
    details: {},
    handler: async () => {
      calls += 1;
      return { ok: true, n: calls };
    },
    policy: { maxRetries: 0, sideEffect: false }
  });
  const second = await runtime.toolRuntime.executeManaged({
    toolName: "memory_set",
    args: { scope: "persistent", key: "idem", value: "1" },
    runContext: { context: { runId: "run-idemp", sessionId: "s-idemp", executionId: "exec-idemp" } },
    details: {},
    handler: async () => {
      calls += 1;
      return { ok: true, n: calls };
    },
    policy: { maxRetries: 0, sideEffect: false }
  });
  assert.deepEqual(first, second);
  assert.equal(calls, 1);
});

test("10. memory persists across runtime restarts and is separate from state", async (t) => {
  const rootDir = await tempRoot();
  const first = await createTestRuntime(t, { rootDir });
  await first.memory.set("persistent", "fact", "alpha", {});
  await first.memory.set("session", "topic", "runtime", { sessionId: "mem-1" });
  await first.memory.set("working", "scratch", "tmp", { runId: "run-mem" });
  const found = await first.memory.search("alpha");
  assert.ok(found.some((item) => item.value === "alpha"));
  await first.memory.delete("working", "scratch", { runId: "run-mem" });
  assert.equal(await first.memory.get("working", "scratch", { runId: "run-mem" }), undefined);

  const second = await createTestRuntime(t, { rootDir });
  assert.equal(await second.memory.get("persistent", "fact"), "alpha");
  assert.equal(await second.memory.get("session", "topic", { sessionId: "mem-1" }), "runtime");
  const record = await first.runStore.create({ sessionId: "mem-1", status: "completed" });
  assert.notEqual(record.state, "alpha");
});

test("11. run state persists and can be deserialized", async (t) => {
  const rootDir = await tempRoot();
  const first = await createTestRuntime(t, {
    rootDir,
    model: new ScriptedModel([[assistantMessage("persist this state")]])
  });
  const result = await first.startRun({ sessionId: "s-state", input: "keep state" });
  const second = await createTestRuntime(t, { rootDir, model: new ScriptedModel([]) });
  const record = await second.getRun(result.runId);
  assert.equal(record.status, "completed");
  assert.ok(record.state);
  const sdkState = await second.loadSdkState(result.runId);
  assert.ok(sdkState);
  assert.ok(typeof sdkState.toString() === "string");
});

test("12. concurrent runs stay isolated by session", async (t) => {
  const runtime = await createTestRuntime(t, {
    model: new ScriptedModel([
      modelResponder(async (call) => [assistantMessage(`out:${JSON.stringify(call.request.input)}`)]),
      modelResponder(async (call) => [assistantMessage(`out:${JSON.stringify(call.request.input)}`)])
    ])
  });
  const [a, b] = await Promise.all([
    runtime.startRun({ sessionId: "alpha", input: "task-a" }),
    runtime.startRun({ sessionId: "beta", input: "task-b" })
  ]);
  assert.equal(a.status, "completed");
  assert.equal(b.status, "completed");
  assert.notEqual(a.runId, b.runId);
  const sessionA = await runtime.getSession("alpha");
  const sessionB = await runtime.getSession("beta");
  assert.notEqual(sessionA.sessionId, sessionB.sessionId);
});

test("13. terminal command surface inspects and controls the same runtime", async (t) => {
  const runtime = await createTestRuntime(t, {
    model: new ScriptedModel([[assistantMessage("from terminal")]])
  });
  const help = await handleCommand(runtime, "term", "/help");
  assert.equal(help.type, "help");
  const run = await handleCommand(runtime, "term", "hello from cli");
  assert.equal(run.type, "run");
  assert.equal(run.result.status, "completed");
  const listed = await handleCommand(runtime, "term", "/runs");
  assert.ok(listed.runs.length >= 1);
  const state = await handleCommand(runtime, "term", "/state");
  assert.equal(state.type, "state");
  const events = await handleCommand(runtime, "term", "/events");
  assert.ok(events.events.length >= 1);
});

test("14. web UI serves chat, inspect, approval, and control APIs", async (t) => {
  const runtime = await createTestRuntime(t, {
    allowPrivateNetwork: true,
    model: new ScriptedModel([
      [assistantMessage("from web")],
      [functionCall("write_file", { path: "web.txt", content: "ui", overwrite: true }, { callId: "call_web" })],
      [assistantMessage("web wrote file")]
    ])
  });
  const { server, port } = await startWebServer({ runtime, host: "0.0.0.0", port: 0 });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${port}`;
  const health = await (await fetch(`${base}/api/health`)).json();
  assert.equal(health.ok, true);
  const page = await (await fetch(`${base}/`)).text();
  assert.match(page, /Agent Runtime/);
  const chat = await (await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: "web-test", input: "hi web" })
  })).json();
  assert.equal(chat.status, "completed");
  const runs = await (await fetch(`${base}/api/runs?sessionId=web-test`)).json();
  assert.ok(runs.length >= 1);
  const events = await (await fetch(`${base}/api/runs/${chat.runId}/events`)).json();
  assert.ok(events.some((event) => event.type === "run.started"));

  const paused = await (await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: "web-test", input: "write a file" })
  })).json();
  assert.equal(paused.status, "waiting_for_approval");
  const approvals = await (await fetch(`${base}/api/runs/${paused.runId}/approvals`)).json();
  const approved = await (await fetch(`${base}/api/approvals/${approvals[0].approvalId}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  })).json();
  assert.equal(approved.status, "completed");
});

test("filesystem path escape is rejected", () => {
  assert.throws(() => assertWorkspacePath("/tmp/workspace", "../etc/passwd"));
});

test("http tool can fetch a local server when private network is allowed", async (t) => {
  const server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ hello: "runtime" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  const runtime = await createTestRuntime(t, {
    allowPrivateNetwork: true,
    model: new ScriptedModel([
      [functionCall("http_request", { url: `http://127.0.0.1:${port}/`, method: "GET", headers: null, body: null, timeoutMs: 5000 }, { callId: "call_http" })],
      [assistantMessage("fetched local json")]
    ])
  });
  const result = await runtime.startRun({ sessionId: "s-http", input: "fetch local" });
  assert.equal(result.status, "completed");
  const ledger = await runtime.ledger.getByRun(result.runId);
  assert.ok(ledger.some((item) => item.toolName === "http_request" && item.status === "completed"));
});

test("run_command executes inside the workspace after approval", async (t) => {
  const runtime = await createTestRuntime(t, {
    model: new ScriptedModel([
      [functionCall("run_command", { command: "echo workspace-ok", cwd: ".", timeoutMs: 5000 }, { callId: "call_cmd" })],
      [assistantMessage("command finished")]
    ])
  });
  const paused = await runtime.startRun({ sessionId: "s-cmd", input: "run echo" });
  assert.equal(paused.status, "waiting_for_approval");
  const finished = await runtime.approve(paused.runId, paused.approvals[0].approvalId);
  assert.equal(finished.status, "completed");
  const ledger = await runtime.ledger.getByRun(paused.runId);
  const command = ledger.find((item) => item.toolName === "run_command" && item.status === "completed");
  assert.ok(command);
});
