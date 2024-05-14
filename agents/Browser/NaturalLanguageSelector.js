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
    model: "gpt-4o",
    sdk: openai,
    schema,
    prompt,
    state: { scrollComplete: false, itemFound: false, errors: 1 },
    exitConditions: {
      iterations: 10,
      state: (state) => state.scrollComplete || state.itemFound,
    },
    agents: ["ElementSelector"],
    temperature: 1,
  });

  this.scrollUp = async function (data, { state, input }) {
    const result = await driver.scrollUp();
    if (result === "scroll ended") {
      state.scrollComplete = true;
    } else {
      state.screenshot = await driver.getScreenShot();
      state.screenshot_message = `You have scrolled upward on the page. Please use this image continue  your search for the ${input.message}`;
      return result;
    }
  };

  this.scrollDown = async function (data, { state }) {
    const result = await driver.scrollDown();
    if (result === "scroll ended") {
      state.scrollComplete = true;
    } else {
      state.screenshot = await driver.getScreenShot();
      state.screenshot_message = `You have scrolled downward on the page. Please use this image to continue your search for the ${input.message}`;
      return result;
    }
  };
  this.searchContainer = async function (
    { container, searchText },
    { state, input, agents }
  ) {
    const itemSelected = await driver.searchContainer(
      container,
      searchText,
      state.elementType
    );
    if (itemSelected) {
      const { ElementSelector } = agents;
      const image = await driver.captureContainer(container);
      const message = `Is the/a ${input.message} the selected element (surrounded by a green box) in the screenshot?`;
      const results = await ElementSelector.invoke({ image, message });
      console.log("results --->", container, results);
      if (results.elementFound) {
        console.log("setting element found", container);
        state.itemFound = true;
        return "true";
      } else {
        console.log("hiding container", container);

        await driver.hideContainer(container);
        await driver.clearSelection();
        return `Container number ${container} does not contain the ${input.message}. Please search another container.`;
      }
    } else {
      await driver.hideContainer(container);
      return `Container number ${container} does not contain the ${input.message}. Please search another container.`;
    }
  };

  this.after("scrollUp", insertScreenshot);
  this.after("scrollDown", insertScreenshot);
  this.after("searchContainer", insertScreenshot);

  this.before("$invoke", async function ({ input }, next) {
    await driver.setContainers();
    const image = await driver.getScreenShot();
    input.image = image;
    next();
  });
}
