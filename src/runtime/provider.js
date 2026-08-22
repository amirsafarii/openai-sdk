import "dotenv/config";
import OpenAI from "openai";
import {
  setDefaultOpenAIClient,
  setOpenAIAPI,
  setTracingDisabled
} from "@openai/agents";

/**
 * Single source of truth for the model provider.
 *
 * Every agent/model call in this repo goes through one OpenAI-compatible
 * gateway (9router) instead of api.openai.com. OPENAI_API_KEY is never used
 * to talk to OpenAI directly; it is only accepted as a fallback credential
 * for the gateway.
 */
export const DEFAULT_BASE_URL = "https://9router-production-ff19.up.railway.app/v1";
export const DEFAULT_MODEL = "root";
export const PROVIDER_KIND = "9router";
export const PROVIDER_API = "chat_completions";

export function providerBaseURL() {
  return (
    process.env.OPENROUTER_BASE_URL ||
    process.env.OPENAI_BASE_URL ||
    DEFAULT_BASE_URL
  );
}

export function providerApiKey() {
  return (
    process.env.OPENROUTER_API_KEY ||
    process.env.OPENAI_API_KEY ||
    ""
  );
}

export function providerModel() {
  return (
    process.env.OPENROUTER_MODEL ||
    process.env.OPENAI_MODEL ||
    DEFAULT_MODEL
  );
}

export function detectProvider() {
  const apiKey = providerApiKey();
  return {
    kind: apiKey ? PROVIDER_KIND : "none",
    api: PROVIDER_API,
    model: providerModel(),
    baseURL: providerBaseURL()
  };
}

/**
 * Builds a raw OpenAI-compatible client pointed at the gateway.
 * Useful anywhere the SDK client is needed directly.
 */
export function createProviderClient(overrides = {}) {
  return new OpenAI({
    apiKey: overrides.apiKey || providerApiKey() || "missing-api-key",
    baseURL: overrides.baseURL || providerBaseURL(),
    ...(overrides.defaultHeaders ? { defaultHeaders: overrides.defaultHeaders } : {}),
    ...(overrides.timeout ? { timeout: overrides.timeout } : {})
  });
}

let cachedClient = null;

export function getProviderClient() {
  if (!cachedClient) cachedClient = createProviderClient();
  return cachedClient;
}

/**
 * Wires the Agents SDK global defaults to the gateway.
 * Safe to call multiple times.
 */
export function configureProvider() {
  const detected = detectProvider();
  cachedClient = createProviderClient();
  setDefaultOpenAIClient(cachedClient);
  setOpenAIAPI(PROVIDER_API);
  // Tracing uploads target api.openai.com and are meaningless for this gateway.
  setTracingDisabled(true);
  return detected;
}
