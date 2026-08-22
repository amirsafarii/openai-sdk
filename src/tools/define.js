import { tool } from "@openai/agents";
import { hasSideEffect } from "./runtime.js";

export function materializeTool(definition, toolRuntime, policy = {}) {
  if (!definition) return definition;
  if (definition.type === "function" && typeof definition.invoke === "function") {
    return toolRuntime.wrap(definition, policy);
  }
  const original = definition.execute;
  if (typeof original !== "function") {
    throw new Error(`Tool ${definition.name || "<unnamed>"} is missing execute()`);
  }
  return tool({
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters,
    strict: definition.strict,
    needsApproval: definition.needsApproval,
    timeoutMs: definition.timeoutMs,
    timeoutBehavior: definition.timeoutBehavior || "error_as_result",
    isEnabled: definition.isEnabled,
    errorFunction: definition.errorFunction ?? null,
    async execute(args, runContext, details) {
      return toolRuntime.executeManaged({
        toolName: definition.name,
        args,
        runContext,
        details,
        handler: () => original(args, runContext, details),
        policy: {
          maxRetries: definition.maxRetries ?? policy.maxRetries,
          retryDelayMs: definition.retryDelayMs ?? policy.retryDelayMs ?? 150,
          replayUnknown: policy.replayUnknown === true,
          replayFailed: policy.replayFailed === true,
          sideEffect: policy.sideEffect ?? hasSideEffect(definition.name, args)
        }
      });
    }
  });
}

export function materializeTools(definitions, toolRuntime, policy = {}) {
  return definitions.map((definition) => materializeTool(definition, toolRuntime, policy));
}
