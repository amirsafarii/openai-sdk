"use strict";

import { tool } from "@openai/agents";
import { z } from "zod";

const DEFAULT_TIMEOUT = 15_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_SNIPPET_LENGTH = 500;

/* -------------------------------------------------------
 * Schema
 * ----------------------------------------------------- */

const searchQuerySchema = z.object({
   q: z.string().min(1).max(500).describe("Precise search query"),

   gl: z
      .string()
      .length(2)
      .default("us")
      .describe("Google country code, e.g. us, ir, de"),

   hl: z
      .string()
      .length(2)
      .default("en")
      .describe("Google language code, e.g. en, fa, de"),

   timeRange: z
      .enum(["any", "hour", "day", "week", "month", "year"])
      .default("any")
      .describe("Time range filter"),

   maxResults: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(10)
      .describe("Maximum number of results"),

   page: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(1)
      .describe("Search result page")
});

const webSearchSchema = z.object({
   queries: z
      .array(searchQuerySchema)
      .min(1)
      .max(10)
      .describe("One or more search queries")
});

/* -------------------------------------------------------
 * Helpers
 * ----------------------------------------------------- */

function sleep(ms) {
   return new Promise(resolve => setTimeout(resolve, ms));
}

function cleanText(value, maxLength = DEFAULT_SNIPPET_LENGTH) {
   if (typeof value !== "string") {
      return "";
   }

   const text = value
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

   return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`;
}

function buildSerperPayload(query) {
   const payload = {
      q: query.q,
      gl: query.gl,
      hl: query.hl,
      num: query.maxResults
   };

   if (query.timeRange !== "any") {
      payload.tbs = {
         hour: "qdr:h",
         day: "qdr:d",
         week: "qdr:w",
         month: "qdr:m",
         year: "qdr:y"
      }[query.timeRange];
   }

   if (query.page > 1) {
      payload.page = query.page;
   }

   return payload;
}

/* -------------------------------------------------------
 * HTTP
 * ----------------------------------------------------- */

async function requestSerper(payload, timeout) {
   const apiKey = "ef8b81dc0619993f78beb9dc142ebf1eb6bba963";

   if (!apiKey) {
      throw new Error("SERPER_API_KEY environment variable is not configured");
   }

   const controller = new AbortController();

   const timer = setTimeout(() => controller.abort(), timeout);

   try {
      return await fetch("https://google.serper.dev/search", {
         method: "POST",

         headers: {
            "X-API-KEY": apiKey,
            "Content-Type": "application/json",
            "User-Agent": "Korosh-Agent/1.0"
         },

         body: JSON.stringify(payload),

         signal: controller.signal
      });
   } finally {
      clearTimeout(timer);
   }
}

/* -------------------------------------------------------
 * Single Search
 * ----------------------------------------------------- */

async function searchSingle(query) {
   const payload = buildSerperPayload(query);

   let lastError = null;

   for (let attempt = 0; attempt <= DEFAULT_RETRIES; attempt++) {
      try {
         const response = await requestSerper(payload, DEFAULT_TIMEOUT);

         const retryable = response.status === 429 || response.status >= 500;

         if (!response.ok) {
            const errorText = await response.text().catch(() => "");

            if (retryable && attempt < DEFAULT_RETRIES) {
               await sleep(500 * 2 ** attempt);

               continue;
            }

            return {
               ok: false,
               query: query.q,
               error:
                  `Serper HTTP ${response.status}` +
                  (errorText ? `: ${errorText}` : "")
            };
         }

         let data;

         try {
            data = await response.json();
         } catch {
            return {
               ok: false,
               query: query.q,
               error: "Serper returned invalid JSON"
            };
         }

         const organic = Array.isArray(data.organic) ? data.organic : [];

         return {
            ok: true,

            query: data.searchParameters?.q ?? query.q,

            resultCount: organic.length,

            results: organic.map(item => ({
               title: cleanText(item.title, 300),

               url: typeof item.link === "string" ? item.link : "",

               snippet: cleanText(item.snippet, DEFAULT_SNIPPET_LENGTH),

               position: Number.isInteger(item.position) ? item.position : null,

               publishedAt: item.date ?? null
            })),

            knowledgeGraph: data.knowledgeGraph ?? null,

            peopleAlsoAsk: Array.isArray(data.peopleAlsoAsk)
               ? data.peopleAlsoAsk
               : [],

            relatedSearches: Array.isArray(data.relatedSearches)
               ? data.relatedSearches
               : []
         };
      } catch (error) {
         lastError =
            error?.name === "AbortError"
               ? `Search timed out after ${DEFAULT_TIMEOUT}ms`
               : (error?.message ?? "Unknown search error");

         if (attempt < DEFAULT_RETRIES) {
            await sleep(500 * 2 ** attempt);
         }
      }
   }

   return {
      ok: false,
      query: query.q,
      error: lastError ?? "Unknown search error"
   };
}

/* -------------------------------------------------------
 * Tool
 * ----------------------------------------------------- */

export const webSearchTool = tool({
   name: "web_search",

   description: `
Search the public internet using Google Search through Serper.dev.

Use for:
- Current information
- Recent news
- Latest software/library information
- Prices and changing information
- Facts requiring web verification

Supports multiple independent search queries in one call.

Do not use this tool to open a specific webpage.
Use a URL fetching tool when an exact URL is already known.
`.trim(),

   parameters: webSearchSchema,
   needsApproval: true,
   async execute(input) {
      const settled = await Promise.allSettled(input.queries.map(searchSingle));

      const results = settled.map((result, index) => {
         if (result.status === "fulfilled") {
            return result.value;
         }

         return {
            ok: false,

            query: input.queries[index].q,

            error: result.reason?.message ?? "Unknown search error"
         };
      });

      const successfulQueries = results.filter(result => result.ok).length;

      return {
         ok: successfulQueries > 0,

         totalQueries: results.length,

         successfulQueries,

         failedQueries: results.length - successfulQueries,

         results
      };
   }
});

export default webSearchTool;
