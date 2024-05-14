import OpenAI from "openai";
import prompt from "./prompts/BrowserController.js";
import schema from "./schemas/BrowserController.js";
import driver from "./utils/driver.js";
import dotenv from "dotenv";
import { insertScreenshot } from "./middleware.js";
dotenv.config();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default function BrowserController() {
  this.use({
    provider: "openai",
    model: "gpt-4-turbo",
    sdk: openai,
    schema,
    prompt,
    state: { driver },
    exitConditions: { shortCircuit: true, functionCall: "promptUser", errors: 1 },
    agents: ["NaturalLanguageSelector"],
  });

  this.click = driver.click;
  this.type = driver.type;
  this.getText = driver.getInnerText;
  this.navigate = async function ({ url }, { state }) {
    const results = await driver.navigate(url);
    state.screenshot = await driver.getScreenShot();
    state.screenshot_message =
      "This is an image of the website you have just navigated to. Use this image to help you accomplish your object.";
    return results;
  };
  this.findAndType = async function ({ description, text }, { agents, state }) {
    const { NaturalLanguageSelector } = agents;
    const elementFound = await NaturalLanguageSelector.invoke(description, {
      elementType: "typeable",
    });
    if (elementFound) {
      await driver.type(undefined, text);
      state.screenshot = await driver.getScreenShot();
      state.screenshot_message = `Please ensure that the correct item (${description}) was selected (surrounded by a green box) and typed into before proceeding with your next action.`;
    } else {
      return `The ${description} was not found.`;
    }
  };
  this.findAndClick = async function ({ description }, { agents }) {
    const { NaturalLanguageSelector } = agents;
    const elementFound = await NaturalLanguageSelector.invoke(description, {
      elementType: "clickable",
    });
    if (elementFound) {
      await driver.click();
      return "An item was found and clicked";
    } else {
      return `The ${description} was not found.`;
    }
  };
  this.findAndSelect = async function ({ description }, { agents, state }) {
    const { NaturalLanguageSelector } = agents;
    const elementFound = await NaturalLanguageSelector.invoke(description);

    if (elementFound) {
      await driver.type(undefined, text);
      state.screenshot = await driver.getScreenShot();
      state.screenshot_message = `Please ensure that the correct item (the ${description}) was selected (surrounded by a green box).`;
    } else {
      return `The ${description} was not found.`;
    }
  };
  this.findContent = async function ({ description }, { agents }) {
    const { NaturalLanguageSelector } = agents;
    const elementFound = await NaturalLanguageSelector.invoke(description);
    if (elementFound) return await driver.getInnerText(selectors);
    else return `The ${description} was not found.`;
  };
  this.promptUser = async function ({ text }, { state }) {
    return text;
  };
  this.after("$all", insertScreenshot);
}
