import { AsyncLocalStorage } from "node:async_hooks";

export class ReentrantLockManager {
  constructor() {
    this.queues = new Map();
    this.storage = new AsyncLocalStorage();
  }

  async withLock(key, fn) {
    const context = this.storage.getStore();
    if (context?.locks?.has(key)) {
      return await fn();
    }

    const previous = this.queues.get(key) ?? Promise.resolve();
    let release;
    const current = new Promise((resolve) => {
      release = resolve;
    });

    this.queues.set(key, previous.then(() => current));
    await previous;

    const nextContext = { locks: new Set(context?.locks ?? []) };
    nextContext.locks.add(key);

    return this.storage.run(nextContext, async () => {
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
