import { EXECUTION_REMINDER, SEARCH_HELP_MESSAGE } from "./constants.js";
import driver from "./driver/index.js";
import { getDomainMemory, setDomainMemoryPrompt } from "./middleware/index.js";
import { wait } from "./utils/index.js";
import fs from "fs";
export async function navigate({ url }, { state }) {
  let results;
  try {
    results = await driver.navigate(url);
    driver.clearCache();
    state.screenshot_message = `This is an image of the page you have just navigated to. ${EXECUTION_REMINDER}`;
    return `${results}  ${EXECUTION_REMINDER}`;
  } catch (error) {
    console.log("navigation error", error);
    throw error;
  }
}

export async function type(
  { selectedElement, elementName, inputText, identifier },
  { state }
) {
  if (selectedElement) {
    await selectedElement.type(inputText, { delay: 100 });
    driver.saveIdentifier(identifier, selectedElement);
    state.screenshot_message = `The input was found and typed into. ${EXECUTION_REMINDER}`;
    return `The input was found and typed into. ${EXECUTION_REMINDER}`;
  }

  return `The ${elementName} was not successfully selected. ${SEARCH_HELP_MESSAGE}`;
}

export async function click({ selectedElement, elementName, identifier }, { state }) {
  if (selectedElement) {
    try {
      await driver.saveIdentifier(identifier, selectedElement);
      await selectedElement.click();
      await wait(2000);

      state.screenshot_message = `The element was found and clicked. ${EXECUTION_REMINDER}`;
      return `The element was found and clicked. ${EXECUTION_REMINDER}`;
    } catch (error) {
      console.log("selectedElement.click error", error);
      return `There was an error when attempting to click the ${elementName}`;
    }
  }
  return `The ${elementName} was not successfully selected. ${SEARCH_HELP_MESSAGE}`;
}
export async function getScreenshot({}, { state }) {
  state.screenshot_message = `This is an image of the current page and view port. ${EXECUTION_REMINDER}`;
  return "@Browser: inserting screenshot";
}

export async function scrollUp(data, { state }) {
  const scrollPosition = await driver.scrollUp();
  const message = `You have scrolled up to section ${scrollPosition}`;
  state.screenshot_message = message;

  return message;
}

export async function scrollDown(data, { state }) {
  const scrollPosition = await driver.scrollDown();
  const message = `You have scrolled down to section ${scrollPosition}`;
  state.screenshot_message = message;

  return message;
}

export async function promptUser({ text }, { state }) {
  console.log(`\n${text}\n`);

  return text;
}
