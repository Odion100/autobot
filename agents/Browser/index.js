import Agentci from "agentci";
import BrowserController from "./BrowserController";
import NaturalLanguageSelector from "./NaturalLanguageSelector";
import ElementSelector from "./ElementSelector";

const BrowserAgent = Agentci()
  .rootAgent(BrowserController)
  .agent("NaturalLanguageSelector", NaturalLanguageSelector)
  .agent("ElementSelector", ElementSelector);

export default BrowserAgent;
