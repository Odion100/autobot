import Agentci from "agentci";
import OpenAI from "openai";
import dotenv from "dotenv";
dotenv.config();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
import prompt from "./prompt.js";
import schema from "./schema.js";
import {
  click,
  navigate,
  saveContent,
  type,
  scrollUp,
  scrollDown,
  promptUser,
} from "../../common/methods.js";
import {
  checkMemory,
  selectContainers,
  searchPage,
  awaitNavigation,
  insertScreenshot,
} from "../../common/middleware/index.js";
import { clearPageLoadEvent, resetContainers, setPageLoadEvent } from "./middleware.js";
import ElementIdentifier from "../../agents/ElementIdentifier.js";
import ContainerIdentifier from "../../agents/ContainerIdentifier.js";
import VisualConfirmation from "../../agents/VisualConfirmation.js";
import ElementLocator from "../../agents/ElementLocator.js";
import RefineSearch from "../../agents/RefineSearch.js";

function BrowserController() {
  this.use({
    provider: "openai",
    model: "gpt-4o",
    sdk: openai,
    schema,
    prompt,
    exitConditions: {
      functionCall: "promptUser",
      shortCircuit: 3,
      state: (state) => state.abort,
    },
  });

  this.navigate = navigate;
  this.type = type;
  this.click = click;
  this.saveContent = saveContent;
  this.scrollUp = scrollUp;
  this.scrollDown = scrollDown;
  this.promptUser = promptUser;

  this.before("type", checkMemory, selectContainers, searchPage);
  this.before("click", checkMemory, selectContainers, searchPage);
  this.after("click", awaitNavigation, resetContainers);
  this.after("type", resetContainers);
  this.after("$all", awaitNavigation, insertScreenshot);
  this.before("$invoke", setPageLoadEvent);
  this.after("$invoke", clearPageLoadEvent);
}

export default Agentci()
  .rootAgent(BrowserController)
  .agent("ElementIdentifier", ElementIdentifier)
  .agent("ContainerIdentifier", ContainerIdentifier)
  .agent("VisualConfirmation", VisualConfirmation)
  .agent("ElementLocator", ElementLocator)
  .agent("RefineSearch", RefineSearch)
  .config(function () {
    this.use({ exitConditions: { errors: 1 } });
  });

// getDomainMemory and domainMemory functions should be turned into middleware
// move saveIdentifier to (after) middleware
// move driver.setContainers into a middleware that is run after navigate
// driver.clearCache needs to moved to a middleware that runs after navigate
// setting the screenshot needs to be moved to afterware in order to make the common methods more reusable

// create a promptHandler agent that will respond to the users questions and will call a continue function once the inquire/request is complete
// Agentci: create an insertMessage function on the Agent class to insert messages and screenshots after invoking
// - this means the middleware function need to be called with apply
