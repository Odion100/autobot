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
  type,
  scrollUp,
  scrollDown,
  getScreenshot,
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
  clearContainers,
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
import driver from "../../common/driver/index.js";

function WebAssistant() {
  this.use({
    provider: "openai",
    model: "gpt-4o",
    sdk: openai,
    schema,
    prompt,
    state: { skipContainerSetup: true },
    exitConditions: {
      shortCircuit: 1,
      state: (state) => state.abort,
    },
  });

  this.navigate = navigate;
  this.type = type;
  this.click = click;
  this.scrollUp = scrollUp;
  this.scrollDown = scrollDown;
  this.getScreenshot = getScreenshot;
  this.createJob = function (args) {
    console.log("createJob args", args);
  };
  this.updateJob = function () {
    console.log("updateJob args", args);
  };
  this.executeJob = function () {
    console.log("executeJob args", args);
  };

  async function hideSidePanel({}, next) {
    await driver.hideSidePanel();
    next();
  }
  this.after("navigate", getDomainMemory);

  this.before("click", hideSidePanel, checkMemory, selectContainers, searchPage);
  this.after("click", awaitNavigation, clearContainers);

  this.before("type", hideSidePanel, checkMemory, selectContainers, searchPage);
  this.after("type", clearContainers);

  this.before("getScreenshot", resetContainers);
  this.after("getScreenshot", insertScreenshot, clearContainers);

  this.before("scrollUP", resetContainers);
  this.after("scrollUP", insertScreenshot, clearContainers);

  this.before("scrollDown", resetContainers);
  this.after("scrollDown", insertScreenshot, clearContainers);

  this.after("$all", awaitNavigation, setDomainMemoryPrompt);

  this.before("$invoke", setPageLoadEvent, getDomainMemory);
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

//Improve the webAssistant prompt
//1. The ai should know how to answer what element do you know on this page.
// - Turn domainMemory to identifiedElements everywhere
// - that means domainMemoryId will become elementId
//2. Manual improve the prompt's focus on creating and executing jobs
// - explain that in the intro text (its role and purpose)

//Add the ability to create and edit jobs
//1. create a mongodb collection for jobs
//2. write the methods to create and edit jobs
//3. create a jobs display in the ui
