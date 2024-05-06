import OpenAI from "openai";
import schema from "./schemas/BrowserController";
import driver from "./utils/driver";
import prompt from "./prompts/BrowserController";
import dotenv from "dotenv";
import { insertScreenshot } from "./middleware";
import htmlVectorSearch from "./utils/htmlVectorSearch";
dotenv.config();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default function ElementSelector() {
  this.use({
    provider: "openai",
    model: "gpt-4-vision-preview",
    sdk: openai,
    schema,
    prompt,
    exitConditions: {
      //state: (state) => state.something === true,
      functionCall: ["itemFound"],
    },
  });

  this.selectElement = async function ({ description }, { state }) {
    const { selectedContainer } = driver.state();
    const html = await driver.getHtml(selectedContainer);
    const [{ selector }] = htmlVectorSearch(html, description, 5, state.targetElements);
    await driver.selectElements(selector);
    return selector;
  };

  this.invalidContainer = function ({ message }) {
    return message;
  };
  this.itemFound = function ({ message }, { state }) {
    return message;
  };
  // this.findGroupSelector = function () {
  //   // if the ai thinks that there is a class of elements
  //   // that match the selection then call this
  // };

  this.after("selectElement", insertScreenshot);
  this.after("findGroupSelector", insertScreenshot);
}
