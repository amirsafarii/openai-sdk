import { mkdir, readFile, writeFile, readdir, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { assertWorkspacePath } from "./security.js";

function workspaceFrom(runContext) {
  return runContext?.context?.workspaceRoot;
}

export function createFilesystemTools() {
  return [
    {
      name: "read_file",
      description: "Read a UTF-8 text file from the agent workspace.",
      parameters: z.object({
        path: z.string().describe("Path relative to the workspace root")
      }),
      timeoutMs: 10_000,
      async execute({ path }, runContext) {
        const mapped = assertWorkspacePath(workspaceFrom(runContext), path);
        const info = await stat(mapped.absolute);
        if (!info.isFile()) throw new Error(`Not a file: ${mapped.relative}`);
        const content = await readFile(mapped.absolute, "utf8");
        return { path: mapped.relative, bytes: Buffer.byteLength(content), content };
      }
    },
    {
      name: "write_file",
      description: "Write a UTF-8 text file inside the agent workspace.",
      parameters: z.object({
        path: z.string().describe("Path relative to the workspace root"),
        content: z.string().describe("File contents"),
        overwrite: z.boolean().default(true)
      }),
      needsApproval: true,
      timeoutMs: 10_000,
      async execute({ path, content, overwrite }, runContext) {
        const mapped = assertWorkspacePath(workspaceFrom(runContext), path);
        await mkdir(dirname(mapped.absolute), { recursive: true });
        if (!overwrite) {
          try {
            await stat(mapped.absolute);
            throw new Error(`File already exists: ${mapped.relative}`);
          } catch (error) {
            if (error.code !== "ENOENT") throw error;
          }
        }
        await writeFile(mapped.absolute, content, "utf8");
        return { path: mapped.relative, bytes: Buffer.byteLength(content), written: true };
      }
    },
    {
      name: "list_dir",
      description: "List files and directories inside the agent workspace.",
      parameters: z.object({
        path: z.string().default(".").describe("Directory path relative to the workspace")
      }),
      timeoutMs: 10_000,
      async execute({ path }, runContext) {
        const mapped = assertWorkspacePath(workspaceFrom(runContext), path);
        const entries = await readdir(mapped.absolute, { withFileTypes: true });
        return {
          path: mapped.relative,
          entries: entries.map((entry) => ({
            name: entry.name,
            type: entry.isDirectory() ? "directory" : "file",
            path: join(mapped.relative === "." ? "" : mapped.relative, entry.name) || entry.name
          }))
        };
      }
    },
    {
      name: "delete_file",
      description: "Delete a file inside the agent workspace.",
      parameters: z.object({
        path: z.string().describe("Path relative to the workspace root")
      }),
      needsApproval: true,
      timeoutMs: 10_000,
      async execute({ path }, runContext) {
        const mapped = assertWorkspacePath(workspaceFrom(runContext), path);
        await unlink(mapped.absolute);
        return { path: mapped.relative, deleted: true };
      }
    }
  ];
}
