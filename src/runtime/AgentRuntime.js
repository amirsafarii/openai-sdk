import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { Runner, RunState } from "@openai/agents";
import { EventEmitter } from "node:events";
import { nowIso } from "../lib/ids.js";
import { ReentrantLockManager } from "../store/ReentrantLockManager.js";
import { RunStore, isTerminalStatus, isResumableStatus } from "../state/RunStore.js";
import { SessionStore, SessionManager } from "../state/SessionStore.js";
import { MemoryStore } from "../memory/MemoryStore.js";
import { EventDebugger } from "../debugger/EventDebugger.js";
import { ExecutionLedger } from "../ledger/ExecutionLedger.js";
import { ApprovalManager } from "../approval/ApprovalManager.js";
import { ToolRuntime } from "../tools/runtime.js";
import { createBuiltinTools } from "../tools/catalog.js";
import { materializeTool } from "../tools/define.js";
import { createRuntimeAgent } from "./createAgent.js";
import { configureProvider, detectProvider } from "./provider.js";
import { extractReasoningDelta, extractTextDelta, interruptionMeta, summarizeRunItem } from "./stream.js";

export class AgentRuntime extends EventEmitter {
  constructor(options = {}) {
    super();
    this.setMaxListeners(0);
    this.rootDir = resolve(options.rootDir || "./data");
    this.workspaceRoot = resolve(options.workspaceRoot || resolve(this.rootDir, "workspace"));
    this.lockManager = options.lockManager || new ReentrantLockManager();
    this.runStore = options.runStore || new RunStore({
      directory: resolve(this.rootDir, "runs"),
      lockManager: this.lockManager
    });
    this.sessionStore = options.sessionStore || new SessionStore({
      directory: resolve(this.rootDir, "sessions"),
      lockManager: this.lockManager
    });
    this.sessionManager = options.sessionManager || new SessionManager({
      sessionStore: this.sessionStore,
      lockManager: this.lockManager
    });
    this.memory = options.memory || new MemoryStore({
      directory: resolve(this.rootDir, "memory"),
      lockManager: this.lockManager
    });
    this.debugger = options.debugger || new EventDebugger({
      directory: resolve(this.rootDir, "events"),
      lockManager: this.lockManager
    });
    this.ledger = options.ledger || new ExecutionLedger({
      directory: resolve(this.rootDir, "ledger"),
      lockManager: this.lockManager
    });
    this.approvals = options.approvals || new ApprovalManager({
      directory: resolve(this.rootDir, "approvals"),
      lockManager: this.lockManager,
      debugger: this.debugger
    });
    this.toolRuntime = options.toolRuntime || new ToolRuntime({
      ledger: this.ledger,
      debugger: this.debugger,
      defaultRetries: options.toolRetries ?? 2
    });
    this.toolPolicy = options.toolPolicy || {};
    this.extraTools = options.tools || [];
    this.model = options.model;
    this.modelProvider = options.modelProvider;
    this.agentName = options.agentName || "Autonomous Agent";
    this.instructions = options.instructions;
    this.maxTurns = options.maxTurns ?? 12;
    this.allowPrivateNetwork = options.allowPrivateNetwork === true;
    this.provider = options.skipProviderSetup ? detectProvider() : configureProvider();
    this.runner = options.runner || new Runner({
      ...(this.model ? { model: this.model } : {}),
      ...(this.modelProvider ? { modelProvider: this.modelProvider } : {}),
      tracingDisabled: options.tracingDisabled !== false,
      traceIncludeSensitiveData: false,
      toolNotFoundBehavior: "return_error_to_model"
    });
    this.live = new Map();
    this.ready = false;
  }

  createTools() {
    return [
      ...createBuiltinTools(this.toolRuntime, this.toolPolicy),
      ...this.extraTools.map((item) => materializeTool(item, this.toolRuntime, this.toolPolicy))
    ];
  }

  createAgent(overrides = {}) {
    return createRuntimeAgent({
      name: overrides.name || this.agentName,
      instructions: overrides.instructions || this.instructions,
      model: overrides.model || this.model,
      tools: overrides.tools || this.createTools()
    });
  }

