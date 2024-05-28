import OpenAI from "openai";
import prompt from "./prompts/BrowserController.js";
import schema from "./schemas/BrowserController.js";
import driver from "./utils/driver.js";
import dotenv from "dotenv";
import { insertScreenshot } from "./middleware.js";
import selectorStore from "./utils/selectorStore.js";
dotenv.config();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
function getSearchText({ elementText, elementName, elementDescription, containerText }) {
  return `${elementName}, ${elementText}, ${containerText}`;
}
function numberList(number) {
  if (number < 1) return "";

  const numbers = [];
  for (let i = 1; i <= number; i++) {
    numbers.push(i);
  }

  if (numbers.length === 1) {
    return numbers[0].toString();
  } else {
    const lastNumber = numbers.pop();
    return numbers.join(", ") + " and " + lastNumber;
  }
}
async function getScreenShots(identifiedElements) {
  const uniqueContainers = [];
  const screenshots = [];
  for (const { containerNumber } of identifiedElements) {
    if (!uniqueContainers.includes(containerNumber)) {
      uniqueContainers.push(containerNumber);
      await driver.hideContainers();
      await driver.showContainers(containerNumber);
      screenshots.push(await driver.captureContainer(containerNumber));
    }
  }
  await driver.hideContainers();
  return screenshots;
}

async function searchPage(ElementIdentifier, searchData) {
  console.log("calling searchPage");
  const query = getSearchText(searchData);
  const identifiedElements = await driver.searchPage(query);
  console.log("identifiedElements", identifiedElements);
  if (!identifiedElements.length) return;
  await driver.hideContainers();
  const fullScreenshot = await driver.getScreenShot();
  console.log("fullScreenshot", fullScreenshot);
  const screenshots = await getScreenShots(identifiedElements);

  console.log("screenshots -->1111", screenshots);
  async function getDescriptions(containerImage) {
    const descriptions = await ElementIdentifier.invoke({
      message: `Please identify the highlighted elements`,
      images: [fullScreenshot, containerImage],
    });
    console.log("getDescriptions", containerImage, descriptions, descriptions.length);
    return descriptions;
    // elementDescriptions.push(...descriptions);
  }
  const descriptionArrays = await Promise.all(
    screenshots.map((image) => getDescriptions(image))
  );
  console.log("descriptionArrays", descriptionArrays);
  const elementDescriptions = descriptionArrays.reduce(
    (acc, descArr) => acc.concat(descArr),
    []
  );
  console.log("elementDescriptions -->1111", elementDescriptions);
  const newIdentifiers = elementDescriptions.map(
    ({ elementNumber, elementDescription: description, elementName: label }) => {
      const { selector, container, type } =
        identifiedElements.find(({ number }) => number === elementNumber) || {};
      console.log("elementNumber", elementNumber, selector, container);
      return { label, selector, description, container, elementNumber, type };
    }
  );
  console.log("newIdentifiers", newIdentifiers);

  //await driver.cacheSelectors(newIdentifiers);
  const { results, distances: dist } = await selectorStore.quickSearch(
    newIdentifiers,
    `${searchData.elementName}: ${searchData.elementDescription}`,
    2
  );
  console.log(
    "search term",
    `${searchData.elementName} ${searchData.elementDescription}`
  );
  console.log("results and dist", results, dist);
  if (results.length) {
    // if (dist[0] <= 0.5)
    return results[0];
  }
}

export default function BrowserController() {
  this.use({
    provider: "openai",
    model: "gpt-4o",
    sdk: openai,
    schema,
    prompt,
    exitConditions: { functionCall: "promptUser", errors: 1, iterations: 4 },
    agents: ["ElementIdentifier"],
  });

  this.navigate = async function ({ url }, { state }) {
    const results = await driver.navigate(url);
    await driver.setContainers();
    state.screenshot = await driver.getScreenShot();
    state.screenshot_message =
      "This is an image of the website you have just navigated to. Use this image to help you accomplish your object.";
    return results;
  };
  this.findAndType = async function (data, { state, agents: { ElementIdentifier } }) {
    // const savedIdentifier = await driver.getSelector(data.elementName, "typeable");
    // if (savedIdentifier) {
    //   const element = await driver.selectElement(savedIdentifier);
    //   if (element) {
    //     await element.type(data.inputText, { delay: 100 });
    //     // state.screenshot = await driver.getScreenShot();
    //     // state.screenshot_message = `Please ensure that the correct item (${data.elementDescription}) was selected (surrounded by a green box) and typed into before proceeding with your next action.`;
    //     return `The ${data.elementDescription} was found.`;
    //   }
    // }
    const newIdentifier = await searchPage(ElementIdentifier, data);

    if (newIdentifier) {
      const element = await driver.selectElement(newIdentifier, true);
      if (element) {
        await element.type(data.inputText, { delay: 100 });
        state.screenshot = await driver.getScreenShot();
        state.screenshot_message = `The ${data.elementName} was found and typed to. Please analyze the screenshot it is as expected`;
        return `The ${data.elementName} was found.`;
      }
    }
    return `The ${data.elementName} was not found.`;
  };

  this.findAndClick = async function (data, { agents: { ElementIdentifier }, state }) {
    // const savedIdentifier = await driver.getSelector(data.elementName, "clickable");
    // if (savedIdentifier) {
    //   const element = await driver.selectElement(savedIdentifier);
    //   if (element) {
    //     await driver.click();
    //     return `The ${data.elementDescription} was clicked.`;
    //   }
    // }
    const newIdentifier = await searchPage(ElementIdentifier, data);
    if (newIdentifier) {
      const element = await driver.selectElement(newIdentifier, true);
      if (element) {
        await element.click(newIdentifier);
        state.screenshot = await driver.getScreenShot();
        state.screenshot_message = `The ${data.elementName} was found and clicked. Please analyze the screenshot it is as expected`;

        return `The ${data.elementName} was clicked.`;
      }
    }
    return `The ${data.elementName} was not found.`;
  };

  this.saveContent = async function ({ content }) {
    console.log("data--->", content);
    return "content saved";
  };

  this.scrollUp = async function (data, { state }) {
    const result = await driver.scrollUp();
    if (result !== "scroll complete") {
      state.screenshot = await driver.getScreenShot();
      state.screenshot_message = result;
      return result;
    }
    return result;
  };

  this.scrollDown = async function (data, { state }) {
    const result = await driver.scrollDown();
    if (result !== "scroll complete") {
      state.screenshot = await driver.getScreenShot();
      state.screenshot_message = result;
      return result;
    }
    return result;
  };

  this.promptUser = async function ({ text }) {
    return text;
  };
  const clearSelectionMW = function ({}, next) {
    driver.clearSelection();
    next();
  };
  this.after("$all", insertScreenshot);
  this.before("findAndType", clearSelectionMW);
  this.before("findAndClick", clearSelectionMW);
  // this.before("$invoke", async function ({ state }, next) {
  //   await driver.navigate("https://google.com");
  //   driver.onPageLoad(async function () {
  //     state.screenshot = await driver.getScreenShot();
  //     state.screenshot_message = `A new page has loaded.`;
  //     console.log("adding screen shot after page load", state.screenshot);
  //   });
  //   next();
  // });
}
