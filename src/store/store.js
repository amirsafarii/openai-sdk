import {
   ReentrantLockManager,
   SessionManager,
   FileRunStore,
   RunTracker,
   FileSessionStore
} from "./index.store.js";

const lockManager = new ReentrantLockManager();
const sessionStore = new FileSessionStore({
   directory: "./data/sessions",
   lockManager
});
const runStore = new FileRunStore({ directory: "./data/runs", lockManager });
const sessionManager = new SessionManager({ sessionStore, lockManager });

export { RunTracker,lockManager, sessionStore, runStore, sessionManager };