  async init() {
    if (this.ready) return this;
    await mkdir(this.rootDir, { recursive: true });
    await mkdir(this.workspaceRoot, { recursive: true });
    await Promise.all([
      this.runStore.init(),
      this.sessionStore.init(),
      this.memory.init(),
      this.debugger.init(),
      this.ledger.init(),
      this.approvals.init()
    ]);
    await this.recover();
    this.ready = true;
    return this;
  }

  async recover() {
    const unknown = await this.ledger.recoverInFlight();
    const runs = await this.runStore.list();
    const interrupted = [];
    for (const record of runs) {
      if (record.status === "running") {
        const updated = await this.runStore.update(record.runId, {
          status: "interrupted",
          toolStatus: "unknown",
          recovery: {
            reason: "process_restart",
            recoveredAt: nowIso(),
            unknownExecutions: unknown.filter((item) => item.runId === record.runId).map((item) => item.executionId)
          }
        });
        await this.emitEvent("run.suspended", updated, {
          reason: "process_restart",
          unknownExecutions: updated.recovery.unknownExecutions
        });
        interrupted.push(updated);
      }
    }
    return { unknown, interrupted };
  }

  async emitEvent(type, record, data = {}) {
    const event = await this.debugger.append({
      type,
      runId: record?.runId,
      sessionId: record?.sessionId,
      turnId: record?.turnId,
      agentName: record?.agentName,
      data
    });
    this.emit("event", event);
    this.emit(`run:${record?.runId}`, event);
    return event;
  }

  async getSession(sessionId = "default") {
    await this.init();
    return this.sessionStore.read(sessionId);
  }

  async listSessions() {
    await this.init();
    return this.sessionStore.list();
  }

  async getRun(runId) {
    await this.init();
    return this.runStore.get(runId);
  }

  async listRuns(sessionId) {
    await this.init();
    return sessionId ? this.runStore.listBySession(sessionId) : this.runStore.list();
  }

  async loadSdkState(runId, agent) {
    const record = await this.runStore.get(runId);
    if (!record) throw new Error(`Run not found: ${runId}`);
    if (!record.state) throw new Error(`Run ${runId} has no persisted RunState`);
    return RunState.fromString(agent || this.createAgent(), record.state);
  }

  buildContext(record) {
    return {
      runId: record.runId,
      sessionId: record.sessionId,
      turnId: record.turnId,
      workspaceRoot: this.workspaceRoot,
      memory: this.memory,
      ledger: this.ledger,
      approvals: this.approvals,
      runtime: this,
      allowPrivateNetwork: this.allowPrivateNetwork
    };
  }

  attachLive(runId, live) {
    this.live.set(runId, live);
  }

  getLive(runId) {
    return this.live.get(runId) || null;
  }

  clearLive(runId) {
    this.live.delete(runId);
  }

  async persistState(record, result, extra = {}) {
    let serialized = record.state;
    try {
      if (result?.state?.toString) serialized = result.state.toString();
    } catch {
      serialized = record.state;
    }
    return this.runStore.update(record.runId, {
      state: serialized,
      currentTurn: result?.currentTurn ?? result?.state?._currentTurn ?? record.currentTurn,
      ...extra
    });
  }

  async startRun({
    sessionId = "default",
    input,
    stream = true,
    agent,
    maxTurns
  } = {}) {
    await this.init();
    if (input == null || input === "") {
      throw new Error("Run input is required");
    }
    if (!this.model && this.provider.kind === "none") {
      throw new Error("No model configured. Set OPENAI_API_KEY or OPENROUTER_API_KEY.");
    }
    const record = await this.runStore.create({
      sessionId,
      input,
      originalInput: input,
      status: "running",
      agentStatus: "starting",
      agentName: this.agentName
    });
    await this.sessionManager.setActiveRun(sessionId, record.runId, "running");
    await this.memory.set("working", "last_input", input, { runId: record.runId });
    const controller = new AbortController();
    this.attachLive(record.runId, { controller, subscribers: new Set() });
    await this.emitEvent("run.started", record, { input });
    return this.execute(record, input, { stream, agent, maxTurns, controller });
  }

