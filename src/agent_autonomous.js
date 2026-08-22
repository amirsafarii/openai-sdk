import { createRuntime } from "./runtime/AgentRuntime.js";

export async function autonomousRun(input, session) {
  const runtime = await createRuntime();
  const sessionId = session?.sessionId || session?.id || "default";
  return runtime.startRun({ sessionId, input, stream: true });
}
