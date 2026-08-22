# Autonomous Agent Runtime

Production runtime around the official OpenAI Agents SDK (`@openai/agents`) for Node.js ESM.

```
Terminal UI ─┐
             ├─> Agent Runtime ─> OpenAI Agents SDK
Web UI ──────┘          │
                        ├─ State
                        ├─ Memory
                        ├─ Tool Runtime
                        ├─ Approval
                        ├─ Execution Ledger
                        └─ Debugger/Events
```

## Run

```bash
cp .env.example .env
# set OPENROUTER_API_KEY (9router gateway key)

npm install
npm test
npm start          # terminal UI
npm run web        # web UI on 0.0.0.0:3000
```

## Model provider

All model traffic — terminal UI, web UI, and every `AgentRuntime` instance — goes
through a single OpenAI-compatible gateway (9router). `api.openai.com` is never
called directly.

| Variable | Purpose | Default |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | Gateway API key (required) | – |
| `OPENROUTER_BASE_URL` | Gateway base URL | `https://9router-production-ff19.up.railway.app/v1` |
| `OPENROUTER_MODEL` | Model id sent to the gateway | `root` |

`OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL` are still read, but only as
fallbacks for the same gateway — they never switch the runtime to OpenAI direct.

Wiring lives in `src/runtime/provider.js`:

```js
import { configureProvider, getProviderClient } from "./src/runtime/provider.js";

configureProvider();          // sets the SDK default client + chat_completions API
const client = getProviderClient(); // raw OpenAI-compatible client on the gateway
```

## Terminal commands

`/help`, `/runs`, `/state`, `/session`, `/memory`, `/events`, `/ledger`, `/approvals`, `/approve`, `/reject`, `/resume`, `/retry`, `/suspend`, `/cancel`
