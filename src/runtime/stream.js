export function extractTextDelta(event) {
  if (!event || event.type !== "raw_model_stream_event") return "";
  const data = event.data;
  if (!data) return "";
  if (typeof data.delta === "string" && data.type === "output_text_delta") {
    return data.delta;
  }
  if (typeof data.delta === "string" && String(data.type || "").includes("output_text")) {
    return data.delta;
  }
  const chatDelta = data.event?.choices?.[0]?.delta;
  if (typeof chatDelta?.content === "string") return chatDelta.content;
  const responseDelta = data.event?.delta;
  if (typeof responseDelta === "string") return responseDelta;
  return "";
}

export function extractReasoningDelta(event) {
  if (!event || event.type !== "raw_model_stream_event") return "";
  const data = event.data;
  const chatDelta = data?.event?.choices?.[0]?.delta;
  if (typeof chatDelta?.reasoning === "string") return chatDelta.reasoning;
  if (data?.type === "reasoning_text_delta" && typeof data.delta === "string") return data.delta;
  return "";
}

export function summarizeRunItem(item) {
  if (!item) return null;
  const raw = item.rawItem || {};
  return {
    type: item.type,
    name: raw.name || item.toolName || item.name || null,
    callId: raw.callId || raw.id || null,
    arguments: raw.arguments || null,
    output: raw.output || raw.result || null,
    agentName: item.agent?.name || null
  };
}

export function interruptionMeta(item) {
  const raw = item?.rawItem || item || {};
  let args = raw.arguments || item?.arguments || {};
  if (typeof args === "string") {
    try {
      args = JSON.parse(args);
    } catch {
      args = { raw: args };
    }
  }
  return {
    callId: raw.callId || raw.id || item?.id || null,
    toolName: raw.name || item?.toolName || item?.name || "unknown",
    arguments: args,
    agentName: item?.agent?.name || null
  };
}
