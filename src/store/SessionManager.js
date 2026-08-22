export class SessionManager {
   constructor({ sessionStore, lockManager }) {
      this.sessionStore = sessionStore;
      this.lockManager = lockManager;
   }

   // ============================================================
   //  ITEMS (Conversation History)
   // ============================================================

   async getItems(sessionId, limit) {
      return await this.sessionStore.getSession(sessionId).getItems(limit);
   }

   async addItems(sessionId, items) {
      await this.sessionStore.getSession(sessionId).addItems(items);
   }

   async clearItems(sessionId) {
      await this.sessionStore.getSession(sessionId).clearSession();
   }

   // ============================================================
   //  METADATA (فقط pointer به Run فعال)
   // ============================================================

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
      return await this.setMetadata(sessionId, {
         activeRunId: null,
         status: "idle"
      });
   }

   async setActiveRun(sessionId, runId, status = "running") {
      return await this.setMetadata(sessionId, { activeRunId: runId, status });
   }
}