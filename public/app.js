const state = {
  sessionId: "web",
  runId: null,
  source: null
};

const $ = (id) => document.getElementById(id);

async function api(path, options) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
}

function statusClass(status) {
  return `status-${status || "idle"}`;
}

function addMessage(role, text) {
  const node = document.createElement("div");
  node.className = `bubble ${role}`;
  node.textContent = text;
  $("messages").appendChild(node);
  $("messages").scrollTop = $("messages").scrollHeight;
  return node;
}

function renderList(target, items, render) {
  target.innerHTML = "";
  if (!items.length) {
    target.innerHTML = '<div class="card"><small>Nothing yet</small></div>';
    return;
  }
  for (const item of items) target.appendChild(render(item));
}

async function refreshSessions() {
  const sessions = await api("/api/sessions");
  renderList($("sessionList"), sessions, (session) => {
    const el = document.createElement("div");
    el.className = `item${session.sessionId === state.sessionId ? " active" : ""}`;
    el.innerHTML = `<strong>${session.sessionId}</strong><small>${session.metadata?.status || "idle"} · ${session.items?.length || 0} items</small>`;
    el.onclick = () => {
      state.sessionId = session.sessionId;
      refreshAll();
    };
    return el;
  });
}

async function refreshRuns() {
  const runs = await api(`/api/runs?sessionId=${encodeURIComponent(state.sessionId)}`);
  renderList($("runList"), runs, (run) => {
    const el = document.createElement("div");
    el.className = `item${run.runId === state.runId ? " active" : ""}`;
    el.innerHTML = `<strong class="${statusClass(run.status)}">${run.status}</strong><small>${run.runId}</small>`;
    el.onclick = () => selectRun(run.runId);
    return el;
  });
  if (!state.runId && runs[0]) state.runId = runs[0].runId;
}

async function selectRun(runId) {
  state.runId = runId;
  listen(runId);
  await refreshInspect();
}

async function refreshInspect() {
  if (!state.runId) return;
  const [record, approvals, ledger, events] = await Promise.all([
    api(`/api/runs/${state.runId}`),
    api(`/api/runs/${state.runId}/approvals`),
    api(`/api/runs/${state.runId}/ledger`),
    api(`/api/runs/${state.runId}/events`)
  ]);
  $("runMeta").textContent = `${record.status} · ${record.runId}`;
  $("chatTitle").textContent = record.sessionId || "Conversation";
  renderList($("approvalList"), approvals, (item) => {
    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = `<strong>${item.toolName}</strong><small>${item.status}</small><small>${JSON.stringify(item.arguments)}</small>`;
    if (item.status === "pending") {
      const row = document.createElement("div");
      row.className = "actions";
      const yes = document.createElement("button");
      yes.textContent = "Approve";
      yes.onclick = async () => {
        await api(`/api/approvals/${item.approvalId}/approve`, { method: "POST", body: "{}" });
        refreshAll();
      };
      const no = document.createElement("button");
      no.textContent = "Reject";
      no.onclick = async () => {
        await api(`/api/approvals/${item.approvalId}/reject`, {
          method: "POST",
          body: JSON.stringify({ message: "Rejected from web UI" })
        });
        refreshAll();
      };
      row.append(yes, no);
      el.appendChild(row);
    }
    return el;
  });
  renderList($("ledgerList"), ledger, (item) => {
    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = `<strong>${item.toolName}</strong><small>${item.status} · attempt ${item.attempt}</small><small>${item.executionId}</small>`;
    return el;
  });
  const filter = $("eventFilter").value.toLowerCase();
  renderList($("eventList"), events.filter((event) => event.type.includes(filter)), (event) => {
    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = `<strong>${event.type}</strong><small>${event.timestamp}</small>`;
    el.onclick = () => addMessage("system", JSON.stringify(event, null, 2));
    return el;
  });
}

function listen(runId) {
  if (state.source) state.source.close();
  state.source = new EventSource(`/api/stream/${runId}`);
  let live = null;
  state.source.onmessage = (message) => {
    const event = JSON.parse(message.data);
    if (event.text) {
      if (!live) live = addMessage("agent", "");
      live.textContent += event.text;
      $("messages").scrollTop = $("messages").scrollHeight;
    }
    if (event.item?.type === "tool_call_item") {
      addMessage("system", `tool ${event.item.name}`);
    }
    if (event.type && event.type.startsWith("run.")) {
      refreshAll();
    }
  };
}

async function refreshAll() {
  const health = await api("/api/health");
  $("providerLabel").textContent = health.provider?.kind || "local";
  await refreshSessions();
  await refreshRuns();
  await refreshInspect();
}

$("chatForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = $("chatInput").value.trim();
  if (!input) return;
  $("chatInput").value = "";
  addMessage("user", input);
  const result = await api("/api/chat", {
    method: "POST",
    body: JSON.stringify({ sessionId: state.sessionId, input })
  });
  state.runId = result.runId;
  listen(result.runId);
  if (result.finalOutput) addMessage("agent", result.finalOutput);
  if (result.error) addMessage("system", result.error);
  await refreshAll();
});

$("resumeBtn").onclick = async () => state.runId && api(`/api/runs/${state.runId}/resume`, { method: "POST", body: "{}" }).then(refreshAll);
$("retryBtn").onclick = async () => state.runId && api(`/api/runs/${state.runId}/retry`, { method: "POST", body: "{}" }).then(refreshAll);
$("suspendBtn").onclick = async () => state.runId && api(`/api/runs/${state.runId}/suspend`, { method: "POST", body: "{}" }).then(refreshAll);
$("cancelBtn").onclick = async () => state.runId && api(`/api/runs/${state.runId}/cancel`, { method: "POST", body: "{}" }).then(refreshAll);
$("eventFilter").oninput = refreshInspect;

const live = new EventSource("/api/live");
live.onmessage = () => {
  refreshRuns().catch(() => {});
};

refreshAll().catch((error) => addMessage("system", error.message));