  async resumeRun(runId, { stream = true, agent, maxTurns } = {}) {
    await this.init();
    const record = await this.runStore.get(runId);
    if (!record) throw new Error(`Run not found: ${runId}`);
    if (isTerminalStatus(record.status) && record.status !== "failed") {
      throw new Error(`Cannot resume terminal run ${runId} (${record.status})`);
    }
    const resolvedAgent = agent || this.createAgent();
    const inputOrState = record.state
      ? await this.loadSdkState(runId, resolvedAgent)
      : (record.originalInput ?? record.input);
    const updated = await this.runStore.update(runId, {
      status: "running",
      agentStatus: "resuming",
      retryStatus: "idle"
    });
    const controller = new AbortController();
    this.attachLive(runId, { controller, agent: resolvedAgent, subscribers: new Set() });
    await this.emitEvent("run.resumed", updated, { previousStatus: record.status });
    return this.execute(updated, inputOrState, { stream, agent: resolvedAgent, maxTurns, resume: true, controller });
  }

  async retryRun(runId, { stream = true } = {}) {
    await this.init();
    const record = await this.runStore.get(runId);
    if (!record) throw new Error(`Run not found: ${runId}`);
    const retryCount = (record.retryCount || 0) + 1;
    await this.runStore.update(runId, {
      retryCount,
      retryStatus: "running",
      error: null,
      terminationReason: null
    });
    await this.emitEvent("retry.started", record, { retryCount });
    let result;
    if (record.state && (isResumableStatus(record.status) || record.status === "failed" || record.status === "interrupted")) {
      result = await this.resumeRun(runId, { stream });
    } else {
      const fresh = await this.runStore.update(runId, { status: "running" });
      result = await this.execute(fresh, record.originalInput ?? record.input, { stream });
    }
    await this.emitEvent("retry.completed", result.record || record, {
      retryCount,
      status: result.status
    });
    return result;
  }

  async suspendRun(runId, reason = "suspended by operator") {
    const live = this.getLive(runId);
    const record = await this.runStore.get(runId);
    if (!record) throw new Error(`Run not found: ${runId}`);
    if (isTerminalStatus(record.status)) return record;
    if (live?.controller) live.controller.abort(reason);
    const updated = await this.persistState(record, live?.result, {
      status: "suspended",
      agentStatus: "suspended",
      terminationReason: reason
    });
    await this.emitEvent("run.suspended", updated, { reason });
    this.clearLive(runId);
    return updated;
  }

  async cancelRun(runId, reason = "cancelled by operator") {
    const live = this.getLive(runId);
    if (live?.controller) live.controller.abort(reason);
    const record = await this.runStore.get(runId);
    if (!record) throw new Error(`Run not found: ${runId}`);
    const updated = await this.runStore.update(runId, {
      status: "cancelled",
      agentStatus: "cancelled",
      completedAt: nowIso(),
      terminationReason: reason
    });
    await this.sessionManager.clearActiveRun(record.sessionId);
    await this.emitEvent("run.failed", updated, { reason, cancelled: true });
    this.clearLive(runId);
    return updated;
  }

  async approve(runId, approvalId, options = {}) {
    await this.init();
    const approval = await this.approvals.approve(approvalId, options);
    const agent = this.createAgent();
    const state = await this.loadSdkState(runId, agent);
    const interruption = this.findInterruption(state, approval);
    if (!interruption) throw new Error(`Interruption not found for approval ${approvalId}`);
    state.approve(interruption, options);
    const pending = await this.approvals.pendingByRun(runId);
    const record = await this.runStore.update(runId, {
      state: state.toString(),
      status: pending.length === 0 ? "ready_to_resume" : "waiting_for_approval",
      approvalStatus: pending.length === 0 ? "resolved" : "pending"
    });
    if (options.autoResume !== false && pending.length === 0) {
      return this.resumeRun(runId, { stream: options.stream !== false });
    }
    return { record, approval, pending };
  }

