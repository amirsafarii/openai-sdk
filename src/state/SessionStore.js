import { resolve } from "node:path";
import { nowIso } from "../lib/ids.js";
import {
  cleanupTempFiles,
  ensureDir,
  jsonPath,
  listJsonFiles,
  readJson,
  removeFile,
  writeJsonAtomic
} from "../lib/fsjson.js";

function emptySession(sessionId) {
  const now = nowIso();
  return {
    version: 1,
    sessionId,
    createdAt: now,
    updatedAt: now,
    items: [],
    metadata: {
      activeRunId: null,
      status: "idle"
    }
  };
}

export class SessionStore {
  constructor({ directory = "./data/sessions", lockManager }) {
    this.directory = resolve(directory);
    this.lockManager = lockManager;
  }

  pathFor(sessionId) {
    return jsonPath(this.directory, sessionId);
  }

  async init() {
    await ensureDir(this.directory);
    await cleanupTempFiles(this.directory);
  }

  async read(sessionId) {
    return this.lockManager.withLock(`session:${sessionId}`, async () => {
      const existing = await readJson(this.pathFor(sessionId), null);
      if (existing) return existing;
      const created = emptySession(sessionId);
      await writeJsonAtomic(this.pathFor(sessionId), created);
      return created;
    });
  }

  async write(data) {
    return this.lockManager.withLock(`session:${data.sessionId}`, async () => {
      await this.init();
      data.updatedAt = nowIso();
      await writeJsonAtomic(this.pathFor(data.sessionId), data);
      return data;
    });
  }

  async delete(sessionId) {
    await removeFile(this.pathFor(sessionId));
  }

  async list() {
    await this.init();
    const files = await listJsonFiles(this.directory);
    const sessions = [];
    for (const file of files) {
      const id = decodeURIComponent(file.slice(0, -5));
      const session = await readJson(this.pathFor(id), null);
      if (session) sessions.push(session);
    }
    return sessions.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  getSession(sessionId) {
    return new FileSession(this, sessionId);
  }
}

export class FileSession {
  constructor(store, sessionId) {
    this.store = store;
    this.sessionId = sessionId;
  }

  async getSessionId() {
    return this.sessionId;
  }

  async getItems(limit) {
    const data = await this.store.read(this.sessionId);
    const items = data.items || [];
    return limit === undefined ? items : items.slice(-limit);
  }

  async addItems(items) {
    if (!items?.length) return;
    await this.store.lockManager.withLock(`session:${this.sessionId}`, async () => {
      const data = await this.store.read(this.sessionId);
      const cleanItems = JSON.parse(JSON.stringify(items));
      data.items.push(...cleanItems);
      await this.store.write(data);
    });
  }

  async popItem() {
    return this.store.lockManager.withLock(`session:${this.sessionId}`, async () => {
      const data = await this.store.read(this.sessionId);
      const item = data.items.pop();
      if (!item) return undefined;
      await this.store.write(data);
      return item;
    });
  }

  async clearSession() {
    await this.store.lockManager.withLock(`session:${this.sessionId}`, async () => {
      await this.store.write(emptySession(this.sessionId));
    });
  }
}

export class SessionManager {
  constructor({ sessionStore, lockManager }) {
    this.sessionStore = sessionStore;
    this.lockManager = lockManager;
  }

  async getItems(sessionId, limit) {
    return this.sessionStore.getSession(sessionId).getItems(limit);
  }

  async addItems(sessionId, items) {
    await this.sessionStore.getSession(sessionId).addItems(items);
  }

  async clearItems(sessionId) {
    await this.sessionStore.getSession(sessionId).clearSession();
  }

  async getMetadata(sessionId) {
    const session = await this.sessionStore.read(sessionId);
    return session.metadata || { activeRunId: null, status: "idle" };
  }

  async setMetadata(sessionId, metadata) {
    return this.lockManager.withLock(`session:${sessionId}`, async () => {
      const session = await this.sessionStore.read(sessionId);
      session.metadata = { ...session.metadata, ...metadata };
      await this.sessionStore.write(session);
      return session.metadata;
    });
  }

  async clearActiveRun(sessionId) {
    return this.setMetadata(sessionId, {
      activeRunId: null,
      status: "idle"
    });
  }

  async setActiveRun(sessionId, runId, status = "running") {
    return this.setMetadata(sessionId, { activeRunId: runId, status });
  }
}
