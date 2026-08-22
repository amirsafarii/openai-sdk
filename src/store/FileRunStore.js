import { mkdir, readFile, writeFile, unlink, readdir, rename } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export class FileRunStore {
   constructor({ directory = "./data/runs", lockManager }) {
      this.directory = resolve(directory);
      this.lockManager = lockManager;
   }

   getPath(runId) {
      return join(this.directory, `${encodeURIComponent(runId)}.json`);
   }

   async ensureDirectory() {
      await mkdir(this.directory, { recursive: true });
      try {
         const files = await readdir(this.directory);
         for (const file of files) {
            if (file.endsWith(".tmp")) {
               await unlink(join(this.directory, file)).catch(() => {});
            }
         }
      } catch (e) {}
   }

   async create(data) {
      const runId = randomUUID();
      const now = new Date().toISOString();
      const interruptions = data.interruptions || [];

      const record = {
         runId,
         sessionId: data.sessionId,
         turnId: data.turnId || randomUUID(),
         messageId: data.messageId || randomUUID(),
         state: data.state || "",
         status: data.status || (interruptions.length ? "waiting_for_approval" : "pending"),
         terminationReason: data.terminationReason,
         finalOutput: data.finalOutput,
         error: data.error,
         approvals: interruptions.map(item => ({
            approvalId: item.rawItem?.id || item.id || randomUUID(),
            callId: item.rawItem?.callId || item.callId,
            toolName: item.rawItem?.name || item.name || "unknown",
            arguments: item.rawItem?.arguments || item.arguments || {},
            status: "pending"
         })),
         pendingInput: [],
         createdAt: now,
         updatedAt: now
      };

      await this.save(record);
      return record;
   }

   async save(record) {
      await this.ensureDirectory();
      const file = this.getPath(record.runId);
      const temp = `${file}.${randomUUID()}.tmp`;
      record.updatedAt = new Date().toISOString();
      await writeFile(temp, JSON.stringify(record, null, 2), "utf8");
      await rename(temp, file);
   }

   async updateStatus(runId, status, options = {}) {
      const record = await this.get(runId);
      if (!record) throw new Error("Run not found");
      record.status = status;
      if (options.terminationReason !== undefined) record.terminationReason = options.terminationReason;
      if (options.finalOutput !== undefined) record.finalOutput = options.finalOutput;
      if (options.error !== undefined) record.error = options.error;
      await this.save(record);
      return record;
   }

   async get(runId) {
      try {
         const raw = await readFile(this.getPath(runId), "utf8");
         return JSON.parse(raw);
      } catch (error) {
         if (error.code === "ENOENT") return null;
         throw error;
      }
   }

   async delete(runId) {
      try {
         await unlink(this.getPath(runId));
      } catch (error) {
         if (error.code !== "ENOENT") throw error;
      }
   }

   async list() {
      await this.ensureDirectory();
      const files = await readdir(this.directory);
      const result = [];
      for (const file of files) {
         if (!file.endsWith(".json")) continue;
         const id = decodeURIComponent(file.slice(0, -5));
         const run = await this.get(id);
         if (run) result.push(run);
      }
      return result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
   }

   async listBySession(sessionId) {
      const allRuns = await this.list();
      return allRuns.filter(r => r.sessionId === sessionId);
   }
}