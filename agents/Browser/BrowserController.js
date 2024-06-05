import OpenAI from "openai";
import prompt from "./prompts/BrowserController.js";
import schema from "./schemas/BrowserController.js";
import driver from "./utils/driver.js";
import dotenv from "dotenv";
import { insertScreenshot } from "./middleware.js";
import selectorStore from "./utils/selectorStore.js";
dotenv.config();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

async function searchDescriptions(
  identifiedElements,
  fullScreenshot,
  type,
  { args, agents }
) {
  const { ElementIdentifier } = agents;
  console.log("fullScreenshot", fullScreenshot);
  const screenshots = await getScreenShots(identifiedElements);

  console.log("screenshots -->1111", screenshots);
  async function describeElements(containerImage) {
    const descriptions = await ElementIdentifier.invoke({
      message: `Please identify the highlighted elements`,
      images: [fullScreenshot, containerImage],
    });
    console.log("describeElements", containerImage, descriptions);
    return descriptions;
    // elementDescriptions.push(...descriptions);
  }
  const combinedDescriptions = await Promise.all(
    screenshots.map((image) => describeElements(image))
  );
  console.log("combinedDescriptions", combinedDescriptions);
  const elementDescriptions = combinedDescriptions
    .reduce((acc, results) => acc.concat(results), [])
    .reduce(
      (acc, { elementNumber, elementDescription: description, elementName: label }) => {
        const { selector, container, type } =
          identifiedElements.find(({ number }) => number === elementNumber) || {};
        console.log("elementNumber", elementNumber, selector, container);

        if (selector)
          acc.push({ label, selector, description, container, elementNumber, type });
        return acc;
      },
      []
    );
  await driver.cacheSelectors(elementDescriptions);
  return await selectorStore.quickSearch(
    elementDescriptions,
    `${args.elementName}: ${args.elementDescription}`,
    2,
    { type }
  );
}
async function evaluateSelection(newIdentifiers, distances, { args, agents }) {
  const { VisualConfirmation } = agents;
  for (const i in newIdentifiers) {
    const identifier = newIdentifiers[i];
    const dist = distances[i];
    if (dist < 0.35) return await driver.selectElement(identifier, true);

    if (dist < 0.4 && dist) {
      const image = await driver.captureElement(identifier.container);
      const elementFound = await VisualConfirmation.invoke({
        message: `Is the/a ${args.elementName} the selected element (surrounded by a green box) in the screenshot?`,
        image,
      });
      console.log("elementFound", elementFound);
      if (elementFound) return await driver.selectElement(identifier, true);
    }
  }
}
async function searchPage(mwData, next) {
  const { args, agents, state, exit, fn } = mwData;
  const { innerText, elementName, containerText } = args;

  if (args.selectedElement) return next();
  let targetContainer;
  if (containerText)
    targetContainer = await driver.findContainers(`${containerText}, ${innerText}`);
  const identifiedElements = await driver.searchPage(
    `${elementName}, ${innerText}`,
    targetContainer
  );
  if (identifiedElements.length) {
    await driver.hideContainers();
    const fullScreenshot = await driver.getScreenShot();
    const elementType = fn === "findAndType" ? "typeable" : "clickable";
    const { results, distances } = await searchDescriptions(
      identifiedElements,
      fullScreenshot,
      elementType,
      mwData
    );
    console.log("results, distances", results, distances);
    if (results.length) {
      const selectedElement = await evaluateSelection(results, distances, mwData);
      console.log("selectedElement-->", selectedElement);
      if (selectedElement) {
        args.selectedElement = selectedElement;
        return next();
      }
    }
  }
  if (exit) return next();
  const { ElementSelector } = agents;

  await driver.clearLabels();
  await driver.showContainers();
  const image = await driver.getScreenShot();

  const searchData = await ElementSelector.invoke(
    {
      message:
        "Please use this screenshot to analyze and select the target element. Please capture as much containerText as possible",
      image,
      ...args,
    },
    { messages: [...state.messages] }
  );
  console.log("new searchData", searchData);
  Object.assign(args, searchData);
  searchPage({ ...mwData, exit: true }, next);
}

async function checkMemory(mwData, next) {
  const { fn, args } = mwData;
  const filter = {
    type: fn === "findAndType" ? "typeable" : "clickable",
  };

  const { results: savedIdentifiers, distances: dist } = await driver.getSelector(
    `${args.elementName}: ${args.elementDescription}`,
    filter
  );

  console.log("savedIdentifiers, distances", savedIdentifiers, dist);
  if (savedIdentifiers.length) {
    const selectedElement = await evaluateSelection(savedIdentifiers, dist, mwData);
    if (selectedElement) {
      args.selectedElement = selectedElement;
      return next();
    }
  }

  const { results: cachedIdentifiers, distances } = await driver.checkCache(
    `${args.elementName}: ${args.elementDescription}`,
    filter
  );
  console.log("cachedIdentifiers, distances", cachedIdentifiers, distances);

  if (cachedIdentifiers.length) {
    const selectedElement = await evaluateSelection(cachedIdentifiers, distances, mwData);
    if (selectedElement) {
      args.selectedElement = selectedElement;
      return next();
    }
  }

  next();
}
export default function BrowserController() {
  this.use({
    provider: "openai",
    model: "gpt-4o",
    sdk: openai,
    schema,
    prompt,
    exitConditions: { functionCall: "promptUser", iterations: 4 },
    agents: ["ElementIdentifier", "ElementSelector", "VisualConfirmation"],
  });

  this.navigate = async function ({ url }, { state }) {
    const results = await driver.navigate(url);
    await driver.setContainers();
    state.screenshot = await driver.getScreenShot();
    state.screenshot_message =
      "This is an image of the website you have just navigated to. Use this image to help you accomplish your object.";
    return results;
  };
  this.findAndType = async function (
    { selectedElement, elementName, inputText },
    { state }
  ) {
    if (selectedElement) {
      await selectedElement.type(inputText, { delay: 100 });
      state.screenshot = await driver.getScreenShot();
      state.screenshot_message = `The ${elementName} was found and typed to. Please analyze the screenshot it is as expected`;
      return `The ${elementName} was found.`;
    }

    return `The ${elementName} was not found.`;
  };

  this.findAndClick = async function ({ selectedElement, elementName }, { state }) {
    if (selectedElement) {
      try {
        await selectedElement.click();
      } catch (error) {
        console.log("selectedElement.click error", error);
        await driver.click();
      }
      state.screenshot = await driver.getScreenShot();
      state.screenshot_message = `The ${elementName} was found and clicked. Please analyze the screenshot it is as expected`;
      return `The ${elementName} was clicked.`;
    }
    return `The ${elementName} was not found.`;
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
  this.before("findAndType", clearSelectionMW, checkMemory, searchPage);
  this.before("findAndClick", clearSelectionMW, checkMemory, searchPage);
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
