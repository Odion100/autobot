import { EXECUTION_REMINDER, SEARCH_HELP_MESSAGE } from "./constants.js";
import driver from "./driver/index.js";
import { generateSelectOptionsPrompt, wait } from "./utils/index.js";

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

export async function selectOptionByIndex({ optionIndex }, { state }) {
  const selectedElement = state.selectOptionElement;
  const identifier = state.selectOptionIdentifier;

  try {
    const output = await selectedElement.evaluate((select, idx) => {
      if (idx >= 0 && idx < select.options.length) {
        select.selectedIndex = idx;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
      return false;
    }, optionIndex);
    await driver.saveIdentifier(identifier, selectedElement);
    if (output) return "@internalInstructions: Option selected successfully";
    else return "Browser was unable to select the option from the select element";
  } catch (error) {
    console.error(error);
    return "Error selecting option";
  } finally {
    state.selectOptionElement = undefined;
    state.selectOptionIdentifier = undefined;
  }
}
const getSelectOptions = async (selectedElement) =>
  selectedElement.evaluate((select) => {
    return Array.from(select.options).map((option) => ({
      value: option.value,
      text: option.text,
      selected: option.selected,
    }));
  });

async function handleSelectElement(
  { selectedElement, identifier, selectOption },
  mwData
) {
  const { state } = mwData;
  state.selectOptionElement = selectedElement;
  state.selectOptionIdentifier = identifier;
  await selectedElement.click();
  const options = await getSelectOptions(selectedElement);
  if (selectOption) {
    const optionValue = selectOption.toLowerCase();
    const optionIndex = options.findIndex(
      (option) =>
        option.value.toLowerCase() === optionValue ||
        option.text.toLowerCase() === optionValue
    );
    if (optionIndex !== -1) {
      return selectOptionByIndex({ optionIndex }, mwData);
    }
  }
  const optionsPrompt = generateSelectOptionsPrompt(options);
  return `A dropdown menu has been clicked. @internalInstructions: ${optionsPrompt}`;
}

export async function type(args, mwData) {
  const { selectedElement, elementName, inputText, identifier } = args;
  const { state } = mwData;
  if (selectedElement) {
    // await selectedElement.click({ clickCount: 2 });
    // Type the new text (this will replace the selected text)
    await selectedElement.evaluate((el) => (el.value = "")); // Ensure it's cleared
    await selectedElement.type(inputText, { delay: 100 });
    driver.saveIdentifier(identifier, selectedElement);
    state.screenshot_message = `The input was found and typed into. ${EXECUTION_REMINDER}`;
    return `The input was found and typed into. ${EXECUTION_REMINDER}`;
  }

  return `The ${elementName} was not successfully selected. ${SEARCH_HELP_MESSAGE}`;
}

export async function click(args, mwData) {
  const { selectedElement, elementName, identifier } = args;
  const { state } = mwData;
  if (selectedElement) {
    const tagName = await selectedElement.evaluate((el) => el.tagName.toLowerCase());
    console.log("click tagName", tagName);
    if (tagName === "select") return handleSelectElement(args, mwData);
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
  return "the browser has captured a screenshot";
}

export async function scrollUp(data, { state }) {
  const scrollPosition = await driver.scrollUp();
  const message = `The browser has scrolled up to section ${scrollPosition}`;
  state.screenshot_message = message;

  return message;
}

export async function scrollDown(data, { state }) {
  const scrollPosition = await driver.scrollDown();
  const message = `The browser has scrolled down to section ${scrollPosition}`;
  state.screenshot_message = message;

  return message;
}

export async function promptUser({ text }, { state }) {
  console.log(`\n${text}\n`);

  return text;
}
