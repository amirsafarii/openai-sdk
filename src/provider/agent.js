import dns from "node:dns";
import * as z from "zod";
import { provider } from "./9router.js";
import { webSearchTool, jinaReaderTool } from "../tools/registery.js";

import {
   Agent,
   run,
   tool,
   Runner,
   setDefaultOpenAIClient,
   setOpenAIAPI
} from "@openai/agents";
dns.setDefaultResultOrder("ipv4first");
setDefaultOpenAIClient(provider);
setOpenAIAPI("chat_completions");
const summarizer = new Agent({
  name: "Summarizer",
  model: "router",
  instructions: `
    Summarize the provided text concisely.
    Preserve important facts, decisions and action items.
  `,
});

const summarizeTool = summarizer.asTool({
  toolName: "summarize",
  toolDescription: "Summarize text or information when a concise summary is useful.",
});
export const finalAnswerAgent = new Agent({
  name: "Final Answer Agent",

  model: "router",

  instructions: `
You are a final-answer specialist.

Your job is to take the result produced by the main agent
and turn it into the final response for the user.

Rules:
- Preserve facts.
- Never invent information.
- Do not perform research.
- Do not call other tools.
- Do not expose internal reasoning.
- Do not mention being a sub-agent.
- Answer in the user's language.
- If the user speaks Persian, use natural Persian.
- Keep the answer concise unless detail is necessary.
- Preserve code accurately.
- Return ONLY the final user-facing answer.
`,
});
export const finalAnswerTool = finalAnswerAgent.asTool({
  toolName: "final_answer",

  toolDescription: `
Use this tool when the main agent has completed its work
and needs to turn its result into a clean, user-facing final answer.

Pass the completed result of your work to this tool.
Do not use this tool for research, reasoning, or intermediate processing.
`,
});

const agent = new Agent({
   name: "bot",
   model: "root",
   instructions: `
   You are the main agent.

Use your tools and sub-agents to complete the user's request.

When your work is complete, use the final_answer tool
to convert the result into the final response.

Do not use final_answer for intermediate results.
Reasoning summaries must always be written in Persian (Farsi).
Use Persian for your reasoning summary.
Do not write reasoning summaries in English.
Your final answer should also be in Persian.
`,
   tools: [webSearchTool, jinaReaderTool,summarizeTool,finalAnswerTool]
});


export {agent};