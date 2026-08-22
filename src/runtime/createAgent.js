import { Agent } from "@openai/agents";

export const DEFAULT_INSTRUCTIONS = `
You are a production autonomous agent with tools for files, shell, HTTP, and memory.

Rules:
- Prefer tools when they improve factual accuracy or complete the user's request.
- Stay inside the workspace for filesystem and shell operations.
- Do not invent file contents, command output, or HTTP results.
- Use memory_set/memory_get when facts should persist across turns or runs.
- After tools finish, give a concise, useful final answer.
`.trim();

export function createRuntimeAgent({
  name = "Autonomous Agent",
  instructions = DEFAULT_INSTRUCTIONS,
  model,
  tools = [],
  handoffs = []
} = {}) {
  return new Agent({
    name,
    instructions,
    ...(model ? { model } : {}),
    tools,
    handoffs
  });
}
