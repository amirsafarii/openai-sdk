import { z } from "zod";

export function createMemoryTools() {
  return [
    {
      name: "memory_set",
      description: "Store a memory entry in working, session, or persistent memory.",
      parameters: z.object({
        scope: z.enum(["working", "session", "persistent"]),
        key: z.string(),
        value: z.string()
      }),
      timeoutMs: 5_000,
      async execute({ scope, key, value }, runContext) {
        const app = runContext.context;
        await app.memory.set(scope, key, value, {
          runId: app.runId,
          sessionId: app.sessionId
        });
        return { stored: true, scope, key };
      }
    },
    {
      name: "memory_get",
      description: "Read a memory entry from working, session, or persistent memory.",
      parameters: z.object({
        scope: z.enum(["working", "session", "persistent"]),
        key: z.string()
      }),
      timeoutMs: 5_000,
      async execute({ scope, key }, runContext) {
        const app = runContext.context;
        const value = await app.memory.get(scope, key, {
          runId: app.runId,
          sessionId: app.sessionId
        });
        return { scope, key, value: value ?? null, found: value !== undefined };
      }
    },
    {
      name: "memory_search",
      description: "Search memory across scopes.",
      parameters: z.object({
        query: z.string(),
        scope: z.enum(["working", "session", "persistent"]).nullable().default(null)
      }),
      timeoutMs: 5_000,
      async execute({ query, scope }, runContext) {
        const app = runContext.context;
        const results = await app.memory.search(query, {
          scope: scope || undefined,
          runId: app.runId,
          sessionId: app.sessionId
        });
        return { query, count: results.length, results };
      }
    },
    {
      name: "memory_delete",
      description: "Delete a memory entry.",
      parameters: z.object({
        scope: z.enum(["working", "session", "persistent"]),
        key: z.string()
      }),
      timeoutMs: 5_000,
      async execute({ scope, key }, runContext) {
        const app = runContext.context;
        const deleted = await app.memory.delete(scope, key, {
          runId: app.runId,
          sessionId: app.sessionId
        });
        return { deleted, scope, key };
      }
    }
  ];
}
