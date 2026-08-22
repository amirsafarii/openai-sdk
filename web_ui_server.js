import { startWebServer } from "./src/ui/web-server.js";

const host = "0.0.0.0";
const port = Number(process.env.PORT || 3000);

const { server } = await startWebServer({ host, port });
const address = server.address();
console.log(`Web UI: http://${host}:${address.port}`);
