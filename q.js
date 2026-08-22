import { agent } from "./src/provider/agent.js";
import {
   lockManager, sessionStore, runStore, sessionManager, RunTracker
} from "./src/store/store.js";
import { askSelect } from "./src/utils/ask_confirm.js";
import { streamAgent } from "./src/utils/stream.js";
import { run } from "@openai/agents";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";

const manager = new RunTracker({ agent, sessionManager, runStore, lockManager });
const sessionId = "SESSION-1";
const session = await sessionStore.getSession(sessionId);

// ─────────────────────────────────────────────────────────
//  Helper: اجرا + نمایش + ردیابی
// ─────────────────────────────────────────────────────────
async function execute(inputOrState, existingRunId = null) {
   const stream = await run(agent, inputOrState, {
      traceIncludeSensitiveData: false,
      stream: true,
      session
   });
   await streamAgent(stream);
   return await manager.trackStream(sessionId, stream, existingRunId);
}

// ─────────────────────────────────────────────────────────
//  Helper: مدیریت approval
// ─────────────────────────────────────────────────────────
async function handleApproval(runId) {
   const approvals = await manager.listApprovals(runId);
   const pending = approvals.filter(a => a.status === "pending");

   for (const approval of pending) {
      console.log(`\n🔧 Tool: ${approval.toolName}`);
      console.log(`   Args: ${approval.arguments}`);

      const decision = await askSelect("🎯 تصمیم:", [
         { name: "✅ Approve", value: "approve" },
         { name: "❌ Reject", value: "reject" }
      ]);

      if (decision === "approve") {
         await manager.approveTool(runId, approval.approvalId);
         console.log(`   ✅ تأیید شد`);
      } else {
         await manager.rejectTool(runId, approval.approvalId, {
            message: "Rejected by user"
         });
         console.log(`   ❌ رد شد`);
      }
   }

   // اگر همه تمام شدند، ادامه بده
   const remaining = await manager.listApprovals(runId);
   const stillPending = remaining.filter(a => a.status === "pending");

   if (stillPending.length === 0) {
      console.log("\n🔄 در حال ادامه اجرا...");
      const state = await manager.loadState(runId);
      return await execute(state, runId);
   }

   return null;
}

// ─────────────────────────────────────────────────────────
//  Main Loop
// ─────────────────────────────────────────────────────────
async function worker() {
   console.log("\n🤖 AI Agent Ready (type 'exit' to quit)\n");

   const readLine = readline.createInterface({ input: stdin, output: stdout });

   try {
      while (true) {
         // ── بررسی Run فعال ──
         const active = await manager.activeRun(sessionId);

         // ── حالت ۱: منتظر تأیید ──
         if (active?.status === "waiting_for_approval") {
            console.log(`\n📍 Run فعال در حالت انتظار تأیید (${active.runId.substring(0, 8)}...)`);
            const result = await handleApproval(active.runId);

            if (result?.finalOutput) {
               console.log(`\n🤖 پاسخ نهایی:\n${result.finalOutput}`);
            }
            continue;
         }

         // ── حالت ۲: آماده ادامه ──
         if (active?.status === "ready_to_resume") {
            console.log(`\n📍 Run آماده ادامه (${active.runId.substring(0, 8)}...)`);
            const state = await manager.loadState(active.runId);
            const result = await execute(state, active.runId);

            if (result?.finalOutput) {
               console.log(`\n🤖 پاسخ نهایی:\n${result.finalOutput}`);
            }
            continue;
         }

         // ── حالت ۳: ورودی جدید ──
         if (active && manager._isTerminal(active.status)) {
            console.log(`\n📋 Run قبلی تمام شد: ${active.status}`);
         }

         const userInput = await readLine.question("\n> ");
         const trimmed = userInput.trim();

         if (!trimmed) continue;
         if (["exit", "quit"].includes(trimmed.toLowerCase())) break;

         console.log("\n🚀 در حال اجرا...");
         const result = await execute(trimmed);

         if (result?.type === "approval_required") {
            console.log(`\n⏸️  منتظر تأیید ابزار (${result.approvals?.length || 0} مورد)`);
         } else if (result?.finalOutput) {
            console.log(`\n🤖 پاسخ:\n${result.finalOutput}`);
         }

         if (result?.error) {
            console.error(`\n❌ خطا: ${result.error}`);
         }
      }
   } catch (err) {
      console.error(`\n[error] ${err.message}`);
   } finally {
      readLine.close();
      process.exit(0);
   }
}

worker().catch(err => {
   console.error(err);
   process.exit(1);
});