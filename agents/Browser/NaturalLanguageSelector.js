import OpenAI from "openai";
import schema from "./schemas/NaturalLanguageSelector.js";
import prompt from "./prompts/NaturalLanguageSelector.js";
import driver from "./utils/driver.js";
import { insertScreenshot } from "./middleware.js";
import dotenv from "dotenv";
dotenv.config();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default function NaturalLanguageSelector() {
  this.use({
    provider: "openai",
    model: "gpt-4-turbo",
    sdk: openai,
    schema,
    prompt,
    exitConditions: {
      iterations: 2,
      functionCall: "confirmSelection",
      state: (state) => state.scrollComplete,
    },
    agents: ["ElementSelector"],
    temperature: 0.3,
  });

  this.scrollUp = async function (input, { state }) {
    const result = await driver.scrollUp();
    if (result === "scroll ended") state.scrollComplete = true;
    return result;
  };

  this.scrollDown = async function (input, { state }) {
    const result = await driver.scrollDown();
    if (result === "scroll ended") state.scrollComplete = true;
    return result;
  };
  this.searchContainer = async function ({ container, searchText }, { state, input }) {
    try {
      const itemSelected = await driver.searchContainer(
        container,
        searchText,
        state.elementType
      );
      return itemSelected
        ? `Please analyze and confirm if the correct item was selected. If not search a different container`
        : `${input.message} not found in ${container}`;
    } catch (error) {
      console.log(error);
      return "search error";
    }
  };

  this.confirmSelection = function (data, { input }) {
    return ``;
  };

  this.after("scrollUp", insertScreenshot);
  this.after("scrollDown", insertScreenshot);
  this.after("searchContainer", insertScreenshot);

  this.before("$invoke", async function ({ input }, next) {
    await driver.setContainers();
    const image = await driver.getScreenShot();
    input.image = image;
    input.message = `${input.message}`;
    next();
  });
  this.after("$invoke", function ({ state }, next) {
    state.scrollComplete = false;
    next();
  });
}
