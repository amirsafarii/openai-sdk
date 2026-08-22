import { resolve, relative, isAbsolute, sep } from "node:path";
import { validateUrlSafety, isPrivateOrReservedIP, createPinnedAgent } from "./fetch_web/security.js";

const BLOCKED_COMMAND_PATTERNS = [
  /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)\s+(\/|\~|\$HOME)\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\b(shutdown|reboot|halt|poweroff)\b/i,
  /\bchmod\s+(-R\s+)?777\s+\//i,
  /\bcurl\b.+\|\s*(ba)?sh\b/i,
  /\bwget\b.+\|\s*(ba)?sh\b/i
];

export function assertWorkspacePath(workspaceRoot, inputPath) {
  if (!inputPath || typeof inputPath !== "string") {
    throw new Error("Path is required");
  }
  const root = resolve(workspaceRoot);
  const candidate = isAbsolute(inputPath) ? resolve(inputPath) : resolve(root, inputPath);
  const rel = relative(root, candidate);
  if (rel.startsWith("..") || isAbsolute(rel) || rel.split(sep).includes("..")) {
    throw new Error(`Path escapes workspace: ${inputPath}`);
  }
  if (candidate === root) {
    return { absolute: candidate, relative: "." };
  }
  return { absolute: candidate, relative: rel || "." };
}

export function assertSafeCommand(command) {
  if (!command || typeof command !== "string") {
    throw new Error("Command is required");
  }
  const trimmed = command.trim();
  if (!trimmed) throw new Error("Command is empty");
  for (const pattern of BLOCKED_COMMAND_PATTERNS) {
    if (pattern.test(trimmed)) {
      throw new Error(`Command blocked by security policy: ${trimmed}`);
    }
  }
  return trimmed;
}

export async function assertSafeUrl(url) {
  const result = await validateUrlSafety(url);
  if (!result.ok) {
    throw new Error(result.message || "URL failed security validation");
  }
  return result;
}

export { isPrivateOrReservedIP, createPinnedAgent, validateUrlSafety };
