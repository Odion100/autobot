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
  createTable,
  type,
  scrollUp,
  scrollDown,
} from "../../common/methods.js";
import {
  checkMemory,
  selectContainers,
  searchPage,
  awaitNavigation,
  insertScreenshot,
  getDomainMemory,
  setDomainMemoryPrompt,
} from "../../common/middleware/index.js";
import {
  clearContainer,
  clearPageLoadEvent,
  resetContainers,
  setPageLoadEvent,
} from "./middleware.js";
import ElementIdentifier from "../../modules/ElementIdentifier.js";
import ContainerIdentifier from "../../modules/ContainerIdentifier.js";
import VisualConfirmation from "../../modules/VisualConfirmation.js";
import ElementLocator from "../../modules/ElementLocator.js";
import RefineSearch from "../../modules/RefineSearch.js";
import CompareDescriptions from "../../modules/CompareDescriptions.js";
import { EXECUTION_REMINDER } from "../../common/constants.js";
import driver from "../../common/driver/index.js";

function WebAssistant() {
  this.use({
    provider: "openai",
    model: "gpt-4o",
    sdk: openai,
    schema,
    prompt,
    exitConditions: {
      shortCircuit: 1,
      state: (state) => state.abort,
    },
  });

  this.navigate = navigate;
  this.type = type;
  this.click = click;
  this.createTable = createTable;
  this.scrollUp = scrollUp;
  this.scrollDown = scrollDown;
  this.getScreenshot = ({}, { state }) => {
    state.screenshot_message = `This is an image of the page and view port. ${EXECUTION_REMINDER}`;
  };
  async function hideSidePanel({}, next) {
    await driver.hideSidePanel();
    next();
  }
  this.after("navigate", getDomainMemory);
  this.before("type", hideSidePanel, checkMemory, selectContainers, searchPage);
  this.before("click", hideSidePanel, checkMemory, selectContainers, searchPage);
  this.after("click", awaitNavigation, clearContainer);
  this.after("type", clearContainer);
  this.after("getScreenshot", resetContainers, insertScreenshot);
  this.after("$all", awaitNavigation, setDomainMemoryPrompt);
  this.before("$invoke", setPageLoadEvent, getDomainMemory, function ({}, next) {
    state.skipContainerSetup = true;
    next();
  });
  this.after("$invoke", clearPageLoadEvent);
}

export default Agentci()
  .rootAgent(WebAssistant)
  .agent("ElementIdentifier", ElementIdentifier)
  .agent("ContainerIdentifier", ContainerIdentifier)
  .agent("VisualConfirmation", VisualConfirmation)
  .agent("ElementLocator", ElementLocator)
  .agent("RefineSearch", RefineSearch)
  .agent("CompareDescriptions", CompareDescriptions)
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
