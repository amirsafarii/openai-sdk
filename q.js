import { startTerminal } from "./src/ui/terminal.js";

startTerminal().catch((error) => {
  console.error(error);
  process.exit(1);
});
