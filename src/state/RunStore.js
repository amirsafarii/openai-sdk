import { resolve } from "node:path";
import { createId, nowIso } from "../lib/ids.js";
import {
  cleanupTempFiles,
  ensureDir,
  jsonPath,
  listJsonFiles,
  readJson,
  removeFile,
  writeJsonAtomic
} from "../lib/fsjson.js";

export const TERMINAL_STATUSES = Object.freeze([
  "completed",
  "failed",
  "cancelled",
  "aborted",
  "max_turns_reached"
]);

export const RESUMABLE_STATUSES = Object.freeze([
  "waiting_for_approval",
  "ready_to_resume",
  "suspended",
  "interrupted"
]);

export function isTerminalStatus(status) {
  return TERMINAL_STATUSES.includes(status);
}

export function isResumableStatus(status) {
  return RESUMABLE_STATUSES.includes(status);
}

export class RunStore {
  constructor({ directory = "./data/runs", lockManager }) {
    this.directory = resolve(directory);
    this.lockManager = lockManager;
  }

  pathFor(runId) {
    return jsonPath(this.directory, runId);
  }

  async init() {
    await ensureDir(this.directory);
    await cleanupTempFiles(this.directory);
  }

  async create(data = {}) {
    const now = nowIso();
    const record = {
      runId: data.runId || createId("run"),
      sessionId: data.sessionId,
      agentName: data.agentName || null,
      input: data.input ?? null,
      status: data.status || "pending",
      turnStatus: data.turnStatus || "idle",
      agentStatus: data.agentStatus || "idle",
      toolStatus: data.toolStatus || "idle",
      approvalStatus: data.approvalStatus || "none",
      retryStatus: data.retryStatus || "idle",
      retryCount: data.retryCount || 0,
      turnId: data.turnId || createId("turn"),
      currentTurn: data.currentTurn || 0,
      state: data.state || "",
      originalInput: data.originalInput ?? data.input ?? null,
      finalOutput: data.finalOutput ?? null,
      error: data.error ?? null,
      terminationReason: data.terminationReason ?? null,
      approvals: data.approvals || [],
      pendingInput: data.pendingInput || [],
      streamText: data.streamText || "",
      recovery: data.recovery || null,
      createdAt: now,
      updatedAt: now,
      startedAt: data.startedAt || now,
      completedAt: data.completedAt || null
    };
    await this.save(record);
    return record;
  }

  async save(record) {
    return this.lockManager.withLock(`run:${record.runId}`, async () => {
      await this.init();
      record.updatedAt = nowIso();
      await writeJsonAtomic(this.pathFor(record.runId), record);
      return record;
    });
  }

  async update(runId, patch) {
    return this.lockManager.withLock(`run:${runId}`, async () => {
      const record = await this.get(runId);
      if (!record) throw new Error(`Run not found: ${runId}`);
      Object.assign(record, patch, { updatedAt: nowIso() });
      await writeJsonAtomic(this.pathFor(runId), record);
      return record;
    });
  }

  async get(runId) {
    return readJson(this.pathFor(runId), null);
  }

  async delete(runId) {
    await removeFile(this.pathFor(runId));
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
    return records.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  async listBySession(sessionId) {
    const all = await this.list();
    return all.filter((record) => record.sessionId === sessionId);
  }
}
