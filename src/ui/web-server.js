import express from "express";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntime } from "../runtime/AgentRuntime.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createWebApp({ runtime, publicDir } = {}) {
  if (!runtime) throw new Error("runtime is required");
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "2mb" }));
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(204).end();
    next();
  });

  const send = (res, data) => res.json(data);
  const fail = (res, error, status = 400) => {
    res.status(status).json({ error: error instanceof Error ? error.message : String(error) });
  };

  app.get("/api/health", async (_req, res) => {
    send(res, {
      ok: true,
      provider: runtime.provider,
      workspaceRoot: runtime.workspaceRoot
    });
  });

  app.get("/api/sessions", async (_req, res) => {
    try {
      send(res, await runtime.listSessions());
    } catch (error) {
      fail(res, error);
    }
  });

  app.get("/api/runs", async (req, res) => {
    try {
      send(res, await runtime.listRuns(req.query.sessionId));
    } catch (error) {
      fail(res, error);
    }
  });

  app.get("/api/runs/:id", async (req, res) => {
    try {
      const record = await runtime.getRun(req.params.id);
      if (!record) return fail(res, "Run not found", 404);
      send(res, record);
    } catch (error) {
      fail(res, error);
    }
  });

  app.get("/api/runs/:id/events", async (req, res) => {
    try {
      send(res, await runtime.debugger.query({ runId: req.params.id }));
    } catch (error) {
      fail(res, error);
    }
  });

  app.get("/api/runs/:id/ledger", async (req, res) => {
    try {
      send(res, await runtime.ledger.getByRun(req.params.id));
    } catch (error) {
      fail(res, error);
    }
  });

  app.get("/api/runs/:id/approvals", async (req, res) => {
    try {
      send(res, await runtime.approvals.listByRun(req.params.id));
    } catch (error) {
      fail(res, error);
    }
  });

  app.get("/api/events", async (req, res) => {
    try {
      send(res, await runtime.debugger.query({
        runId: req.query.runId,
        sessionId: req.query.sessionId,
        type: req.query.type,
        limit: req.query.limit ? Number(req.query.limit) : 200
      }));
    } catch (error) {
      fail(res, error);
    }
  });

  app.get("/api/memory", async (req, res) => {
    try {
      send(res, await runtime.memory.search(req.query.q || "", {
        scope: req.query.scope || undefined,
        sessionId: req.query.sessionId,
        runId: req.query.runId
      }));
    } catch (error) {
      fail(res, error);
    }
  });

  app.post("/api/memory", async (req, res) => {
    try {
      const { scope, key, value, sessionId, runId } = req.body || {};
      send(res, await runtime.memory.set(scope, key, value, { sessionId, runId }));
    } catch (error) {
      fail(res, error);
    }
  });

  app.post("/api/chat", async (req, res) => {
    try {
      const { sessionId = "web", input } = req.body || {};
      const result = await runtime.startRun({ sessionId, input, stream: true });
      send(res, {
        runId: result.runId,
        sessionId: result.sessionId,
        status: result.status,
        finalOutput: result.finalOutput,
        error: result.error,
        approvals: result.approvals
      });
    } catch (error) {
      fail(res, error);
    }
  });

  app.post("/api/runs/:id/resume", async (req, res) => {
    try {
      const result = await runtime.resumeRun(req.params.id);
      send(res, result);
    } catch (error) {
      fail(res, error);
    }
  });

  app.post("/api/runs/:id/retry", async (req, res) => {
    try {
      send(res, await runtime.retryRun(req.params.id));
    } catch (error) {
      fail(res, error);
    }
  });

  app.post("/api/runs/:id/suspend", async (req, res) => {
    try {
      send(res, await runtime.suspendRun(req.params.id));
    } catch (error) {
      fail(res, error);
    }
  });

  app.post("/api/runs/:id/cancel", async (req, res) => {
    try {
      send(res, await runtime.cancelRun(req.params.id));
    } catch (error) {
      fail(res, error);
    }
  });

  app.post("/api/approvals/:id/approve", async (req, res) => {
    try {
      const approval = await runtime.approvals.get(req.params.id);
      if (!approval) return fail(res, "Approval not found", 404);
      send(res, await runtime.approve(approval.runId, approval.approvalId, req.body || {}));
    } catch (error) {
      fail(res, error);
    }
  });

  app.post("/api/approvals/:id/reject", async (req, res) => {
    try {
      const approval = await runtime.approvals.get(req.params.id);
      if (!approval) return fail(res, "Approval not found", 404);
      send(res, await runtime.reject(approval.runId, approval.approvalId, req.body || {}));
    } catch (error) {
      fail(res, error);
    }
  });

  app.get("/api/stream/:runId", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    const write = (payload) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };
    write({ type: "connected", runId: req.params.runId });
    const unsubscribe = runtime.subscribe(req.params.runId, write);
    req.on("close", unsubscribe);
  });

  app.get("/api/live", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    const write = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
    const onEvent = (event) => write(event);
    const onStream = (event) => write(event);
    runtime.on("event", onEvent);
    runtime.on("stream", onStream);
    req.on("close", () => {
      runtime.off("event", onEvent);
      runtime.off("stream", onStream);
    });
  });

  app.use(express.static(publicDir || resolve(__dirname, "../../public")));
  return app;
}

export async function startWebServer({
  runtime,
  host = "0.0.0.0",
  port = Number(process.env.PORT || 3000),
  publicDir
} = {}) {
  const resolved = runtime || await createRuntime();
  await resolved.init();
  const app = createWebApp({ runtime: resolved, publicDir });
  return await new Promise((resolveListen) => {
    const server = app.listen(port, host, () => {
      const address = server.address();
      resolveListen({ server, runtime: resolved, port: address.port, host });
    });
  });
}
