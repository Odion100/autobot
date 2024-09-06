import driver from "./common/driver/index.js";
import WebAssistant from "./agents/WebAssistant/index.js";
import { deleteScreenshots } from "./common/utils/index.js";
import ElementIdentifier from "./modules/ElementIdentifier.js";
import Agentci from "agentci";

driver.init({
  ElementIdentifier: Agentci().rootAgent(ElementIdentifier),
  WebAssistant,
});

driver.navigate("https://egate.smithdrug.com");

deleteScreenshots();
