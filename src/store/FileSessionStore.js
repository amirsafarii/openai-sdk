import { mkdir, readFile, writeFile, unlink, readdir, rename } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export class FileSessionStore {
   constructor({ directory = "./data/sessions", lockManager }) {
      this.directory = resolve(directory);
      this.lockManager = lockManager;
   }

   getPath(sessionId) {
      return join(this.directory, `${encodeURIComponent(sessionId)}.json`);
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

   async read(sessionId) {
      return this.lockManager.withLock(`session:${sessionId}`, async () => {
         try {
            const raw = await readFile(this.getPath(sessionId), "utf8");
            return JSON.parse(raw);
         } catch (error) {
            if (error.code !== "ENOENT") throw error;
            const now = new Date().toISOString();
            return {
               version: 1,
               sessionId,
               createdAt: now,
               updatedAt: now,
               items: [],
               metadata: { activeRunId: null, status: "idle" }
            };
         }
      });
   }

   async write(data) {
      await this.ensureDirectory();
      const file = this.getPath(data.sessionId);
      const temp = `${file}.${randomUUID()}.tmp`;
      await writeFile(temp, JSON.stringify(data, null, 2), "utf8");
      await rename(temp, file);
   }

   getSession(sessionId) {
      return new FileSession(this, sessionId);
   }
}

class FileSession {
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
      const result = limit === undefined ? items : items.slice(-limit);
      return result; // بدون clone، چون از JSON خوانده شده
   }

   async addItems(items) {
      if (!items?.length) return;
      await this.store.lockManager.withLock(`session:${this.sessionId}`, async () => {
         const data = await this.store.read(this.sessionId);
         
         // ✅ استفاده از JSON به جای structuredClone
         // این کار توابع و مراجع غیرقابل serialize را حذف می‌کند
         const cleanItems = JSON.parse(JSON.stringify(items));
         
         data.items.push(...cleanItems);
         data.updatedAt = new Date().toISOString();
         await this.store.write(data);
      });
   }

   async popItem() {
      return this.store.lockManager.withLock(`session:${this.sessionId}`, async () => {
         const data = await this.store.read(this.sessionId);
         const item = data.items.pop();
         if (!item) return undefined;
         data.updatedAt = new Date().toISOString();
         await this.store.write(data);
         return item; // بدون clone
      });
   }

   async clearSession() {
      await this.store.lockManager.withLock(`session:${this.sessionId}`, async () => {
         const now = new Date().toISOString();
         await this.store.write({
            version: 1,
            sessionId: this.sessionId,
            createdAt: now,
            updatedAt: now,
            items: [],
            metadata: { activeRunId: null, status: "idle" }
         });
      });
   }
}