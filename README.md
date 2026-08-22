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
# set OPENAI_API_KEY or OPENROUTER_API_KEY

npm install
npm test
npm start          # terminal UI
npm run web        # web UI on 0.0.0.0:3000
```

## Terminal commands

`/help`, `/runs`, `/state`, `/session`, `/memory`, `/events`, `/ledger`, `/approvals`, `/approve`, `/reject`, `/resume`, `/retry`, `/suspend`, `/cancel`
