"use strict";

import { fetch as undiciFetch } from "undici";
import { validateUrlSafety, createPinnedAgent } from "./security.js";

/*
 * IMPORTANT: we deliberately use undici's own `fetch` here instead of
 * Node's global `fetch`. Node's built-in fetch is *also* powered by
 * undici internally, but it is a separate bundled copy from whatever
 * `undici` version is installed via npm. Passing a `dispatcher` (our
 * pinned-DNS Agent, built from the npm `undici` package in security.js)
 * to the *global* fetch can fail an internal instanceof/brand check on
 * some Node versions, causing every single request to fail immediately
 * with a generic "fetch failed" - regardless of the target URL. Using
 * undici's own fetch + undici's own Agent keeps both on the same module
 * instance, which avoids that failure mode entirely.
 */

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 2;
const BASE_BACKOFF_MS = 400;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function withTimeout(promise, ms, fallbackValue) {
  let timer;
  const timeoutPromise = new Promise(resolve => {
    timer = setTimeout(() => resolve(fallbackValue), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

async function closeQuietly(dispatcher) {
  if (!dispatcher) return;
  try {
    await dispatcher.close();
  } catch {
    // best-effort cleanup only
  }
}

/**
 * Reads a Response body up to a hard byte cap, cancelling the stream (and
 * therefore the underlying connection) if a page tries to send more than
 * that. This protects against huge or effectively-infinite responses
 * consuming memory before we ever get to apply maxChars.
 */
export async function readBodyWithCap(response, maxBytes) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    return await response.text();
  }

  const chunks = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => {});
      const err = new Error(`Response exceeded maximum allowed size of ${maxBytes} bytes`);
      err.code = "TOO_LARGE";
      throw err;
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString("utf-8");
}

/**
 * Fetches a URL, manually following redirects so that every hop (including
 * ones introduced by the origin server, not just the caller) is
 * independently re-validated against SSRF rules before being requested.
 * Retries transient failures (429/5xx/network/timeout) with exponential
 * backoff; does not retry redirects or non-retryable HTTP errors.
 *
 * On success, returns the raw Response plus the undici dispatcher used to
 * fetch it - the caller is responsible for closing that dispatcher once
 * it's done reading the body (see pageProcessor.js).
 */
export async function safeFetchWithRedirects(initialUrl, { timeoutMs, maxRedirects }) {
  let currentUrl = initialUrl;
  const redirectChain = [];

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const validation = await withTimeout(validateUrlSafety(currentUrl), timeoutMs, {
      ok: false,
      code: "TIMEOUT",
      message: "Timed out resolving/validating the URL"
    });

    if (!validation.ok) {
      return {
        ok: false,
        code: validation.code,
        message: validation.message,
        redirects: redirectChain,
        finalUrl: currentUrl
      };
    }

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const dispatcher = createPinnedAgent(validation.ip, validation.family);
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await undiciFetch(currentUrl, {
          method: "GET",
          redirect: "manual",
          signal: controller.signal,
          dispatcher,
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; FetchWebAgent/1.0; +tool)",
            Accept: "text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.5"
          }
        });

        if (REDIRECT_STATUSES.has(response.status)) {
          await closeQuietly(dispatcher);

          const location = response.headers.get("location");
          if (!location) {
            return {
              ok: false,
              code: "NETWORK_ERROR",
              message: "Redirect response was missing a Location header",
              redirects: redirectChain,
              finalUrl: currentUrl
            };
          }

          let nextUrl;
          try {
            nextUrl = new URL(location, currentUrl).toString();
          } catch {
            return {
              ok: false,
              code: "INVALID_URL",
              message: "Redirect target is not a valid URL",
              redirects: redirectChain,
              finalUrl: currentUrl
            };
          }

          redirectChain.push({ from: currentUrl, to: nextUrl, status: response.status });

          if (hop === maxRedirects) {
            return {
              ok: false,
              code: "REDIRECT_LIMIT",
              message: `Exceeded maximum of ${maxRedirects} redirects`,
              redirects: redirectChain,
              finalUrl: nextUrl
            };
          }

          currentUrl = nextUrl;
          break; // out of the retry loop; outer hop loop re-validates the new URL
        }

        if (!response.ok) {
          const retryable = RETRYABLE_STATUSES.has(response.status);
          if (retryable && attempt < MAX_RETRIES) {
            await closeQuietly(dispatcher);
            await sleep(BASE_BACKOFF_MS * 2 ** attempt);
            continue;
          }

          await closeQuietly(dispatcher);
          return {
            ok: false,
            code: "HTTP_ERROR",
            message: `Request failed with HTTP ${response.status}`,
            status: response.status,
            redirects: redirectChain,
            finalUrl: currentUrl
          };
        }

        // Success. Hand the response + dispatcher to the caller; they own
        // closing the dispatcher once the body has been read.
        return { ok: true, response, dispatcher, finalUrl: currentUrl, redirects: redirectChain };
      } catch (error) {
        await closeQuietly(dispatcher);

        const isAbort = error?.name === "AbortError";
        const failure = isAbort
          ? { code: "TIMEOUT", message: `Request timed out after ${timeoutMs}ms` }
          : { code: "NETWORK_ERROR", message: error?.message || "Network request failed" };

        if (attempt < MAX_RETRIES) {
          await sleep(BASE_BACKOFF_MS * 2 ** attempt);
          continue;
        }

        return { ok: false, ...failure, redirects: redirectChain, finalUrl: currentUrl };
      } finally {
        clearTimeout(timer);
      }
    }
  }

  return {
    ok: false,
    code: "REDIRECT_LIMIT",
    message: "Redirect chain did not resolve within the allowed number of hops",
    redirects: redirectChain,
    finalUrl: currentUrl
  };
}
