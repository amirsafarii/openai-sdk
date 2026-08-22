import { randomUUID } from "node:crypto";
import { RunState } from "@openai/agents";

export class RunTracker {
   constructor({ agent, sessionManager, runStore, lockManager }) {
      this.agent = agent;
      this.sessionManager = sessionManager;
      this.runStore = runStore;
      this.lockManager = lockManager;
   }

   // ============================================================
   //  PRIVATE HELPERS
   // ============================================================

   _hasInterruptions(state) {
      if (state._currentStep?.type === "next_step_interruption") return true;
      return (state._generatedItems || []).some(
         item => item.type === "tool_approval_item"
      );
   }

   _getInterruptions(state) {
      if (state._currentStep?.type === "next_step_interruption") {
         const interruptions = state._currentStep.data?.interruptions;
         if (Array.isArray(interruptions) && interruptions.length > 0) {
            return interruptions;
         }
      }
      return (state._generatedItems || []).filter(
         item => item.type === "tool_approval_item"
      );
   }

   _interruptionToApproval(item) {
      const raw = item.rawItem || item;
      return {
         approvalId: raw.id || item.id || randomUUID(),
         callId: raw.callId || item.callId,
         toolName: raw.name || item.toolName || item.name || "unknown",
         arguments: raw.arguments || item.arguments || {},
         status: "pending"
      };
   }

   _detectStatus(result, state) {
      if (this._hasInterruptions(state)) return "waiting_for_approval";
      if (
         result.status === "max_turns_reached" ||
         state?.maxTurnsReached === true ||
         state?._currentStep?.type === "next_step_max_turns"
      ) return "max_turns_reached";
      if (result.status === "cancelled") return "cancelled";
      if (result.status === "failed" || result.error) return "failed";
      if (result.status === "aborted") return "aborted";
      return "completed";
   }

   _isTerminal(status) {
      return ["completed", "failed", "cancelled", "aborted", "max_turns_reached"].includes(status);
   }

   _cleanNewItems(newItems) {
      if (!newItems || newItems.length === 0) return [];
      return newItems
         .filter(item => item.type !== "tool_approval_item")
         .map(item => item.rawItem || item);
   }

   // ============================================================
   //  LOOKUP (فقط ۲ متد)
   // ============================================================

   async findRun(runId) {
      return await this.runStore.get(runId);
   }

   async activeRun(sessionId) {
      const metadata = await this.sessionManager.getMetadata(sessionId);
      if (!metadata.activeRunId) return null;
      return await this.runStore.get(metadata.activeRunId);
   }

   // ============================================================
   //  STATE (فقط ۱ متد)
   // ============================================================

   async loadState(runId) {
      const record = await this.runStore.get(runId);
      if (!record) throw new Error("Run not found");
      return await RunState.fromString(this.agent, record.state);
   }

   // ============================================================
   //  STATUS (فقط ۲ متد)
   // ============================================================

   async status(runId) {
      const record = await this.runStore.get(runId);
      if (!record) throw new Error("Run not found");
      return record.status;
   }

   async isTerminal(runId) {
      const s = await this.status(runId);
      return this._isTerminal(s);
   }

   // ============================================================
   //  APPROVALS (فقط ۳ متد)
   // ============================================================

   async listApprovals(runId) {
      try {
         const state = await this.loadState(runId);
         const interruptions = this._getInterruptions(state);
         return interruptions.map(i => this._interruptionToApproval(i));
      } catch (e) {
         const record = await this.runStore.get(runId);
         return record?.approvals || [];
      }
   }

   async approveTool(runId, approvalId, options = {}) {
      return this.lockManager.withLock(`run:${runId}`, async () => {
         const record = await this.runStore.get(runId);
         if (!record) throw new Error("Run not found");

         const state = await this.loadState(runId);
         const interruptions = this._getInterruptions(state);
         const interruption = interruptions.find(
            i => (i.rawItem?.id || i.id) === approvalId
         );

         if (!interruption) throw new Error(`Approval "${approvalId}" not found`);

         state.approve(interruption, options);

         const approval = (record.approvals || []).find(a => a.approvalId === approvalId);
         if (approval) approval.status = "approved";

         const allDone = (record.approvals || []).every(a => a.status !== "pending");
         record.status = allDone ? "ready_to_resume" : "waiting_for_approval";

         record.state = state.toString();
         await this.runStore.save(record);

         return { runId, state, record, allDone };
      });
   }

