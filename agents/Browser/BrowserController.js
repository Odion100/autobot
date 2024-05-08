import OpenAI from "openai";
import prompt from "./prompts/BrowserController";
import schema from "./schemas/BrowserController";
import driver from "./utils/driver";
import dotenv from "dotenv";
dotenv.config();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default function BrowserController() {
  this.use({
    provider: "openai",
    model: "gpt-3.5-turbo-0125",
    sdk: openai,
    schema,
    prompt,
    state: { driver },
    exitConditions: { iterations: 2, functionCall: "finished" },
    agents: ["NaturalLanguageSelector"],
  });

  this.navigate = async function ({ url }) {
    await driver.navigate(url);
    return driver.state();
  };
  this.findAndType = async function ({ description }, { agents }) {
    const { NaturalLanguageSelector } = agents;
    const selector = await NaturalLanguageSelector.invoke(description);
    return await driver.click(selector);
  };
  this.findAndClick = async function ({ description, text }, { agents }) {
    const { NaturalLanguageSelector } = agents;
    const selector = await NaturalLanguageSelector.invoke(description);
    return await driver.type(selector, text);
  };
  this.findAndSelect = async function ({ description }, { agents }) {
    const { NaturalLanguageSelector } = agents;
    await NaturalLanguageSelector.invoke(description);
  };
  this.findContent = async function ({ description }, { agents }) {
    const { NaturalLanguageSelector } = agents;
    const selectors = await NaturalLanguageSelector.invoke(description);
    return await driver.getInnerText(selectors);
  };
  this.promptUser = function ({ prompt }, { state }) {
    state.userPrompt = prompt;
    return `You've prompted the user this: "${prompt}"`;
  };
  this.after("promptUser", function ({ state }, next) {
    if (state.userPrompt) {
      //prompt the user here
      throw state.userPrompt;
      state.userPrompt = "";
    }
    next();
  });
}
Agentci.invoke("mes");
