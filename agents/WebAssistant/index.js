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
  selectOptionByIndex,
} from "../../common/methods.js";
import {
  checkMemory,
  selectContainers,
  searchPage,
  awaitNavigation,
  insertScreenshot,
  getIdentifiedElements,
  setIdentifiedElementsPrompt,
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
import { createJob, deleteJob, getJob, updateJob } from "./methods.js";

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
  this.selectOption = selectOptionByIndex;
  this.createJob = createJob;
  this.getJob = getJob;
  this.updateJob = updateJob;
  this.deleteJob = deleteJob;
  this.executeJob = function (args) {
    console.log("executeJob args", args);
  };

  async function hideSidePanel({}, next) {
    await driver.hideSidePanel();
    next();
  }
  this.after("navigate", getIdentifiedElements);

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

  this.before("$all", setIdentifiedElementsPrompt);
  this.after("$all", awaitNavigation);

  this.before("$invoke", setPageLoadEvent, getIdentifiedElements);
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
