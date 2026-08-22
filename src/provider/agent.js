import { createRuntimeAgent } from "../runtime/createAgent.js";
import { createBuiltinTools } from "../tools/catalog.js";
import { ToolRuntime } from "../tools/runtime.js";
import { ExecutionLedger } from "../ledger/ExecutionLedger.js";
import { EventDebugger } from "../debugger/EventDebugger.js";
import { ReentrantLockManager } from "../store/ReentrantLockManager.js";
import { configureProvider } from "../runtime/provider.js";

configureProvider();

const lockManager = new ReentrantLockManager();
const toolRuntime = new ToolRuntime({
  ledger: new ExecutionLedger({ lockManager }),
  debugger: new EventDebugger({ lockManager })
});

export const agent = createRuntimeAgent({
  tools: createBuiltinTools(toolRuntime)
});