  async reject(runId, approvalId, options = {}) {
    await this.init();
    const approval = await this.approvals.reject(approvalId, {
      message: options.message || "Rejected by operator"
    });
    const agent = this.createAgent();
    const state = await this.loadSdkState(runId, agent);
    const interruption = this.findInterruption(state, approval);
    if (!interruption) throw new Error(`Interruption not found for approval ${approvalId}`);
    state.reject(interruption, { message: options.message || "Rejected by operator" });
    const pending = await this.approvals.pendingByRun(runId);
    const record = await this.runStore.update(runId, {
      state: state.toString(),
      status: pending.length === 0 ? "ready_to_resume" : "waiting_for_approval",
      approvalStatus: pending.length === 0 ? "resolved" : "pending"
    });
    if (options.autoResume !== false && pending.length === 0) {
      return this.resumeRun(runId, { stream: options.stream !== false });
    }
    return { record, approval, pending };
  }

  findInterruption(state, approval) {
    const interruptions = state.getInterruptions();
    return interruptions.find((item) => {
      const meta = interruptionMeta(item);
      if (approval.callId && meta.callId === approval.callId) return true;
      return meta.toolName === approval.toolName;
    }) || interruptions[0] || null;
  }

  async handleInterruptions(record, result) {
    const interruptions = result.interruptions || result.state?.getInterruptions?.() || [];
    const approvals = [];
    for (const item of interruptions) {
      const meta = interruptionMeta(item);
      const approval = await this.approvals.request({
        runId: record.runId,
        sessionId: record.sessionId,
        toolName: meta.toolName,
        args: meta.arguments,
        callId: meta.callId,
        interruption: meta
      });
      approvals.push(approval);
    }
    const updated = await this.persistState(record, result, {
      status: "waiting_for_approval",
      approvalStatus: "pending",
      agentStatus: "paused",
      approvals
    });
    return { record: updated, approvals, interruptions };
  }

  classifyResult(result) {
    if (result?.interruptions?.length) return "waiting_for_approval";
    if (result?.state?._currentStep?.type === "next_step_interruption") return "waiting_for_approval";
    if (result?.error) return "failed";
    if (result?.cancelled) return "cancelled";
    if (result?.state?._currentStep?.type === "next_step_max_turns") return "max_turns_reached";
    return "completed";
  }

