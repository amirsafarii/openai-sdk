import { resolve } from "node:path";
import { createId, hashValue, nowIso } from "../lib/ids.js";
import {
  cleanupTempFiles,
  ensureDir,
  jsonPath,
  listJsonFiles,
  readJson,
  writeJsonAtomic
} from "../lib/fsjson.js";

export const LEDGER_STATUSES = Object.freeze([
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
  "unknown"
]);

export class ExecutionLedger {
  constructor({ directory = "./data/ledger", lockManager }) {
    this.directory = resolve(directory);
    this.lockManager = lockManager;
  }

  async init() {
    await ensureDir(this.directory);
    await cleanupTempFiles(this.directory);
  }

  pathFor(executionId) {
    return jsonPath(this.directory, executionId);
  }

  async save(record) {
    return this.lockManager.withLock(`ledger:${record.executionId}`, async () => {
      await this.init();
      record.updatedAt = nowIso();
      await writeJsonAtomic(this.pathFor(record.executionId), record);
      return record;
    });
  }

  async get(executionId) {
    return readJson(this.pathFor(executionId), null);
  }

  async list() {
    await this.init();
    const files = await listJsonFiles(this.directory);
    const records = [];
    for (const file of files) {
      const id = decodeURIComponent(file.slice(0, -5));
      const record = await this.get(id);
      if (record) records.push(record);
    }
    return records.sort((a, b) => String(a.startedAt || "").localeCompare(String(b.startedAt || "")));
  }

  async getByRun(runId) {
    const all = await this.list();
    return all.filter((record) => record.runId === runId);
  }

  createExecutionId({ runId, toolName, callId, argumentsHash }) {
    if (callId) return `${runId}:${toolName}:${callId}`;
    return `${runId}:${toolName}:${argumentsHash.slice(0, 16)}:${createId("exec")}`;
  }

  argumentsHash(args) {
    return hashValue(args ?? {});
  }

  async start({
    runId,
    sessionId,
    toolName,
    args,
    callId,
    sideEffect = true,
    executionId
  }) {
    const argumentsHash = this.argumentsHash(args);
    const id = executionId || this.createExecutionId({ runId, toolName, callId, argumentsHash });
    const existing = await this.get(id);
    const record = {
      executionId: id,
      runId,
      sessionId: sessionId || null,
      toolName,
      callId: callId || null,
      argumentsHash,
      arguments: args ?? {},
      status: "running",
      attempt: existing ? (existing.attempt || 0) + 1 : 1,
      startedAt: nowIso(),
      completedAt: null,
      result: null,
      error: null,
      sideEffect,
      replayedFrom: existing?.status || null
    };
    return this.save(record);
  }

  async complete(executionId, { result = null, error = null, status = "completed" } = {}) {
    const record = await this.get(executionId);
    if (!record) throw new Error(`Ledger entry not found: ${executionId}`);
    record.status = status;
    record.result = result;
    record.error = error;
    record.completedAt = nowIso();
    return this.save(record);
  }

  async markUnknown(executionId, reason = "process crashed during tool execution") {
    const record = await this.get(executionId);
    if (!record) return null;
    record.status = "unknown";
    record.error = reason;
    record.completedAt = nowIso();
    return this.save(record);
  }

  async recoverInFlight(reason = "process crashed during tool execution") {
    const records = await this.list();
    const recovered = [];
    for (const record of records) {
      if (record.status === "running" || record.status === "pending") {
        recovered.push(await this.markUnknown(record.executionId, reason));
      }
    }
    return recovered;
  }

  canReplay(record, { replayUnknown = false, replayFailed = false } = {}) {
    if (!record) return { allowed: true, reason: "new_execution" };
    if (record.status === "completed") {
      return { allowed: false, reason: "already_completed", cached: true };
    }
    if (record.status === "unknown") {
      return replayUnknown
        ? { allowed: true, reason: "policy_replay_unknown" }
        : { allowed: false, reason: "unknown_requires_policy" };
    }
    if (record.status === "failed") {
      return replayFailed
        ? { allowed: true, reason: "policy_replay_failed" }
        : { allowed: false, reason: "failed_requires_policy" };
    }
    if (record.status === "running") {
      return { allowed: false, reason: "already_running" };
    }
    return { allowed: true, reason: "retryable" };
  }
}
