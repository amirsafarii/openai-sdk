import { resolve } from "node:path";
import { nowIso } from "../lib/ids.js";
import { ensureDir, jsonPath, readJson, writeJsonAtomic } from "../lib/fsjson.js";

const SCOPES = new Set(["working", "session", "persistent"]);

function matchesQuery(entry, query) {
  if (!query) return true;
  const haystack = `${entry.key} ${JSON.stringify(entry.value)}`.toLowerCase();
  return haystack.includes(String(query).toLowerCase());
}

export class MemoryStore {
  constructor({ directory = "./data/memory", lockManager }) {
    this.directory = resolve(directory);
    this.lockManager = lockManager;
    this.working = new Map();
  }

  async init() {
    await ensureDir(this.directory);
    await ensureDir(resolve(this.directory, "sessions"));
  }

  assertScope(scope) {
    if (!SCOPES.has(scope)) {
      throw new Error(`Unknown memory scope: ${scope}`);
    }
  }

  workingKey(runId, key) {
    return `${runId}::${key}`;
  }

  persistentPath() {
    return resolve(this.directory, "persistent.json");
  }

  sessionPath(sessionId) {
    return jsonPath(resolve(this.directory, "sessions"), sessionId);
  }

  async readBucket(path) {
    const data = await readJson(path, null);
    return data || { entries: {}, updatedAt: nowIso() };
  }

  async writeBucket(lockKey, path, mutator) {
    return this.lockManager.withLock(lockKey, async () => {
      await this.init();
      const bucket = await this.readBucket(path);
      const result = await mutator(bucket);
      bucket.updatedAt = nowIso();
      await writeJsonAtomic(path, bucket);
      return result;
    });
  }

  async get(scope, key, { runId, sessionId } = {}) {
    this.assertScope(scope);
    if (scope === "working") {
      if (!runId) throw new Error("working memory requires runId");
      return this.working.get(this.workingKey(runId, key))?.value;
    }
    if (scope === "session") {
      if (!sessionId) throw new Error("session memory requires sessionId");
      const bucket = await this.readBucket(this.sessionPath(sessionId));
      return bucket.entries[key]?.value;
    }
    const bucket = await this.readBucket(this.persistentPath());
    return bucket.entries[key]?.value;
  }

  async set(scope, key, value, { runId, sessionId } = {}) {
    this.assertScope(scope);
    const entry = { key, value, updatedAt: nowIso() };
    if (scope === "working") {
      if (!runId) throw new Error("working memory requires runId");
      this.working.set(this.workingKey(runId, key), entry);
      return entry;
    }
    if (scope === "session") {
      if (!sessionId) throw new Error("session memory requires sessionId");
      return this.writeBucket(`memory:session:${sessionId}`, this.sessionPath(sessionId), (bucket) => {
        bucket.entries[key] = entry;
        return entry;
      });
    }
    return this.writeBucket("memory:persistent", this.persistentPath(), (bucket) => {
      bucket.entries[key] = entry;
      return entry;
    });
  }

  async delete(scope, key, { runId, sessionId } = {}) {
    this.assertScope(scope);
    if (scope === "working") {
      if (!runId) throw new Error("working memory requires runId");
      return this.working.delete(this.workingKey(runId, key));
    }
    if (scope === "session") {
      if (!sessionId) throw new Error("session memory requires sessionId");
      return this.writeBucket(`memory:session:${sessionId}`, this.sessionPath(sessionId), (bucket) => {
        const existed = Boolean(bucket.entries[key]);
        delete bucket.entries[key];
        return existed;
      });
    }
    return this.writeBucket("memory:persistent", this.persistentPath(), (bucket) => {
      const existed = Boolean(bucket.entries[key]);
      delete bucket.entries[key];
      return existed;
    });
  }

  async search(query, { scope, runId, sessionId } = {}) {
    const scopes = scope ? [scope] : ["working", "session", "persistent"];
    const results = [];
    for (const current of scopes) {
      this.assertScope(current);
      if (current === "working") {
        for (const [composite, entry] of this.working.entries()) {
          const [entryRunId, ...rest] = composite.split("::");
          const key = rest.join("::");
          if (runId && entryRunId !== runId) continue;
          if (matchesQuery({ key, value: entry.value }, query)) {
            results.push({ scope: current, runId: entryRunId, key, value: entry.value, updatedAt: entry.updatedAt });
          }
        }
        continue;
      }
      if (current === "session") {
        if (!sessionId) continue;
        const bucket = await this.readBucket(this.sessionPath(sessionId));
        for (const entry of Object.values(bucket.entries)) {
          if (matchesQuery(entry, query)) {
            results.push({ scope: current, sessionId, key: entry.key, value: entry.value, updatedAt: entry.updatedAt });
          }
        }
        continue;
      }
      const bucket = await this.readBucket(this.persistentPath());
      for (const entry of Object.values(bucket.entries)) {
        if (matchesQuery(entry, query)) {
          results.push({ scope: current, key: entry.key, value: entry.value, updatedAt: entry.updatedAt });
        }
      }
    }
    return results;
  }

  async list(scope, { runId, sessionId } = {}) {
    return this.search("", { scope, runId, sessionId });
  }

  clearWorking(runId) {
    for (const key of [...this.working.keys()]) {
      if (key.startsWith(`${runId}::`)) this.working.delete(key);
    }
  }
}