   async rejectTool(runId, approvalId, options = {}) {
      return this.lockManager.withLock(`run:${runId}`, async () => {
         const record = await this.runStore.get(runId);
         if (!record) throw new Error("Run not found");

         const state = await this.loadState(runId);
         const interruptions = this._getInterruptions(state);
         const interruption = interruptions.find(
            i => (i.rawItem?.id || i.id) === approvalId
         );

         if (!interruption) throw new Error(`Approval "${approvalId}" not found`);

         state.reject(interruption, options);

         const approval = (record.approvals || []).find(a => a.approvalId === approvalId);
         if (approval) {
            approval.status = "rejected";
            approval.rejectionMessage = options.message || "Rejected";
         }

         const allDone = (record.approvals || []).every(a => a.status !== "pending");
         record.status = allDone ? "ready_to_resume" : "waiting_for_approval";

         record.state = state.toString();
         await this.runStore.save(record);

         return { runId, state, record, allDone };
      });
   }

   // ============================================================
   //  INPUT (فقط ۳ متد)
   // ============================================================

   async stageInput(runId, input) {
      return this.lockManager.withLock(`run:${runId}`, async () => {
         const record = await this.runStore.get(runId);
         if (!record) throw new Error("Run not found");

         if (this._isTerminal(record.status)) {
            throw new Error(`Cannot add input to terminal run (status: ${record.status})`);
         }
         if (
            record.status !== "waiting_for_approval" &&
            record.status !== "ready_to_resume"
         ) {
            throw new Error(`Cannot add input in status: ${record.status}`);
         }

         const state = await this.loadState(runId);
         state.addInput(input);

         record.pendingInput = record.pendingInput || [];
         record.pendingInput.push(input);
         record.state = state.toString();
         await this.runStore.save(record);

         return { runId, state, record };
      });
   }

   async pendingInput(runId) {
      const record = await this.runStore.get(runId);
      if (!record) return [];
      return record.pendingInput || [];
   }

   async clearPendingInput(runId) {
      return this.lockManager.withLock(`run:${runId}`, async () => {
         const record = await this.runStore.get(runId);
         if (!record) return;
         record.pendingInput = [];
         await this.runStore.save(record);
      });
   }

   // ============================================================
   //  TRACKING (۲ متد)
   // ============================================================

   async trackResult(sessionId, result, existingRunId = null) {
      return await this._track(sessionId, result, existingRunId);
   }

   async trackStream(sessionId, stream, existingRunId = null) {
      await new Promise((resolve, reject) => {
         if (stream.completed && typeof stream.completed.then === "function") {
            stream.completed.then(resolve).catch(reject);
         } else if (typeof stream.on === "function") {
            stream.on("completed", resolve);
            stream.on("error", reject);
            setTimeout(() => resolve(), 60000);
         } else {
            resolve();
         }
      });

      return await this._track(sessionId, stream, existingRunId);
   }

