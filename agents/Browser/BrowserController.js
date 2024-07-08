import OpenAI from "openai";
import prompt from "./prompts/BrowserController.js";
import schema from "./schemas/BrowserController.js";
import driver from "./utils/driver.js";
import dotenv from "dotenv";
import { insertScreenshot } from "./middleware.js";
import selectorStore from "./utils/selectorStore.js";
const wait = (timeout = 0) =>
  new Promise((resolve) => setTimeout(() => resolve(new Date()), timeout));

dotenv.config();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function getScreenShots(identifiedElements, containerOnly) {
  const uniqueContainers = [];
  const screenshots = [];
  for (const { containerNumber } of identifiedElements) {
    if (!uniqueContainers.includes(containerNumber)) {
      uniqueContainers.push(containerNumber);
      await driver.hideContainers();
      await driver.showContainers(containerNumber);
      screenshots.push(await driver.captureContainer(containerNumber, containerOnly));
    }
  }
  //await driver.hideContainers();
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
    .reduce((acc, { elementNumber, elementPurpose: description, elementName: label }) => {
      const { selector, container, type } =
        identifiedElements.find(({ number }) => number === elementNumber) || {};
      console.log("elementNumber", elementNumber, selector, container);

      if (selector)
        acc.push({ label, selector, description, container, elementNumber, type });
      return acc;
    }, []);
  await driver.cacheSelectors(elementDescriptions);
  return await selectorStore.quickSearch(
    elementDescriptions,
    `${args.elementName}: ${args.elementPurpose}`,
    2,
    { type }
  );
}
async function searchDescription2(
  identifiedElements,
  fullScreenshot,
  type,
  { args, agents }
) {
  const { ElementIdentifier2 } = agents;
  console.log("fullScreenshot", fullScreenshot);
  const screenshots = await getScreenShots(identifiedElements);

  console.log("screenshots -->1111", screenshots);
  async function describeElements(containerImage) {
    const description = await ElementIdentifier2.invoke({
      message: `Please identify the ${args.elementName}, ${args.elementPurpose}`,
      images: [fullScreenshot, containerImage],
    });
    console.log("describeElement2", containerImage, description);
    return description;
    // elementDescriptions.push(...descriptions);
  }
  const combinedDescriptions = await Promise.all(
    screenshots.map((image) => describeElements(image))
  );

  console.log("combinedDescriptions", combinedDescriptions);
  const elementDescriptions = combinedDescriptions
    .reduce((acc, results) => acc.concat(results), [])
    .reduce((acc, { elementNumber, elementPurpose: description, elementName: label }) => {
      const { selector, container, type } =
        identifiedElements.find(({ number }) => number === elementNumber) || {};
      console.log("elementNumber", elementNumber, selector, container);

      if (selector)
        acc.push({ label, selector, description, container, elementNumber, type });
      return acc;
    }, []);
  if (!elementDescriptions.length) return { results: [], distances: [] };
  await driver.cacheSelectors(elementDescriptions);
  return await selectorStore.quickSearch(
    elementDescriptions,
    `${args.elementName}: ${args.elementPurpose}`,
    1,
    { type }
  );
}
async function evaluateSelection(newIdentifiers, distances, { args, agents, state }) {
  const { VisualConfirmation } = agents;
  for (const i in newIdentifiers) {
    const identifier = newIdentifiers[i];
    const dist = distances[i];
    if (dist < 0.35) {
      const element = await driver.selectElement(identifier, true);
      if (element) return element;
    }

    if (dist < 0.4 && dist) {
      const element = await driver.selectElement(identifier, true);
      if (element) {
        const image = identifier.container
          ? await driver.captureElement(identifier.container)
          : await driver.getScreenShot();
        const elementMatched = await VisualConfirmation.invoke(
          {
            message: `Is the correct element selected (surrounded by a green box) in the screenshot?`,
            image,
            ...args,
          },
          { messages: [...state.messages] }
        );
        console.log("elementMatched", elementMatched);
        if (elementMatched) {
          return element;
        }
      }
    }
  }
}

