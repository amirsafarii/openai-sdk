import { AsyncLocalStorage } from "node:async_hooks";

export class ReentrantLockManager {
   constructor() {
      this.queues = new Map();
      this.storage = new AsyncLocalStorage();
   }

   async withLock(key, fn) {
      const context = this.storage.getStore();

      // اگر در همین context قبلاً این قفل گرفته شده، بدون معطلی اجرا کن (Reentrant)
      if (context?.locks?.has(key)) {
         return await fn();
      }

      const previous = this.queues.get(key) ?? Promise.resolve();
      let release;
      const current = new Promise(resolve => {
         release = resolve;
      });

      this.queues.set(key, previous.then(() => current));
      await previous;

      const newContext = { locks: new Set(context?.locks ?? []) };
      newContext.locks.add(key);

      return this.storage.run(newContext, async () => {
         try {
            return await fn();
         } finally {
            release();
            if (this.queues.get(key) === current) {
               this.queues.delete(key);
            }
         }
      });
   }
}