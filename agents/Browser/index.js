import Agentci from "agentci";
import BrowserController from "./BrowserController.js";
import ElementIdentifier from "./ElementIdentifier.js";
import ElementIdentifier2 from "./ElementIdentifier2.js";
import ElementSelector from "./ElementSelector.js";
import VisualConfirmation from "./VisualConfirmation.js";
import ElementLocator from "./ElementLocator.js";

const BrowserAgent = Agentci()
  .rootAgent(BrowserController)
  .agent("ElementIdentifier", ElementIdentifier)
  .agent("ElementIdentifier2", ElementIdentifier2)
  .agent("ElementSelector", ElementSelector)
  .agent("VisualConfirmation", VisualConfirmation)
  .agent("ElementLocator", ElementLocator)
  .config(function () {
    this.use({ exitConditions: { errors: 1 } });
  });
export default BrowserAgent;
