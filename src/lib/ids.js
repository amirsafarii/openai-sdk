import { createHash, randomUUID } from "node:crypto";

export function createId(prefix = "") {
  const id = randomUUID();
  return prefix ? `${prefix}_${id}` : id;
}

export function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

export function hashValue(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function nowIso() {
  return new Date().toISOString();
}
