import { createFilesystemTools } from "./filesystem.js";
import { createTerminalTools } from "./terminal.js";
import { createHttpTools } from "./http.js";
import { createMemoryTools } from "./memory.js";
import { materializeTools } from "./define.js";

export function createBuiltinDefinitions() {
  return [
    ...createFilesystemTools(),
    ...createTerminalTools(),
    ...createHttpTools(),
    ...createMemoryTools()
  ];
}

export function createBuiltinTools(toolRuntime, policy = {}) {
  return materializeTools(createBuiltinDefinitions(), toolRuntime, policy);
}
