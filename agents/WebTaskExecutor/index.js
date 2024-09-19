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
  promptUser,
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
import { clearPageLoadEvent, resetContainers, setPageLoadEvent } from "./middleware.js";
import ElementIdentifier from "../../modules/ElementIdentifier.js";
import ContainerIdentifier from "../../modules/ContainerIdentifier.js";
import VisualConfirmation from "../../modules/VisualConfirmation.js";
import ElementLocator from "../../modules/ElementLocator.js";
import RefineSearch from "../../modules/RefineSearch.js";
import CompareDescriptions from "../../modules/CompareDescriptions.js";

function WebTaskExecutor() {
  this.use({
    provider: "openai",
    model: "gpt-4o",
    sdk: openai,
    schema,
    prompt,
    exitConditions: {
      functionCall: "promptUser",
      shortCircuit: 2,
      state: (state) => state.abort,
    },
  });

  this.navigate = navigate;
  this.type = type;
  this.click = click;
  this.scrollUp = scrollUp;
  this.scrollDown = scrollDown;
  this.promptUser = promptUser;

  this.after("navigate", getIdentifiedElements, resetContainers);
  this.before("type", checkMemory, selectContainers, searchPage);
  this.before("click", checkMemory, selectContainers, searchPage);
  this.after("click", awaitNavigation, insertScreenshot, resetContainers);
  this.after("type", insertScreenshot, resetContainers);
  this.after("$all", awaitNavigation, insertScreenshot, setIdentifiedElementsPrompt);
  this.before("$invoke", setPageLoadEvent);
  this.after("$invoke", clearPageLoadEvent);
}

export default Agentci()
  .rootAgent(WebTaskExecutor)
  .agent("ElementIdentifier", ElementIdentifier)
  .agent("ContainerIdentifier", ContainerIdentifier)
  .agent("VisualConfirmation", VisualConfirmation)
  .agent("ElementLocator", ElementLocator)
  .agent("RefineSearch", RefineSearch)
  .agent("CompareDescriptions", CompareDescriptions)
  .config(function () {
    this.use({ exitConditions: { errors: 1 } });
  });

// filter out saved identifiers when searching page
// give the agent the ability to update identifiers (fix its mistakes)
// require an extra screenshot confirmation when saving for the first time
