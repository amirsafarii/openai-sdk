"use strict";

/**
 * Shallow-strips undefined/null values, empty arrays, and empty plain
 * objects from a result object's top-level keys. Deliberately does NOT
 * recurse into nested values (e.g. content.json), so it never discards
 * legitimate falsy data (0, false, null, [], {}) that a page's own JSON
 * or content actually contained.
 */
export function omitEmpty(obj) {
  const result = {};

  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0
    ) {
      continue;
    }
    result[key] = value;
  }

  return result;
}