//evaluate containers
// add abort state to exit loop from command line
// Plan off of full page
// scroll to any position
async function compareContainers(containers, { args, agents, state }) {
  const { VisualConfirmation } = agents;
  const fullScreenshot = await driver.getScreenShot();
  await Promise.all(containers.map((identifier) => driver.selectContainer(identifier)));
  const screenshots = await getScreenShots(containers, true);
  const filteredContainers = [];
  console.log("screenshots -->2222", screenshots, fullScreenshot);
  async function getConfirmation(containerImage, container) {
    const isCorrectContainer = await VisualConfirmation.invoke(
      {
        message: `Is the selected container in this image the ${args.containerDescription}. Please carefully analyze the container text and description to see if it matches.`,
        images: [fullScreenshot, containerImage],
        ...args,
      },
      { messages: [...state.messages] }
    );
    console.log("getConfirmation", containerImage, isCorrectContainer);
    if (isCorrectContainer) filteredContainers.push(container);
  }
  await Promise.all(
    screenshots.map((image, index) => getConfirmation(image, containers[index]))
  );
  console.log("filteredContainers -->2222", filteredContainers);
  driver.clearSelection();
  return filteredContainers;
}
async function searchPage(mwData, next) {
  const { args, agents, state, exit, fn } = mwData;
  const { innerText, elementName, containerText } = args;
  if (state.navigationStarted) return next();
  if (args.selectedElement) return next();
  let targetContainers;
  if (containerText) {
    const { results, distances } = await driver.findContainers(
      `${containerText}, ${innerText}`
    );
    if (distances[0] <= 0.3 && distances[1] > 0.3) {
      targetContainers = [results[0]];
    } else if (distances[0] <= 0.35) {
      targetContainers = results.filter(
        (item, index) => distances[index] <= distances[0] + 0.05
      );
      if (targetContainers.length > 1)
        targetContainers = await compareContainers(targetContainers, mwData);

      if (!targetContainers.length || targetContainers.length > 1) {
        targetContainers = [results[0]];
      }
      await driver.scrollIntoView(targetContainers[0].selector);
    } else {
      targetContainers = results;
    }
  }
  const identifiedElements = await driver.searchPage(
    `${elementName}, ${innerText}`,
    targetContainers
  );
  if (identifiedElements.length) {
    await driver.hideContainers();
    const fullScreenshot = await driver.getScreenShot();
    const elementType = fn === "findAndType" ? "typeable" : "clickable";
    const { results, distances } = await searchDescription2(
      identifiedElements,
      fullScreenshot,
      elementType,
      mwData
    );
    await driver.hideContainers();
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
  next();
}

async function checkMemory(mwData, next) {
  const { fn, args } = mwData;
  const filter = {
    type: fn === "findAndType" ? "typeable" : "clickable",
  };

  // const { results: savedIdentifiers, distances: dist } = await driver.getSelector(
  //   `${args.elementName}: ${args.elementPurpose}`,
  //   filter
  // );

  // console.log("savedIdentifiers, distances", savedIdentifiers, dist);
  // if (savedIdentifiers.length) {
  //   const selectedElement = await evaluateSelection(savedIdentifiers, dist, mwData);
  //   if (selectedElement) {
  //     args.selectedElement = selectedElement;
  //     return next();
  //   }
  // }

  const { results: cachedIdentifiers, distances } = await driver.checkCache(
    `${args.elementName}: ${args.elementPurpose}`,
    filter
  );
  console.log("cachedIdentifiers, distances", cachedIdentifiers, distances);

  if (cachedIdentifiers.length) {
    const filteredIdentifiers = await driver.viewFilter(cachedIdentifiers);
    const selectedElement = await evaluateSelection(
      filteredIdentifiers,
      distances,
      mwData
    );
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
    exitConditions: {
      functionCall: "promptUser",
      shortCircuit: 3,
      state: (state) => state.abort,
    },
    agents: [
      "ElementIdentifier",
      "ElementIdentifier2",
      "VisualConfirmation",
      "ElementLocator",
    ],
  });

  this.navigate = async function ({ url }, { state, agents }) {
    const results = await driver.navigate(url);
    await driver.setContainers();
    state.screenshot = await driver.getScreenShot();
    state.screenshot_message =
      "This is an image of the website you have just navigated to. Use this image to help you accomplish your object.";
    //await getElementLocations({ state, agents });
    return results;
  };
  this.findAndType = async function (
    { selectedElement, elementName, inputText, wrongPageMessage = "" },
    { state }
  ) {
    if (selectedElement) {
      await selectedElement.type(inputText, { delay: 100 });
      state.screenshot = await driver.getScreenShot();
      state.screenshot_message = `The ${elementName} was found and typed to. Please analyze the screenshot it is as expected`;
      return `The ${elementName} was found. ${wrongPageMessage}`;
    }
    // You are in section ${currentSection} with section 1 being at the top of the page

    return `The ${elementName} was not found.`;
  };

  this.findAndClick = async function (
    { selectedElement, elementName, wrongPageMessage = "" },
    { state }
  ) {
    if (selectedElement) {
      try {
        await selectedElement.click();
      } catch (error) {
        console.log("selectedElement.click error", error);
        await driver.click();
        await wait(1000);
      }
      state.screenshot = await driver.getScreenShot();
      state.screenshot_message = `The ${elementName} was found and clicked.`;
    }
    return `The ${elementName} was not found. ${wrongPageMessage}`;
  };

  this.saveContent = async function ({ content }) {
    console.log("data--->", content);
    return "content saved";
  };

  this.scrollUp = async function (data, { state }) {
    const scrollPosition = await driver.scrollUp();
    const message = `You have scrolled up to section ${scrollPosition}`;
    state.screenshot = await driver.getScreenShot();
    state.screenshot_message = message;

    return message;
  };

  this.scrollDown = async function (data, { state }) {
    const scrollPosition = await driver.scrollDown();
    const message = `You have scrolled down to section ${scrollPosition}`;

    state.screenshot = await driver.getScreenShot();
    state.screenshot_message = message;

    return message;
  };

  this.promptUser = async function ({ text }) {
    return text;
  };
  const clearSelectionMW = async function ({}, next) {
    await driver.clearContainers();
    await driver.setContainers();
    await driver.clearSelection();
    next();
  };
  async function getElementLocations(mwData, next) {
    const {
      state,
      agents: { ElementLocator },
      args,
    } = mwData;
    console.log("getElementLocations-->", args.selectedElement);
    if (!args.selectedElement) {
      await driver.hideContainers();
      const { totalSections } = await driver.setupSections();
      console.log("totalSections2-->", totalSections);
      if (totalSections > 1) {
        const fullPage = await driver.getScreenShot(true);
        await driver.clearSections();
        const currentSection = await driver.getCurrentSection();
        const { sectionNumber, reasoning } = await ElementLocator.invoke({
          message: `We are currently in section ${currentSection} of the web page. Please locate the section of the element we are looking for based on the follow search criteria: 
            - Element Name: ${args.elementName}.
            - Element Purpose: ${args.elementName}
            - Element Description: ${args.elementName}
            - Element InnerText: ${args.elementName}
            - Container Text: ${args.elementName}
            - Container Description: ${args.elementName}`,
          image: fullPage,
        });
        console.log("sectionNumber, reasoning", sectionNumber, reasoning);
        if (sectionNumber) {
          await driver.goToSection(sectionNumber);
          return searchPage(mwData, next);
        } else {
          args.wrongPageMessage = reasoning;
        }
      } else {
        await driver.clearSections();
      }
    }
    next();
  }
  this.before(
    "findAndType",
    clearSelectionMW,
    checkMemory,
    searchPage,
    getElementLocations
  );
  this.before(
    "findAndClick",
    clearSelectionMW,
    checkMemory,
    searchPage,
    getElementLocations
  );

  //this.before("$invoke", insertScreenshot);
  this.after("$all", async function ({ state, agents }, next) {
    // console.log("state.navigationStarted", state.navigationStarted);
    if (state.navigationStarted) {
      while (state.navigationStarted) {
        console.log("waiting for page to load...");
        await wait(500);
      }
      console.log("page load is now complete");
      //    await getElementLocations({ state, agents });
      const page = driver.page();
      await driver.clearSections();
      await driver.setContainers();
      state.screenshot = await driver.getScreenShot();
      state.screenshot_message = `You have navigated to a new page: ${page.url()}`;
      next();
    } else next();
  });
  this.after("$all", insertScreenshot);
  this.before("$invoke", async function ({ state }, next) {
    const page = driver.page();
    state.currentSection = 0;
    state.totalSections = 0;
    state.pageLoadStart = (request) => {
      //console.log("state.navigationStarted, pageLoadStart", state.navigationStarted);
      if (
        !state.navigationStarted &&
        request.isNavigationRequest() &&
        request.frame() === page.mainFrame() &&
        request.url() !== "about:blank"
      ) {
        state.navigationStarted = true;
        console.log(`Page is starting to load: ${request.url()}`);
      }
    };
    state.pageLoadEnd = async () => {
      console.log("Page has finished loading");
      state.navigationStarted = false;
    };
    page.on("request", state.pageLoadStart);
    page.on("load", state.pageLoadEnd);
    next();
  });

  this.after("$invoke", function ({ state }, next) {
    const page = driver.page();
    page.on("load", state.pageLoadEnd);
    page.off("request", state.pageLoadStart);
    next();
  });
}

// fix position-fixed containers
// maybe search the containers for any element that is position fixed
// -- because anything that is position-fixed is in view
// turn caching back on and filter out any element not in view
// do visual confirmation when using cached memory
// update compare containers to choose between the containers instead of doing a visual confirmation
// on ebay when you click a list a pop shows up figure that out
// on home depot the Navbar container is being skipped
//add a $all middleware to check for consecutive non function calls and then tell the ai to prompt the user for help or if the task is complete
