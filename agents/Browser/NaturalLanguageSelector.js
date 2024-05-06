import OpenAI from "openai";
import schema from "./schemas/BrowserController";
import driver from "./utils/driver";
import prompt from "./prompts/BrowserController";
import dotenv from "dotenv";
import { insertScreenshot } from "./middleware";
dotenv.config();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default function NaturalLanguageSelector() {
  this.use({
    provider: "openai",
    model: "gpt-4-vision-preview",
    sdk: openai,
    schema,
    prompt,
    exitConditions: { iterations: 2, functionCall: "containersFound" },
    agents: ["ElementSelector"],
  });

  this.scrollUp = driver.scrollUp;

  this.scrollDown = driver.scrollDown;

  this.containersFound = async function ({ containers }, { agents, input }) {
    const { ElementSelector } = agents;
    await driver.selectElements(containers);
    const image = driver.getScreenShot();
    return ElementSelector.invoke({
      message: input.message,
      image,
    });
  };

  this.after("scrollUp", insertScreenshot);
  this.after("scrollDown", insertScreenshot);

  this.before("$invoke", async function ({ input }, next) {
    await driver.setContainers();
    const image = driver.getScreenShot();
    input.image = image;
    next();
  });
  this.after("containerFound", function (state, next) {
    driver.clearContainers();
    next();
  });
}
