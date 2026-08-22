import { EventEmitter } from "node:events";
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

export const DEBUGGER_EVENT_TYPES = Object.freeze([
  "run.started",
  "run.completed",
  "run.failed",
  "turn.started",
  "turn.completed",
  "agent.started",
  "agent.completed",
  "tool.started",
  "tool.completed",
  "tool.failed",
  "approval.required",
  "approval.approved",
  "approval.rejected",
  "run.suspended",
  "run.resumed",
  "retry.started",
  "retry.completed"
]);

export class EventDebugger extends EventEmitter {
  constructor({ directory = "./data/events", lockManager }) {
    super();
    this.setMaxListeners(0);
    this.directory = resolve(directory);
    this.lockManager = lockManager;
    this.live = [];
  }

  async init() {
    await ensureDir(this.directory);
    await cleanupTempFiles(this.directory);
  }

  pathFor(eventId) {
    return jsonPath(this.directory, eventId);
  }

  async append(partial) {
    const event = {
      id: partial.id || createId("evt"),
      type: partial.type,
      runId: partial.runId || null,
      sessionId: partial.sessionId || null,
      turnId: partial.turnId || null,
      agentName: partial.agentName || null,
      data: partial.data || {},
      timestamp: partial.timestamp || nowIso()
    };
    this.live.push(event);
    if (this.live.length > 5000) this.live.shift();
    await this.lockManager.withLock("debugger", async () => {
      await this.init();
      await writeJsonAtomic(this.pathFor(event.id), event);
    });
    this.emit("event", event);
    this.emit(event.type, event);
    return event;
  }

  async getAll() {
    await this.init();
    const files = await listJsonFiles(this.directory);
    const events = [];
    for (const file of files) {
      const id = decodeURIComponent(file.slice(0, -5));
      const event = await readJson(this.pathFor(id), null);
      if (event) events.push(event);
    }
    return events.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  }

  async query({ runId, sessionId, type, types, since, until, limit } = {}) {
    const allowed = types || (type ? [type] : null);
    const events = await this.getAll();
    const filtered = events.filter((event) => {
      if (runId && event.runId !== runId) return false;
      if (sessionId && event.sessionId !== sessionId) return false;
      if (allowed && !allowed.includes(event.type)) return false;
      if (since && event.timestamp < since) return false;
      if (until && event.timestamp > until) return false;
      return true;
    });
    return limit ? filtered.slice(-limit) : filtered;
  }

  async getByRun(runId) {
    return this.query({ runId });
  }

  async getTimeline(runId) {
    return this.getByRun(runId);
  }

  async inspect(eventId) {
    return readJson(this.pathFor(eventId), null);
  }
}
