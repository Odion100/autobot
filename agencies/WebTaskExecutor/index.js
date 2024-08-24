import Agentci from "agentci";
import agent from "./agent.js";
import ElementIdentifier from "../../agents/ElementIdentifier.js";
import ContainerIdentifier from "../../agents/ContainerIdentifier.js";
import VisualConfirmation from "../../agents/VisualConfirmation.js";
import ElementLocator from "../../agents/ElementLocator.js";
import RefineSearch from "../../agents/RefineSearch.js";

const BrowserAgent = Agentci()
  .rootAgent(agent)
  .agent("ElementIdentifier", ElementIdentifier)
  .agent("ContainerIdentifier", ContainerIdentifier)
  .agent("VisualConfirmation", VisualConfirmation)
  .agent("ElementLocator", ElementLocator)
  .agent("RefineSearch", RefineSearch)
  .config(function () {
    this.use({ exitConditions: { errors: 1 } });
  });
export default BrowserAgent;
