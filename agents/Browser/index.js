import Agentci from "agentci";
import BrowserController from "./BrowserController.js";
import ElementIdentifier from "./ElementIdentifier.js";
import ElementSelector from "./ElementSelector.js";
import VisualConfirmation from "./VisualConfirmation.js";

const BrowserAgent = Agentci()
  .rootAgent(BrowserController)
  .agent("ElementIdentifier", ElementIdentifier)
  .agent("ElementSelector", ElementSelector)
  .agent("VisualConfirmation", VisualConfirmation)
  .config(function () {
    this.use({ exitConditions: { errors: 1 } });
  });
export default BrowserAgent;
