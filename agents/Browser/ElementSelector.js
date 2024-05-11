import OpenAI from "openai";
import schema from "./schemas/ElementSelector.js";
import prompt from "./prompts/ElementSelector.js";
import driver from "./utils/driver.js";
import { insertScreenshot } from "./middleware.js";
import htmlVectorSearch from "./utils/htmlVectorSearch.js";
import dotenv from "dotenv";
dotenv.config();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
// add filters for target element in vector search
export default function ElementSelector() {
  this.use({
    provider: "openai",
    model: "gpt-4-vision-preview",
    sdk: openai,
    schema,
    prompt,
    exitConditions: {
      iterations: 3,
      functionCall: ["itemFound", "invalidContainer"],
    },
    temperature: 0.1,
  });

  this.selectElement = async function ({ searchText }, { state }) {
    const { selectedContainers } = driver.state();
    const html = await driver.getHtml(selectedContainers[0]);
    const [{ selector }] = await htmlVectorSearch(
      html,
      searchText,
      5,
      state.targetElements
    );
    await driver.selectElements(selector);
    return selector;
  };

  this.invalidContainer = function ({ message }) {
    return message;
  };
  this.itemFound = function ({ message }, { state }) {
    return message;
  };

  this.after("selectElement", insertScreenshot);
  this.after("findGroupSelector", insertScreenshot);
}
