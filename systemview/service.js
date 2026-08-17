// SystemLynx service that connects autobot to the SystemView hub.
// Run from the repo root: `npm run hub` (SystemView must be running — see SYSTEMVIEW_HOST).
import "dotenv/config";
import { App } from "systemlynx";
import SystemViewPlugin from "systemview-plugin";
import Autobot from "./modules/Autobot.js";

const route = "autobot/api";
const port = process.env.AUTOBOT_SERVICE_PORT || 6100;
const connection = process.env.SYSTEMVIEW_HOST || "http://localhost:3000/systemview/api";

App.startService({ route, port }).module("Autobot", Autobot);

App.use(
  SystemViewPlugin({
    connection,
    specs: "./specs",
    projectCode: "autobot",
    serviceId: "Autobot",
  })
);

console.log(`[autobot] SystemLynx service on :${port}/${route} → hub at ${connection}`);
