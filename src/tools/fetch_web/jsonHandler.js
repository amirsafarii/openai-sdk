"use strict";

/**
 * Attempts to parse a response body as JSON. On success, returns the
 * structured value directly (so the agent gets real JSON, not a
 * JSON-stringified duplicate). If the serialized form is too large to
 * return safely, falls back to truncated text rather than a giant object.
 * On parse failure, falls back to plain (possibly truncated) text.
 */
export function parseJsonBody(body, maxChars) {
  try {
    const parsed = JSON.parse(body);
    const serialized = JSON.stringify(parsed);

    if (serialized.length <= maxChars) {
      return { json: parsed, truncated: false };
    }

    return { text: serialized.slice(0, maxChars) + " \u2026", truncated: true };
  } catch {
    const truncated = body.length > maxChars;
    return { text: truncated ? body.slice(0, maxChars) + " \u2026" : body, truncated };
  }
}

