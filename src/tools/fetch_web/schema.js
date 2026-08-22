"use strict";

import { z } from "zod";

/* =========================================================
 * Jina AI Reader / Search — Capability Schema
 * Source: https://r.jina.ai/docs
 * ========================================================= */

const respondWithEnum = z.enum(["default", "markdown", "html", "text", "screenshot", "pageshot", "frontmatter", "markdown+frontmatter"]).default("default");
const engineEnum = z.enum(["auto", "browser", "curl", "cf-browser-rendering"]).default("auto");
const respondTimingEnum = z.enum(["html", "visible-content", "mutation-idle", "resource-idle", "media-idle", "network-idle"]).optional();
const retainImagesEnum = z.enum(["all", "none", "alt", "all_p", "alt_p"]).default("all");
const retainLinksEnum = z.enum(["all", "none", "text", "gpt-oss"]).default("all");
const retainMediaEnum = z.enum(["link", "none", "text", "image", "html"]).default("link");
const presetEnum = z.enum(["reader", "index", "research", "agent", "spider"]).optional();
const markdownChunkingEnum = z.enum(["true", "h1", "h2", "h3", "h4", "h5", "structured", "s1", "s2", "s3", "s4", "s5"]).optional();

const withLinksOrImagesSummaryEnum = z.enum(["true", "all"]).optional();

// Turndown options
const mdHeadingStyleEnum = z.enum(["setext", "atx"]).optional();
const mdBulletMarkerEnum = z.enum(["-", "+", "*"]).optional();
const mdEmDelimiterEnum = z.enum(["_", "*"]).optional();
const mdStrongDelimiterEnum = z.enum(["**", "__"]).optional();
const mdLinkStyleEnum = z.enum(["inlined", "referenced", "discarded"]).optional();

export const jinaOptionsSchema = z.object({
  respondWith: respondWithEnum,
  engine: engineEnum,
  respondTiming: respondTimingEnum,
  jsonMode: z.boolean().default(false).describe("Sets Accept: application/json"),
  streamMode: z.boolean().default(false).describe("Sets Accept: text/event-stream"),
  targetSelector: z.string().optional(),
  waitForSelector: z.string().optional(),
  removeSelector: z.string().optional(),
  retainImages: retainImagesEnum,
  retainLinks: retainLinksEnum,
  retainMedia: retainMediaEnum,
  withLinksSummary: withLinksOrImagesSummaryEnum,
  withImagesSummary: withLinksOrImagesSummaryEnum,
  withGeneratedAlt: z.boolean().default(false),
  withIframe: z.boolean().default(false),
  withShadowDom: z.boolean().default(false),
  useFinalUrlAsBase: z.boolean().default(false).describe("Resolves relative URLs against post-redirect URL"),
  keepImgDataUrl: z.boolean().default(false),
  maxTokens: z.number().int().min(500).optional(),
  tokenBudget: z.number().int().positive().optional(),
  markdownChunking: markdownChunkingEnum,
  noCache: z.boolean().default(false),
  cacheTolerance: z.number().int().min(0).optional(),
  doNotTrack: z.boolean().default(false),
  timeout: z.number().int().min(1).max(180).optional(),
  proxyUrl: z.string().url().optional(),
  proxyCountry: z.string().optional(),
  userAgent: z.string().optional(),
  referer: z.string().optional(),
  setCookie: z.union([z.string(), z.array(z.string())]).optional(),
  locale: z.string().optional(),
  robotsTxt: z.string().optional(),
  mdHeadingStyle: mdHeadingStyleEnum,
  mdHr: z.string().optional(),
  mdBulletListMarker: mdBulletMarkerEnum,
  mdEmDelimiter: mdEmDelimiterEnum,
  mdStrongDelimiter: mdStrongDelimiterEnum,
  mdLinkStyle: mdLinkStyleEnum,
  noGfm: z.union([z.boolean(), z.string()]).optional(),
  preset: presetEnum,
  viewport: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    deviceScaleFactor: z.number().positive().optional(),
    isMobile: z.boolean().optional(),
    hasTouch: z.boolean().optional(),
    isLandscape: z.boolean().optional()
  }).optional(),
  injectPageScript: z.string().optional(),
  euResidency: z.boolean().default(false),
  apiKey: z.string().optional().describe("Jina API key (Authorization: Bearer)")
}).default({});

export const jinaReadSchema = z.object({
  mode: z.literal("read").default("read"),
  url: z.string().url().describe("The exact URL to read via r.jina.ai."),
  options: jinaOptionsSchema
});

export const jinaSearchSchema = z.object({
  mode: z.literal("search").default("search"),
  query: z.string().min(1).describe("Search query for s.jina.ai."),
  site: z.array(z.string()).optional().describe("Restrict search to these domain(s)."),
  count: z.number().int().min(1).max(10).optional().describe("Number of results to fetch (default 5)."),
  options: jinaOptionsSchema
});

export const jinaReaderSchema = z.discriminatedUnion("mode", [jinaReadSchema, jinaSearchSchema]);
export default jinaReaderSchema;