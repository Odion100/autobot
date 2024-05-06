import Agentci from "agentci";
import BrowserController from "./BrowserController";
import NaturalLanguageSelector from "./NaturalLanguageSelector";
import ElementSelector from "./ElementSelector";

const BrowserAgent = Agentci()
  .rootAgent(BrowserController)
  .agent("NaturalLanguageSelector", NaturalLanguageSelector)
  .agent("ElementSelector", ElementSelector);
// .config(function () {
//   this.before("$invoke", () => {
//     //log
//   });
//   this.after("$all", () => {
//     //log
//   });
// });
export default BrowserAgent;
