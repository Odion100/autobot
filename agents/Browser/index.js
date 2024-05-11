import Agentci from "agentci";
import BrowserController from "./BrowserController.js";
import NaturalLanguageSelector from "./NaturalLanguageSelector.js";
import ElementSelector from "./ElementSelector.js";

const BrowserAgent = Agentci()
  .rootAgent(BrowserController)
  .agent("NaturalLanguageSelector", NaturalLanguageSelector)
  .agent("ElementSelector", ElementSelector)
  .config(function () {
    this.use({ exitConditions: { errors: 1 } });
  });
export default BrowserAgent;
