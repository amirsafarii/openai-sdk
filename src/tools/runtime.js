const SIDE_EFFECT_TOOLS = new Set([
  "write_file",
  "delete_file",
  "run_command",
  "http_request"
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseInput(input) {
  if (input == null) return {};
  if (typeof input === "string") {
    try {
      return JSON.parse(input);
    } catch {
      return { raw: input };
    }
  }
  return input;
}

export function hasSideEffect(toolName, args = {}) {
  if (toolName === "http_request") {
    const method = String(args.method || "GET").toUpperCase();
    return method !== "GET" && method !== "HEAD";
  }
  return SIDE_EFFECT_TOOLS.has(toolName);
}

export class ToolRuntime {
  constructor({ ledger, debugger: eventDebugger, defaultRetries = 2 }) {
    this.ledger = ledger;
    this.debugger = eventDebugger;
    this.defaultRetries = defaultRetries;
  }

  wrap(baseTool, policy = {}) {
    if (!baseTool || baseTool.type !== "function" || typeof baseTool.invoke !== "function") {
      return baseTool;
    }
    const originalInvoke = baseTool.invoke.bind(baseTool);
    const runtime = this;
    return {
      ...baseTool,
      invoke: async (runContext, input, details) => {
        const args = parseInput(input);
        return runtime.executeManaged({
          toolName: baseTool.name,
          args,
          runContext,
          details,
          handler: () => originalInvoke(runContext, input, details),
          policy: {
            maxRetries: policy.maxRetries ?? runtime.defaultRetries,
            retryDelayMs: policy.retryDelayMs ?? 150,
            replayUnknown: policy.replayUnknown === true,
            replayFailed: policy.replayFailed === true,
            sideEffect: hasSideEffect(baseTool.name, args)
          }
        });
      }
    };
  }

  async executeManaged({ toolName, args, runContext, details, handler, policy }) {
    const app = runContext?.context || {};
    const runId = app.runId;
    const sessionId = app.sessionId;
    const callId = details?.toolCall?.callId || details?.toolCall?.id || app.callId || null;
    const argumentsHash = this.ledger.argumentsHash(args);
    const executionId =
      app.executionId ||
      this.ledger.createExecutionId({ runId, toolName, callId, argumentsHash });

    const existing = await this.ledger.get(executionId);
    const decision = this.ledger.canReplay(existing, policy);

    if (existing?.status === "completed") {
      return existing.result;
    }
    if (!decision.allowed) {
      const error = new Error(
        `Refusing to re-execute tool ${toolName} (${executionId}): ${decision.reason}`
      );
      error.code = "TOOL_REPLAY_BLOCKED";
      error.executionId = executionId;
      error.ledgerStatus = existing?.status;
      throw error;
    }

    const maxRetries = Math.max(0, policy.maxRetries ?? this.defaultRetries);
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      const record = await this.ledger.start({
        runId,
        sessionId,
        toolName,
        args,
        callId,
        sideEffect: policy.sideEffect,
        executionId
      });

      if (this.debugger) {
        await this.debugger.append({
          type: "tool.started",
          runId,
          sessionId,
          turnId: app.turnId,
          data: {
            executionId: record.executionId,
            toolName,
            arguments: args,
            attempt: record.attempt
          }
        });
      }

      try {
        if (details?.signal?.aborted) {
          throw Object.assign(new Error("Tool execution cancelled"), { name: "AbortError" });
        }
        const result = await handler();
        await this.ledger.complete(record.executionId, { result, status: "completed" });
        if (this.debugger) {
          await this.debugger.append({
            type: "tool.completed",
            runId,
            sessionId,
            turnId: app.turnId,
            data: {
              executionId: record.executionId,
              toolName,
              attempt: record.attempt
            }
          });
        }
        return result;
      } catch (error) {
        lastError = error;
        const cancelled = error?.name === "AbortError" || Boolean(details?.signal?.aborted);
        const status = cancelled ? "cancelled" : "failed";
        await this.ledger.complete(record.executionId, {
          status,
          error: error instanceof Error ? error.message : String(error)
        });
        if (this.debugger) {
          await this.debugger.append({
            type: "tool.failed",
            runId,
            sessionId,
            turnId: app.turnId,
            data: {
              executionId: record.executionId,
              toolName,
              attempt: record.attempt,
              error: error instanceof Error ? error.message : String(error),
              cancelled
            }
          });
        }
        if (cancelled || attempt > maxRetries) {
          throw error;
        }
        if (this.debugger) {
          await this.debugger.append({
            type: "retry.started",
            runId,
            sessionId,
            data: { executionId: record.executionId, toolName, attempt: attempt + 1 }
          });
        }
        await sleep(policy.retryDelayMs * attempt);
        if (this.debugger) {
          await this.debugger.append({
            type: "retry.completed",
            runId,
            sessionId,
            data: { executionId: record.executionId, toolName, attempt: attempt + 1 }
          });
        }
      }
    }

    throw lastError;
  }
}

export function wrapTools(tools, toolRuntime, policy) {
  return tools.map((item) => toolRuntime.wrap(item, policy));
}
