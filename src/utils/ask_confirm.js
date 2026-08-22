import { select, confirm, input } from "@inquirer/prompts";

export async function askSelect(message, choices) {
   return await select({
      message,
      choices
   });
}

export async function askConfirm(message) {
   return await confirm({
      message,
      default: false
   });
}

export async function askInput(message, defaultValue = "") {
   return await input({
      message,
      default: defaultValue
   });
}
