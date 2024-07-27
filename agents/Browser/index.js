import Agentci from "agentci";
import BrowserController from "./BrowserController.js";
import ElementIdentifier from "./ElementIdentifier.js";
import VisualConfirmation from "./VisualConfirmation.js";
import ElementLocator from "./ElementLocator.js";

const BrowserAgent = Agentci()
  .rootAgent(BrowserController)
  .agent("ElementIdentifier", ElementIdentifier)
  .agent("VisualConfirmation", VisualConfirmation)
  .agent("ElementLocator", ElementLocator)
  .config(function () {
    this.use({ exitConditions: { errors: 1 } });
  });
export default BrowserAgent;
