import { executionReminder, searchHelpMessage } from "./constants.js";
import driver from "./driver/index.js";
import { domainMemory, getDomainMemory } from "./middleware/utils/index.js";
import { wait } from "./utils/index.js";

export async function navigate({ url }, { state }) {
  let results;
  try {
    results = await driver.navigate(url);
    driver.clearCache();
    await Promise.all([getDomainMemory({ state }), driver.setContainers()]);

    state.screenshot = await driver.getScreenshot();
    state.screenshot_message = `This is an image of the page you have just navigated to. ${executionReminder} ${await domainMemory(
      state
    )}`;

    return `${results}. ${executionReminder} ${await domainMemory(state)}`;
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
    state.screenshot = await driver.getScreenshot();
    state.screenshot_message = `The input was found and typed into. ${executionReminder} ${await domainMemory(
      state
    )}`;
    return `The input was found and typed into. ${executionReminder} ${await domainMemory(
      state
    )}`;
  }

  return `The ${elementName} was not successfully selected. ${searchHelpMessage}`;
}

export async function click({ selectedElement, elementName, identifier }, { state }) {
  if (selectedElement) {
    try {
      await selectedElement.click();
      driver.saveIdentifier(identifier, selectedElement);
      await wait(2000);
      state.screenshot = await driver.getScreenshot();
      state.screenshot_message = `The element was found and clicked. ${executionReminder} ${await domainMemory(
        state
      )}`;
      return `The element was found and clicked. ${executionReminder} ${await domainMemory(
        state
      )}`;
    } catch (error) {
      console.log("selectedElement.click error", error);
      return `There was an error when attempting to click the ${elementName}`;
    }
  }
  return `The ${elementName} was not successfully selected. ${searchHelpMessage}`;
}

export async function saveContent({ content }) {
  console.log("data--->", content);
  return "content saved";
}

export async function scrollUp(data, { state }) {
  const scrollPosition = await driver.scrollUp();
  const message = `You have scrolled up to section ${scrollPosition}`;
  state.screenshot = await driver.getScreenshot();
  state.screenshot_message = message;

  return message;
}

export async function scrollDown(data, { state }) {
  const scrollPosition = await driver.scrollDown();
  const message = `You have scrolled down to section ${scrollPosition}`;

  state.screenshot = await driver.getScreenshot();
  state.screenshot_message = message;

  return message;
}

export async function promptUser({ text }, { state }) {
  console.log(`\n${text}\n`);
  const response = await new Promise((resolve) => {
    state.promptUserCallBack = resolve;
  });
  return response;
}
