import { spawn } from "node:child_process";
import { z } from "zod";
import { assertSafeCommand, assertWorkspacePath } from "./security.js";

function runProcess(command, { cwd, timeoutMs, signal }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      env: {
        ...process.env,
        PATH: process.env.PATH
      }
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1000);
      finish({
        ok: false,
        exitCode: null,
        signal: "SIGTERM",
        stdout,
        stderr: `${stderr}\nCommand timed out after ${timeoutMs}ms`,
        timedOut: true
      });
    }, timeoutMs);

    const onAbort = () => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1000);
      finish({
        ok: false,
        exitCode: null,
        signal: "SIGTERM",
        stdout,
        stderr: `${stderr}\nCommand cancelled`,
        cancelled: true
      });
    };

    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > 200_000) stdout = stdout.slice(-200_000);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 200_000) stderr = stderr.slice(-200_000);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, closeSignal) => {
      clearTimeout(timer);
      finish({
        ok: code === 0,
        exitCode: code,
        signal: closeSignal,
        stdout,
        stderr,
        timedOut: false,
        cancelled: false
      });
    });
  });
}

export function createTerminalTools() {
  return [
    {
      name: "run_command",
      description:
        "Run a shell command inside the agent workspace. Destructive or system-level commands are blocked.",
      parameters: z.object({
        command: z.string().describe("Shell command to execute"),
        cwd: z.string().default(".").describe("Working directory relative to the workspace"),
        timeoutMs: z.number().int().min(100).max(120_000).default(15_000)
      }),
      needsApproval: true,
      timeoutMs: 30_000,
      async execute({ command, cwd, timeoutMs }, runContext, details) {
        const safeCommand = assertSafeCommand(command);
        const mapped = assertWorkspacePath(runContext?.context?.workspaceRoot, cwd || ".");
        const result = await runProcess(safeCommand, {
          cwd: mapped.absolute,
          timeoutMs,
          signal: details?.signal
        });
        return {
          command: safeCommand,
          cwd: mapped.relative,
          ...result
        };
      }
    }
  ];
}
