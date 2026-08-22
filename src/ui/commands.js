export function parseCommand(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed.startsWith("/")) {
    return { type: "chat", text: trimmed };
  }
  const [name, ...rest] = trimmed.slice(1).split(/\s+/);
  return { type: "command", name: name.toLowerCase(), args: rest, raw: trimmed };
}

export async function handleCommand(runtime, sessionId, line, helpers = {}) {
  const parsed = parseCommand(line);
  if (parsed.type === "chat") {
    if (!parsed.text) return { type: "empty" };
    const result = await runtime.startRun({
      sessionId,
      input: parsed.text,
      stream: helpers.stream !== false
    });
    return { type: "run", result };
  }

  const { name, args } = parsed;
  if (name === "help") {
    return {
      type: "help",
      text: [
        "/help                 Show commands",
        "/runs                 List runs in this session",
        "/state [runId]        Inspect persisted run state",
        "/session              Inspect session history",
        "/memory [scope] [q]   Search memory",
        "/events [runId]       Show debugger timeline",
        "/ledger [runId]       Show tool execution ledger",
        "/approvals [runId]    List pending approvals",
        "/approve <id>         Approve a tool call",
        "/reject <id> [msg]    Reject a tool call",
        "/resume [runId]       Resume a paused/interrupted run",
        "/retry [runId]        Retry a failed run",
        "/suspend [runId]      Suspend the active run",
        "/cancel [runId]       Cancel the active run",
        "exit                  Quit"
      ].join("\n")
    };
  }

  const latest = async () => {
    const runs = await runtime.listRuns(sessionId);
    return args[0] || runs[0]?.runId;
  };

  if (name === "runs") {
    return { type: "runs", runs: await runtime.listRuns(sessionId) };
  }
  if (name === "state") {
    const runId = await latest();
    if (!runId) return { type: "error", error: "No run to inspect" };
    return { type: "state", record: await runtime.getRun(runId) };
  }
  if (name === "session") {
    return { type: "session", session: await runtime.getSession(sessionId) };
  }
  if (name === "memory") {
    const scope = ["working", "session", "persistent"].includes(args[0]) ? args[0] : undefined;
    const query = scope ? args.slice(1).join(" ") : args.join(" ");
    return {
      type: "memory",
      results: await runtime.memory.search(query, { scope, sessionId })
    };
  }
  if (name === "events") {
    const runId = args[0];
    return { type: "events", events: await runtime.debugger.query({ runId, sessionId, limit: 100 }) };
  }
  if (name === "ledger") {
    const runId = await latest();
    return { type: "ledger", records: runId ? await runtime.ledger.getByRun(runId) : [] };
  }
  if (name === "approvals") {
    const runId = await latest();
    return { type: "approvals", approvals: runId ? await runtime.approvals.listByRun(runId) : [] };
  }
  if (name === "approve") {
    const approvalId = args[0];
    if (!approvalId) return { type: "error", error: "approval id required" };
    const approval = await runtime.approvals.get(approvalId);
    if (!approval) return { type: "error", error: "approval not found" };
    return { type: "run", result: await runtime.approve(approval.runId, approvalId) };
  }
  if (name === "reject") {
    const approvalId = args[0];
    if (!approvalId) return { type: "error", error: "approval id required" };
    const approval = await runtime.approvals.get(approvalId);
    if (!approval) return { type: "error", error: "approval not found" };
    return {
      type: "run",
      result: await runtime.reject(approval.runId, approvalId, {
        message: args.slice(1).join(" ") || "Rejected from terminal"
      })
    };
  }
  if (name === "resume") {
    const runId = await latest();
    if (!runId) return { type: "error", error: "No run to resume" };
    return { type: "run", result: await runtime.resumeRun(runId) };
  }
  if (name === "retry") {
    const runId = await latest();
    if (!runId) return { type: "error", error: "No run to retry" };
    return { type: "run", result: await runtime.retryRun(runId) };
  }
  if (name === "suspend") {
    const runId = await latest();
    if (!runId) return { type: "error", error: "No run to suspend" };
    return { type: "record", record: await runtime.suspendRun(runId) };
  }
  if (name === "cancel") {
    const runId = await latest();
    if (!runId) return { type: "error", error: "No run to cancel" };
    return { type: "record", record: await runtime.cancelRun(runId) };
  }
  return { type: "error", error: `Unknown command /${name}` };
}