  async execute(record, inputOrState, { stream = true, agent, maxTurns, resume = false, controller } = {}) {
    const latest = await this.runStore.get(record.runId);
    if (latest && (latest.status === "suspended" || latest.status === "cancelled")) {
      return this.toPublicResult(latest, null);
    }
    const resolvedAgent = agent || this.createAgent();
    this.bindAgentHooks(resolvedAgent, record);
    const abortController = controller || this.getLive(record.runId)?.controller || new AbortController();
    const session = this.sessionStore.getSession(record.sessionId);
    const context = this.buildContext(record);
    const live = this.getLive(record.runId) || { subscribers: new Set() };
    live.controller = abortController;
    live.agent = resolvedAgent;
    this.attachLive(record.runId, live);

    if (abortController.signal.aborted) {
      const current = await this.runStore.get(record.runId);
      return this.toPublicResult(current || record, null);
    }

    try {
      const result = await this.runner.run(resolvedAgent, inputOrState, {
        stream,
        session,
        signal: abortController.signal,
        context,
        maxTurns: maxTurns ?? this.maxTurns
      });
      live.result = result;

      if (stream) {
        await this.consumeStream(record, result, live);
      }

      if (typeof result.completed?.then === "function") {
        await result.completed;
      }

      const afterStream = await this.runStore.get(record.runId);
      if (abortController.signal.aborted || afterStream?.status === "suspended" || afterStream?.status === "cancelled") {
        const persisted = await this.persistState(afterStream || record, result, {
          status: afterStream?.status === "cancelled" ? "cancelled" : "suspended"
        });
        return this.toPublicResult(persisted, result);
      }

      const interruptions = result.interruptions || [];
      if (interruptions.length > 0) {
        const paused = await this.handleInterruptions(record, result);
        return this.toPublicResult(paused.record, result, { approvals: paused.approvals, finalOutput: null });
      }

      const status = this.classifyResult(result);
      const finalOutput = this.safeFinalOutput(result);
      const updated = await this.persistState(record, result, {
        status,
        finalOutput: finalOutput ?? null,
        completedAt: isTerminalStatus(status) ? nowIso() : null,
        agentStatus: status,
        approvalStatus: "none",
        error: result.error ? String(result.error) : null
      });
      if (isTerminalStatus(status)) {
        await this.sessionManager.clearActiveRun(record.sessionId);
        await this.emitEvent(status === "completed" ? "run.completed" : "run.failed", updated, {
          finalOutput,
          error: updated.error
        });
      }
      return this.toPublicResult(updated, result, { finalOutput });
    } catch (error) {
      if (abortController.signal.aborted) {
        const current = await this.runStore.get(record.runId);
        if (current?.status === "suspended" || current?.status === "cancelled") {
          return this.toPublicResult(current, live.result, { error: error.message });
        }
      }
      const updated = await this.runStore.update(record.runId, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        terminationReason: error instanceof Error ? error.message : String(error),
        completedAt: nowIso(),
        agentStatus: "failed"
      });
      await this.sessionManager.clearActiveRun(record.sessionId);
      await this.emitEvent("run.failed", updated, { error: updated.error });
      return this.toPublicResult(updated, live.result, { error: updated.error });
    } finally {
      this.clearLive(record.runId);
    }
  }

  bindAgentHooks(agent, record) {
    const safe = (fn) => async (...args) => {
      try {
        await fn(...args);
      } catch {
        // Debugger/state side effects must not fail the SDK run.
      }
    };
    agent.on("agent_start", safe(async (_ctx, current, turnInput) => {
      await this.runStore.update(record.runId, {
        agentStatus: "running",
        turnStatus: "running",
        agentName: current?.name || agent.name
      });
      await this.emitEvent("agent.started", record, {
        agentName: current?.name || agent.name,
        turnInput: typeof turnInput === "string" ? turnInput : undefined
      });
      await this.emitEvent("turn.started", record, {
        agentName: current?.name || agent.name
      });
    }));
    agent.on("agent_end", safe(async (_ctx, output) => {
      await this.runStore.update(record.runId, { agentStatus: "completed", turnStatus: "completed" });
      await this.emitEvent("agent.completed", record, {
        agentName: agent.name,
        output: typeof output === "string" ? output : undefined
      });
      await this.emitEvent("turn.completed", record, { agentName: agent.name });
    }));
  }

  async consumeStream(record, result, live) {
    let streamText = "";
    for await (const event of result) {
      const text = extractTextDelta(event);
      const reasoning = extractReasoningDelta(event);
      if (text) streamText += text;
      const payload = {
        type: event.type,
        runId: record.runId,
        sessionId: record.sessionId,
        text,
        reasoning,
        item: event.type === "run_item_stream_event" ? summarizeRunItem(event.item) : null,
        agentName: event.agent?.name || result.currentAgent?.name || record.agentName,
        timestamp: nowIso()
      };
      live.lastEvent = payload;
      this.emit("stream", payload);
      this.emit(`stream:${record.runId}`, payload);
      if (event.type === "run_item_stream_event") {
        await this.persistState(record, result, {
          streamText,
          turnStatus: "running"
        });
      }
    }
    await this.persistState(record, result, { streamText });
  }

  safeFinalOutput(result) {
    try {
      return result?.finalOutput;
    } catch {
      return undefined;
    }
  }

  toPublicResult(record, result, extra = {}) {
    return {
      runId: record.runId,
      sessionId: record.sessionId,
      status: record.status,
      finalOutput: extra.finalOutput ?? record.finalOutput ?? null,
      error: record.error ?? extra.error ?? null,
      approvals: extra.approvals || record.approvals || [],
      record,
      result,
      state: result?.state || null
    };
  }

  subscribe(runId, listener) {
    const eventName = `stream:${runId}`;
    this.on(eventName, listener);
    this.on(`run:${runId}`, listener);
    return () => {
      this.off(eventName, listener);
      this.off(`run:${runId}`, listener);
    };
  }
}

export async function createRuntime(options = {}) {
  const runtime = new AgentRuntime(options);
  await runtime.init();
  return runtime;
}
