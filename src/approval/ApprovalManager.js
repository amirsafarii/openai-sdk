import { resolve } from "node:path";
import { createId, nowIso } from "../lib/ids.js";
import {
  cleanupTempFiles,
  ensureDir,
  jsonPath,
  listJsonFiles,
  readJson,
  writeJsonAtomic
} from "../lib/fsjson.js";

export class ApprovalManager {
  constructor({ directory = "./data/approvals", lockManager, debugger: eventDebugger }) {
    this.directory = resolve(directory);
    this.lockManager = lockManager;
    this.debugger = eventDebugger;
    this.waiters = new Map();
  }

  async init() {
    await ensureDir(this.directory);
    await cleanupTempFiles(this.directory);
  }

  pathFor(approvalId) {
    return jsonPath(this.directory, approvalId);
  }

  async save(record) {
    return this.lockManager.withLock(`approval:${record.approvalId}`, async () => {
      await this.init();
      record.updatedAt = nowIso();
      await writeJsonAtomic(this.pathFor(record.approvalId), record);
      return record;
    });
  }

  async get(approvalId) {
    return readJson(this.pathFor(approvalId), null);
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
    return records.sort((a, b) => String(a.requestedAt || "").localeCompare(String(b.requestedAt || "")));
  }

  async listByRun(runId) {
    const all = await this.list();
    return all.filter((record) => record.runId === runId);
  }

  async pendingByRun(runId) {
    const records = await this.listByRun(runId);
    return records.filter((record) => record.status === "pending");
  }

  async request({
    runId,
    sessionId,
    toolName,
    args,
    callId,
    interruption
  }) {
    const existing = (await this.listByRun(runId)).find((record) => {
      return record.callId && callId && record.callId === callId && record.status === "pending";
    });
    if (existing) return existing;

    const record = {
      approvalId: createId("appr"),
      runId,
      sessionId: sessionId || null,
      toolName,
      arguments: args ?? {},
      callId: callId || null,
      interruptionSnapshot: interruption || null,
      status: "pending",
      message: null,
      requestedAt: nowIso(),
      resolvedAt: null
    };
    await this.save(record);
    if (this.debugger) {
      await this.debugger.append({
        type: "approval.required",
        runId,
        sessionId,
        data: {
          approvalId: record.approvalId,
          toolName,
          arguments: args,
          callId
        }
      });
    }
    return record;
  }

  resolveWaiters(runId) {
    const waiters = this.waiters.get(runId) || [];
    this.waiters.delete(runId);
    for (const waiter of waiters) waiter();
  }

  waitForDecision(runId) {
    return new Promise((resolve) => {
      const list = this.waiters.get(runId) || [];
      list.push(resolve);
      this.waiters.set(runId, list);
    });
  }

  async decide(approvalId, status, { message = null } = {}) {
    const record = await this.get(approvalId);
    if (!record) throw new Error(`Approval not found: ${approvalId}`);
    if (record.status !== "pending") return record;
    record.status = status;
    record.message = message;
    record.resolvedAt = nowIso();
    await this.save(record);
    if (this.debugger) {
      await this.debugger.append({
        type: status === "approved" ? "approval.approved" : "approval.rejected",
        runId: record.runId,
        sessionId: record.sessionId,
        data: {
          approvalId,
          toolName: record.toolName,
          message
        }
      });
    }
    this.resolveWaiters(record.runId);
    return record;
  }

  async approve(approvalId, options = {}) {
    return this.decide(approvalId, "approved", options);
  }

  async reject(approvalId, options = {}) {
    return this.decide(approvalId, "rejected", options);
  }
}
