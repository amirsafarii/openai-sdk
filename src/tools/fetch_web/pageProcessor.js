"use strict";

import { safeFetchWithRedirects, readBodyWithCap } from "./http.js";
import { MAX_RESPONSE_BYTES } from "./schema.js";
import {
  loadHtml,
  extractText,
  extractLinks,
  extractImages,
  extractMetadata,
  extractHeadings,
  extractForms,
  extractScripts,
  extractStylesheets
} from "./extract.js";
import { parseJsonBody } from "./jsonHandler.js";
import { omitEmpty } from "./output.js";

const HTML_CONTENT_TYPES = ["text/html", "application/xhtml+xml"];

function classifyContentType(contentType) {
  const ct = contentType.toLowerCase();
  if (HTML_CONTENT_TYPES.some(type => ct.includes(type))) return "html";
  if (ct.includes("application/json") || ct.includes("+json")) return "json";
  if (ct.startsWith("text/")) return "text";
  return "unsupported";
}

async function closeQuietly(dispatcher) {
  if (!dispatcher) return;
  try {
    await dispatcher.close();
  } catch {
    // best-effort cleanup only
  }
}

function truncate(str, maxChars) {
  if (str.length <= maxChars) return { value: str, truncated: false };
  return { value: str.slice(0, maxChars) + " \u2026", truncated: true };
}

/**
 * Fetches and processes a single URL end-to-end: SSRF-safe fetch with
 * redirect handling -> content-type classification -> size-capped body
 * read -> content-type-specific parsing -> selective field extraction
 * per the `extract` flags -> compact, agent-friendly output.
 *
 * Never throws for expected failure modes; always returns a structured
 * { ok, ... } result so one bad URL can't take down a batch.
 */
export async function processUrl(originalUrl, extract, options) {
  const { maxChars, timeout, maxRedirects, sameOriginLinksOnly, stripLinkFragments } = options;

  const fetchResult = await safeFetchWithRedirects(originalUrl, {
    timeoutMs: timeout,
    maxRedirects
  });

  if (!fetchResult.ok) {
    return omitEmpty({
      ok: false,
      url: originalUrl,
      finalUrl:
        fetchResult.finalUrl && fetchResult.finalUrl !== originalUrl
          ? fetchResult.finalUrl
          : undefined,
      status: fetchResult.status,
      redirects: fetchResult.redirects?.length ? fetchResult.redirects : undefined,
      error: { code: fetchResult.code, message: fetchResult.message }
    });
  }

  const { response, dispatcher, finalUrl, redirects } = fetchResult;
  const contentType = response.headers.get("content-type") || "";
  const kind = classifyContentType(contentType);

  if (kind === "unsupported") {
    await closeQuietly(dispatcher);
    return omitEmpty({
      ok: false,
      url: originalUrl,
      finalUrl: finalUrl !== originalUrl ? finalUrl : undefined,
      status: response.status,
      contentType,
      error: {
        code: "UNSUPPORTED_CONTENT_TYPE",
        message: `Content type "${contentType}" is not supported`
      }
    });
  }

  let body;
  try {
    body = await readBodyWithCap(response, MAX_RESPONSE_BYTES);
  } catch (error) {
    return omitEmpty({
      ok: false,
      url: originalUrl,
      finalUrl: finalUrl !== originalUrl ? finalUrl : undefined,
      status: response.status,
      contentType,
      error: { code: error.code || "PARSE_ERROR", message: error.message }
    });
  } finally {
    await closeQuietly(dispatcher);
  }

  const basePage = {
    ok: true,
    url: originalUrl,
    finalUrl: finalUrl !== originalUrl ? finalUrl : undefined,
    status: response.status,
    contentType,
    redirects: redirects?.length ? redirects : undefined
  };

  if (kind === "json") {
    const result = parseJsonBody(body, maxChars);
    return omitEmpty({
      ...basePage,
      content: "json" in result ? { json: result.json } : { text: result.text },
      truncated: Boolean(result.truncated)
    });
  }

  if (kind === "text") {
    const { value, truncated } = truncate(body, maxChars);
    return omitEmpty({ ...basePage, content: { text: value }, truncated });
  }

  // kind === "html"
  let $;
  try {
    $ = loadHtml(body);
  } catch {
    return omitEmpty({
      ...basePage,
      ok: false,
      error: { code: "PARSE_ERROR", message: "Failed to parse HTML" }
    });
  }

  const content = {};
  let truncated = false;

  if (extract.text) {
    const { value, truncated: textTruncated } = truncate(extractText($), maxChars);
    content.text = value;
    truncated = truncated || textTruncated;
  }

  if (extract.html) {
    const { value, truncated: htmlTruncated } = truncate(body, maxChars);
    content.html = value;
    truncated = truncated || htmlTruncated;
  }

  const page = { ...basePage, content, truncated };

  if (extract.metadata) page.metadata = extractMetadata($, finalUrl);
  if (extract.headings) page.headings = extractHeadings($);
  if (extract.links) {
    page.links = extractLinks($, finalUrl, {
      sameOriginOnly: sameOriginLinksOnly,
      stripFragments: stripLinkFragments
    });
  }
  if (extract.images) page.images = extractImages($, finalUrl);
  if (extract.forms) page.forms = extractForms($, finalUrl);
  if (extract.scripts) page.scripts = extractScripts($, finalUrl);
  if (extract.stylesheets) page.stylesheets = extractStylesheets($, finalUrl);

  return omitEmpty(page);
}
