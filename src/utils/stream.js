// stream.js

function printNested(value, prefix = "") {

   if (Array.isArray(value)) {

      value.forEach((item, index) => {

         const last =
            index === value.length - 1;

         const branch =
            last ? "└─" : "├─";

         if (
            item !== null &&
            typeof item === "object"
         ) {

            console.log(
               `${prefix}${branch} [${index}]`
            );

            printNested(
               item,
               `${prefix}${last ? "   " : "│  "}`
            );

         } else {

            console.log(
               `${prefix}${branch} [${index}]: ${item}`
            );
         }
      });

      return;
   }


   const entries =
      Object.entries(value ?? {});

   entries.forEach(([key, child], index) => {

      const last =
         index === entries.length - 1;

      const branch =
         last ? "└─" : "├─";

      if (
         child !== null &&
         typeof child === "object"
      ) {

         console.log(
            `${prefix}${branch} ${key}`
         );

         printNested(
            child,
            `${prefix}${last ? "   " : "│  "}`
         );

      } else {

         console.log(
            `${prefix}${branch} ${key}: ${child}`
         );
      }
   });
}


// ═══════════════════════════════════════════
// TOOL CALL
// ═══════════════════════════════════════════

function printToolCall(item) {

   const raw = item.rawItem;

   const name =
      raw?.name ?? "unknown_tool";

   console.log(`\n\n🔧 ${name}`);

   if (!raw?.arguments) {
      return;
   }

   let args;

   try {

      args =
         typeof raw.arguments === "string"
            ? JSON.parse(raw.arguments)
            : raw.arguments;

   } catch {

      console.log(
         `   └─ arguments: ${raw.arguments}`
      );

      return;
   }

   printNested(
      args,
      "   "
   );
}


// ═══════════════════════════════════════════
// TOOL OUTPUT
// ═══════════════════════════════════════════

function printToolOutput(item) {

   const raw = item.rawItem;

   const output =
      raw?.output ??
      raw?.result ??
      null;

   if (
      output === null ||
      output === undefined
   ) {

      console.log(
         "   📤 └─ completed ✓"
      );

      return;
   }

   if (typeof output === "string") {

      const clean =
         output
            .replace(/\s+/g, " ")
            .trim();

      console.log(
         `   📤 └─ ${
            clean.length > 160
               ? clean.slice(0, 160) + "…"
               : clean
         }`
      );

      return;
   }

   console.log(
      "   📤 └─ result"
   );

   printNested(
      output,
      "      "
   );
}


// ═══════════════════════════════════════════
// STREAM AGENT
// ═══════════════════════════════════════════

export async function streamAgent(result) {

   let mode = "idle";


   function enterMode(next) {

      if (mode === next) {
         return;
      }

      mode = next;

      if (next === "reasoning") {
         process.stdout.write("\n\n🧠 ");
      }

      if (next === "message") {
         process.stdout.write("\n\n💬 ");
      }
   }


   for await (const event of result) {

      // ═════════════════════════════════════
      // RAW MODEL STREAM
      // ═════════════════════════════════════

      if (
         event.type ===
         "raw_model_stream_event"
      ) {

         const data =
            event.data;

         /*
          * Provider فعلی:
          *
          * data.type === "model"
          * data.event.choices[0].delta
          */

         if (data?.type !== "model") {
            continue;
         }

         const delta =
            data.event
               ?.choices?.[0]
               ?.delta;

         if (!delta) {
            continue;
         }


         // 🧠 REASONING STREAM
         if (
            typeof delta.reasoning === "string" &&
            delta.reasoning.length > 0
         ) {

            enterMode("reasoning");

            process.stdout.write(
               delta.reasoning
            );

            continue;
         }


         // 💬 ANSWER STREAM
         if (
            typeof delta.content === "string" &&
            delta.content.length > 0
         ) {

            enterMode("message");

            process.stdout.write(
               delta.content
            );

            continue;
         }

         continue;
      }


      // ═════════════════════════════════════
      // RUN ITEM STREAM
      // ═════════════════════════════════════

      if (
         event.type ===
         "run_item_stream_event"
      ) {

         const item =
            event.item;


         // 🔧 TOOL CALL
         if (
            item?.type ===
            "tool_call_item"
         ) {

            mode = "tool";

            printToolCall(item);

            continue;
         }


         // 📤 TOOL OUTPUT
         if (
            item?.type ===
            "tool_call_output_item"
         ) {

            printToolOutput(item);

            continue;
         }


         // 🔀 HANDOFF CALL
         if (
            item?.type ===
            "handoff_call_item"
         ) {

            mode = "handoff";

            console.log(
               "\n\n🔀 Handoff"
            );

            continue;
         }


         // 🔀 HANDOFF OUTPUT
         if (
            item?.type ===
            "handoff_output_item"
         ) {

            console.log(
               "   └─ completed ✓"
            );

            continue;
         }


         // ❌ DO NOT PRINT
         // reasoning_item / message_output_item
         if (
            item?.type ===
               "reasoning_item" ||
            item?.type ===
               "message_output_item"
         ) {
            continue;
         }

         continue;
      }


      // ═════════════════════════════════════
      // AGENT UPDATED
      // ═════════════════════════════════════

      if (
         event.type ===
         "agent_updated_stream_event"
      ) {

         mode = "agent";

         console.log(
            `\n\n🤖 ${
               event.agent?.name ?? "Agent"
            }`
         );

         continue;
      }


      // ═════════════════════════════════════
      // IGNORE OTHER EVENTS
      // ═════════════════════════════════════

      continue;
   }


   // finalResult
   return await result.finalResult;
}