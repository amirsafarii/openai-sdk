import "dotenv/config";
import OpenAI from "openai";
import { setDefaultOpenAIClient, setDefaultOpenAIKey, setOpenAIAPI } from "@openai/agents";

export function detectProvider() {
  if (process.env.OPENAI_API_KEY) {
    return {
      kind: "openai",
      api: "responses",
      model: process.env.OPENAI_MODEL || undefined
    };
  }
  if (process.env.OPENROUTER_API_KEY) {
    return {
      kind: "openrouter",
      api: "chat_completions",
      model: process.env.OPENROUTER_MODEL || "openai/gpt-4.1-mini"
    };
  }
  return { kind: "none", api: null, model: undefined };
}

export function configureProvider() {
  const detected = detectProvider();
  if (detected.kind === "openai") {
    setDefaultOpenAIKey(process.env.OPENAI_API_KEY);
    setOpenAIAPI("responses");
    return detected;
  }
  if (detected.kind === "openrouter") {
    const client = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1"
    });
    setDefaultOpenAIClient(client);
    setOpenAIAPI("chat_completions");
    return detected;
  }
  return detected;
}
