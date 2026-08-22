import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { createRuntime } from "../runtime/AgentRuntime.js";
import { handleCommand } from "./commands.js";

function printResult(result) {
  if (!result) return;
  if (result.type === "help") {
    console.log(`\n${result.text}\n`);
    return;
  }
  if (result.type === "error") {
    console.error(`\n[error] ${result.error}\n`);
    return;
  }
  if (result.type === "runs") {
    for (const run of result.runs) {
      console.log(`- ${run.runId}  ${run.status}  turn=${run.currentTurn}`);
    }
    return;
  }
  if (result.type === "state") {
    console.log(JSON.stringify({
      runId: result.record.runId,
      status: result.record.status,
      turnStatus: result.record.turnStatus,
      agentStatus: result.record.agentStatus,
      toolStatus: result.record.toolStatus,
      approvalStatus: result.record.approvalStatus,
      retryStatus: result.record.retryStatus,
      finalOutput: result.record.finalOutput,
      error: result.record.error
    }, null, 2));
    return;
  }
  if (result.type === "session") {
    console.log(`session ${result.session.sessionId} items=${result.session.items.length} status=${result.session.metadata.status}`);
    return;
  }
  if (result.type === "memory") {
    console.log(JSON.stringify(result.results, null, 2));
    return;
  }
  if (result.type === "events") {
    for (const event of result.events) {
      console.log(`${event.timestamp}  ${event.type}  ${event.runId || ""}`);
    }
    return;
  }
  if (result.type === "ledger") {
    for (const item of result.records) {
      console.log(`${item.executionId}  ${item.toolName}  ${item.status}  attempt=${item.attempt}`);
    }
    return;
  }
  if (result.type === "approvals") {
    for (const item of result.approvals) {
      console.log(`${item.approvalId}  ${item.toolName}  ${item.status}  ${JSON.stringify(item.arguments)}`);
    }
    return;
  }
  if (result.type === "record") {
    console.log(`${result.record.runId} -> ${result.record.status}`);
    return;
  }
  if (result.type === "run") {
    const run = result.result;
    if (run.status === "waiting_for_approval") {
      console.log(`\nPaused for approval (${run.approvals.length})`);
      for (const approval of run.approvals) {
        console.log(`  ${approval.approvalId}  ${approval.toolName}  ${JSON.stringify(approval.arguments)}`);
      }
      console.log("Use /approve <id> or /reject <id>\n");
      return;
    }
    if (run.finalOutput) console.log(`\n${run.finalOutput}\n`);
    if (run.error) console.error(`\n[error] ${run.error}\n`);
    console.log(`[${run.status}] ${run.runId}`);
  }
}

export async function startTerminal({ runtime, sessionId = "SESSION-1" } = {}) {
  const resolved = runtime || await createRuntime();
  await resolved.getSession(sessionId);
  const rl = readline.createInterface({ input: stdin, output: stdout });
  console.log("Autonomous Agent Runtime");
  console.log("Type a message or /help. Type exit to quit.\n");

  resolved.on("stream", (event) => {
    if (event.text) process.stdout.write(event.text);
    if (event.item?.type === "tool_call_item") {
      console.log(`\n[tool] ${event.item.name} ${event.item.arguments || ""}`);
    }
    if (event.item?.type === "tool_call_output_item") {
      console.log(`[tool:done] ${event.item.name || ""}`);
    }
  });

  try {
    while (true) {
      const line = await rl.question("> ");
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (["exit", "quit"].includes(trimmed.toLowerCase())) break;
      const result = await handleCommand(resolved, sessionId, trimmed);
      printResult(result);
    }
  } finally {
    rl.close();
  }
}
