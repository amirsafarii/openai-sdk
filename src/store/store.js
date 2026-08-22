import { ReentrantLockManager } from "./ReentrantLockManager.js";
import { RunStore } from "../state/RunStore.js";
import { SessionStore, SessionManager } from "../state/SessionStore.js";

const lockManager = new ReentrantLockManager();
const sessionStore = new SessionStore({
  directory: "./data/sessions",
  lockManager
});
const runStore = new RunStore({ directory: "./data/runs", lockManager });
const sessionManager = new SessionManager({ sessionStore, lockManager });

export { lockManager, sessionStore, runStore, sessionManager };
