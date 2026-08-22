import { request } from "undici";
import { z } from "zod";
import { load } from "cheerio";
import { assertSafeUrl, createPinnedAgent } from "./security.js";

const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]);

async function performHttp({
  url,
  method,
  headers,
  body,
  timeoutMs,
  signal,
  allowPrivateNetwork = false
}) {
  let dispatcher;
  if (!allowPrivateNetwork) {
    const safety = await assertSafeUrl(url);
    dispatcher = createPinnedAgent(safety.ip, safety.family);
  }
  try {
    const response = await request(url, {
      method,
      headers: {
        "user-agent": "openai-sdk-agent/1.0",
        ...(headers || {})
      },
      body: body == null ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      signal,
      ...(dispatcher ? { dispatcher } : {}),
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
      maxRedirections: 0
    });
    const text = await response.body.text();
    return {
      ok: response.statusCode >= 200 && response.statusCode < 300,
      status: response.statusCode,
      headers: Object.fromEntries(
        Object.entries(response.headers).map(([key, value]) => [key, String(value)])
      ),
      body: text.slice(0, 50_000),
      truncated: text.length > 50_000,
      url
    };
  } finally {
    if (dispatcher) await dispatcher.close();
  }
}

export function createHttpTools() {
  return [
    {
      name: "http_request",
      description: "Make an HTTP request to a public URL. Private/internal addresses are blocked.",
      parameters: z.object({
        url: z.string().describe("Absolute http or https URL"),
        method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]).default("GET"),
        headers: z.record(z.string(), z.string()).nullable().default(null),
        body: z.string().nullable().default(null),
        timeoutMs: z.number().int().min(100).max(60_000).default(15_000)
      }),
      needsApproval: async (_context, { method }) => method !== "GET" && method !== "HEAD",
      timeoutMs: 20_000,
      async execute({ url, method, headers, body, timeoutMs }, runContext, details) {
        const normalized = String(method || "GET").toUpperCase();
        if (!ALLOWED_METHODS.has(normalized)) {
          throw new Error(`HTTP method not allowed: ${normalized}`);
        }
        return performHttp({
          url,
          method: normalized,
          headers,
          body,
          timeoutMs,
          signal: details?.signal,
          allowPrivateNetwork: Boolean(runContext?.context?.allowPrivateNetwork)
        });
      }
    },
    {
      name: "fetch_url",
      description: "Fetch a public web page and extract readable text.",
      parameters: z.object({
        url: z.string().describe("Absolute http or https URL"),
        timeoutMs: z.number().int().min(100).max(60_000).default(15_000)
      }),
      timeoutMs: 20_000,
      async execute({ url, timeoutMs }, runContext, details) {
        const response = await performHttp({
          url,
          method: "GET",
          timeoutMs,
          signal: details?.signal,
          allowPrivateNetwork: Boolean(runContext?.context?.allowPrivateNetwork)
        });
        const contentType = response.headers["content-type"] || "";
        if (contentType.includes("application/json")) {
          try {
            return { ...response, kind: "json", json: JSON.parse(response.body) };
          } catch {
            return { ...response, kind: "text" };
          }
        }
        if (contentType.includes("text/html") || response.body.includes("<html")) {
          const $ = load(response.body);
          $("script,style,noscript").remove();
          const title = $("title").first().text().trim();
          const text = $("body").text().replace(/\s+/g, " ").trim().slice(0, 20_000);
          return { ...response, kind: "html", title, text };
        }
        return { ...response, kind: "text" };
      }
    }
  ];
}