   async _track(sessionId, result, existingRunId = null) {
      const turnId = randomUUID();
      const messageId = randomUUID();

      if (result instanceof Error) {
         return await this._markAsFailed(
            existingRunId || randomUUID(),
            result,
            sessionId,
            turnId,
            messageId
         );
      }

      const state = result.state;
      if (!state) {
         return { type: "error", error: "No state found in result" };
      }

      // محافظ خودکار برای جلوگیری از Runهای موازی
      if (!existingRunId) {
         const active = await this.activeRun(sessionId);
         if (active && !this._isTerminal(active.status)) {
            existingRunId = active.runId;
            console.warn(`⚠️  Run فعال (${active.runId.substring(0, 8)}...) - از existingRunId استفاده می‌شود.`);
         }
      }

      const runStatus = this._detectStatus(result, state);
      const interruptions = this._hasInterruptions(state)
         ? this._getInterruptions(state)
         : [];
      const approvals = interruptions.map(i => this._interruptionToApproval(i));

      let finalOutput = undefined;
      let error = undefined;
      let terminationReason = undefined;

      if (runStatus === "max_turns_reached") {
         terminationReason = `Max turns reached (${state.maxTurns || "?"})`;
      } else if (runStatus === "cancelled") {
         terminationReason = "Cancelled";
      } else if (runStatus === "failed") {
         terminationReason = result.error?.message || "Failed";
         error = result.error?.message || String(result.error);
      } else if (runStatus === "aborted") {
         terminationReason = "Aborted";
         error = "Aborted";
      } else if (runStatus === "completed") {
         try { finalOutput = result.finalOutput; } catch (e) {}
      }

      const isTerminal = this._isTerminal(runStatus);

      let record;
      if (existingRunId) {
         record = await this.runStore.get(existingRunId);
         record.state = state.toString();
         record.status = runStatus;
         record.approvals = approvals;
         record.terminationReason = terminationReason;
         record.error = error;
         record.finalOutput = finalOutput;
         if (isTerminal) record.pendingInput = [];
         await this.runStore.save(record);
      } else {
         record = await this.runStore.create({
            sessionId, turnId, messageId,
            state: state.toString(),
            status: runStatus,
            interruptions, terminationReason, finalOutput, error
         });
      }

      const cleanItems = this._cleanNewItems(result.newItems);
      if (cleanItems.length > 0) {
         await this.sessionManager.addItems(sessionId, cleanItems);
      }

      if (isTerminal) {
         await this.sessionManager.clearActiveRun(sessionId);
      } else {
         await this.sessionManager.setActiveRun(sessionId, record.runId, runStatus);
      }

      const response = {
         type:
            runStatus === "waiting_for_approval" ? "approval_required" :
            runStatus === "completed" ? "completed" :
            "terminated",
         status: runStatus,
         sessionId,
         runId: record.runId,
         turnId: record.turnId,
         messageId: record.messageId,
         state
      };

      if (runStatus === "waiting_for_approval") response.approvals = approvals;
      if (finalOutput !== undefined) response.finalOutput = finalOutput;
      if (terminationReason) response.terminationReason = terminationReason;
      if (error) response.error = error;

      return response;
   }

   // ============================================================
   //  LIFECYCLE (فقط cancel)
   //  complete و fail به صورت خودکار توسط trackStream انجام می‌شوند
   // ============================================================

   async cancel(runId, reason = "Cancelled by user") {
      return this.lockManager.withLock(`run:${runId}`, async () => {
         const record = await this.runStore.get(runId);
         if (!record) throw new Error("Run not found");
         if (this._isTerminal(record.status)) return record;

         await this.runStore.updateStatus(runId, "cancelled", {
            terminationReason: reason
         });
         record.pendingInput = [];
         await this.runStore.save(record);

         if (record.sessionId) {
            await this.sessionManager.clearActiveRun(record.sessionId);
         }
         return await this.runStore.get(runId);
      });
   }

   // متد داخلی برای هندل Error در trackStream
   async _markAsFailed(runId, error, sessionId, turnId, messageId) {
      return this.lockManager.withLock(`run:${runId}`, async () => {
         const errorMsg = error instanceof Error ? error.message : String(error);
         let record = await this.runStore.get(runId);
         if (!record && sessionId) {
            record = await this.runStore.create({
               sessionId,
               turnId: turnId || randomUUID(),
               messageId: messageId || randomUUID(),
               state: "",
               status: "failed",
               interruptions: [],
               terminationReason: errorMsg,
               error: errorMsg
            });
         } else if (record) {
            await this.runStore.updateStatus(runId, "failed", {
               terminationReason: errorMsg,
               error: errorMsg
            });
            record.pendingInput = [];
            await this.runStore.save(record);
         }
         if (record?.sessionId) {
            await this.sessionManager.clearActiveRun(record.sessionId);
         }
         return {
            type: "terminated",
            status: "failed",
            runId: record.runId,
            sessionId: record.sessionId,
            error: errorMsg,
            terminationReason: errorMsg
         };
      });
   }

   // ============================================================
   //  DELETE (فقط ۱ متد)
   // ============================================================

   async deleteRun(runId) {
      const record = await this.runStore.get(runId);
      await this.runStore.delete(runId);
      if (record?.sessionId) {
         const active = await this.activeRun(record.sessionId);
         if (active?.runId === runId) {
            await this.sessionManager.clearActiveRun(record.sessionId);
         }
      }
   }
}