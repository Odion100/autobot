import OpenAI from "openai";
import prompt from "./prompts/BrowserController.js";
import schema from "./schemas/BrowserController.js";
import driver from "./utils/driver.js";
import dotenv from "dotenv";
import { insertScreenshot } from "./middleware.js";
import selectorStore from "./utils/selectorStore.js";
import uniqueId from "./utils/uniqueId.js";
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
      screenshots.push({
        containerNumber,
        screenshot: await driver.captureContainer(containerNumber, containerOnly),
      });
    }
  }
  //await driver.hideContainers();
  return screenshots;
}
function cacheSelectors(identifiers) {
  const staticIdentifiers = identifiers.filter(
    ({ positionRefresh }) => positionRefresh === "static"
  );
  if (staticIdentifiers.length) {
    driver.cacheSelectors(identifiers);
  }
}
async function searchDescription2(
  targetElements,
  fullScreenshot,
  type,
  { args, agents }
) {
  const { ElementIdentifier } = agents;
  console.log("fullScreenshot", fullScreenshot);
  const screenshots = await getScreenShots(targetElements);

  console.log("screenshots -->1111", screenshots);
  async function describeElements(containerImage, containerNumber) {
    const elementNumbers = targetElements
      .filter((item) => item.containerNumber === containerNumber)
      .map(({ elementNumber }) => elementNumber)
      .join(", ");
    const message = `Please identify the highlighted elements of the following number(s): ${elementNumbers}. If you do not see a highlighted element matching a given number, please skip it or provide elementNumber = 0 in your response.`;
    const description = await ElementIdentifier.invoke({
      message,
      images: [fullScreenshot, containerImage],
      ...args,
    });
    console.log("describeElement2", containerImage, description);
    return description;
    // elementDescriptions.push(...descriptions);
  }
  const identifiedContainers = await Promise.all(
    screenshots.map(({ screenshot, containerNumber }) =>
      describeElements(screenshot, containerNumber)
    )
  );
  console.log("identifiedContainers", identifiedContainers);
  let fullMatch;

  const elementDescriptions = [];
  for (const identifiedContainer of identifiedContainers) {
    for (const identifier of identifiedContainer.identifiedElements) {
      const { selector, container, type } =
        targetElements.find(({ number }) => number === identifier.elementNumber) || {};

      if (selector) {
        identifier.selector = selector;
        identifier.container = container;
        identifier.type = type;
        identifier.containerName = identifiedContainer.containerName;
        identifier.containerFunctionality = identifiedContainer.containerFunctionality;
        identifier.positionRefresh = identifiedContainer.positionRefresh;
        identifier.usage = 0;
        elementDescriptions.push(identifier);
        if (identifier.matchesCriteria === "full-match") fullMatch = identifier;
      }
    }
  }
  cacheSelectors(elementDescriptions);

  if (fullMatch) return { results: [fullMatch], distances: [0.2] };
  if (!elementDescriptions.length) return { results: [], distances: [] };
  const filteredElements = elementDescriptions.filter(
    ({ matchesCriteria }) => matchesCriteria !== "no-match"
  );
  console.log("filteredElements xx-->>", filteredElements);
  if (!filteredElements.length) return { results: [], distances: [] };

  return await multiParameterSearch(filteredElements, args, { type });
}
async function evaluateSelection(newIdentifiers, distances, { args, agents, state }) {
  const { VisualConfirmation } = agents;
  for (const i in newIdentifiers) {
    const identifier = newIdentifiers[i];
    const dist = distances[i];
    if (dist < 0.34) {
      const element = await driver.selectElement(identifier);
      if (element) {
        args.identifier = identifier;
        return element;
      }
    }

    if (dist < 0.4 && dist) {
      const element = await driver.selectElement(identifier);
      if (element) {
        const image = identifier.container
          ? await driver.captureElement(identifier.container)
          : await driver.getScreenShot();
        const elementMatched = await VisualConfirmation.invoke({
          message: `Is the correct element selected (surrounded by a green box) in the screenshot?`,
          image,
          ...args,
        });
        console.log("elementMatched", elementMatched);
        if (elementMatched) {
          args.identifier = identifier;
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
    const isCorrectContainer = await VisualConfirmation.invoke({
      message: `Is the selected container in this image the ${args.containerName}, ${args.containerFunctionality}. Please carefully analyze the container text and description to see if it matches.`,
      images: [fullScreenshot, containerImage],
      ...args,
    });
    console.log("getConfirmation", containerImage, isCorrectContainer);
    if (isCorrectContainer) filteredContainers.push(container);
  }
  await Promise.all(
    screenshots.map(({ screenshot }, index) =>
      getConfirmation(screenshot, containers[index])
    )
  );
  console.log("filteredContainers -->2222", filteredContainers);
  driver.clearSelection();
  return filteredContainers;
}
async function searchPage(mwData, next) {
  const { args, state, fn } = mwData;
  const { innerText, elementName } = args;
  if (state.navigationStarted) return next();
  if (args.selectedElement) return next();

  const identifiedElements = await driver.searchPage(
    `${elementName}, ${innerText}`,
    args.targetContainers
  );
  if (identifiedElements.length) {
    await driver.hideContainers();
    const fullScreenshot = await driver.getScreenShot();
    const elementType = fn === "type" ? "typeable" : "clickable";
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
async function selectContainers(mwData, next) {
  const { args } = mwData;
  const { innerText, containerText, containerName } = args;
  if (containerName) {
    const identifiers = await driver.getSelectors({ containerName });
    if (identifiers.length) {
      args.targetContainers = [driver.addContainer(identifiers[0].container)];
    }
  }

  if (!args.targetContainers && containerText) {
    const { results, distances } = await driver.findContainers(
      `${containerText}, ${innerText}`
    );
    if (distances[0] <= 0.3 && distances[1] > 0.3) {
      args.targetContainers = [results[0]];
    } else if (distances[0] <= 0.35) {
      args.targetContainers = results.filter(
        (item, index) => distances[index] <= distances[0] + 0.05
      );
      if (args.targetContainers.length > 1)
        args.targetContainers = await compareContainers(args.targetContainers, mwData);

      if (!args.targetContainers.length || args.targetContainers.length > 1) {
        args.targetContainers = [results[0]];
      }
      await driver.scrollIntoView(args.targetContainers[0].selector);
    } else {
      args.targetContainers = results;
    }
  }
  next();
}
async function checkMemory(mwData, next) {
  const { args } = mwData;
  if (args.domainMemoryId) {
    const identifiers = await driver.getSelectors({ id: args.domainMemoryId });
    console.log("memory id", args.domainMemoryId, identifiers);
    if (identifiers.length) {
      const selectedElement = await evaluateSelection(identifiers, [0.2], mwData);
      if (selectedElement) {
        args.selectedElement = selectedElement;
      }
    }
  }
  next();
}

async function multiParameterSearch(identifiers, args, filter) {
  const params = [
    "elementName",
    "elementFunctionality",
    "containerName",
    "containerFunctionality",
  ];
  console.log(
    "multiParameterSearch identifiers, args, filter",
    identifiers,
    args,
    filter
  );
  for (const identifier of identifiers) {
    if (!identifier.id) identifier.id = uniqueId();
    identifier.totalDistance = 0;
    identifier.totalSearches = 0;
  }
  async function paramSearch(param) {
    const searchDocs = identifiers.reduce((acc, identifier) => {
      if (identifier[param] && args[param]) {
        acc.push({ ...identifier, doc: identifier[param] });
      }
      return acc;
    }, []);
    console.log("searchDocs, param", searchDocs, param);
    const searchTerm = args[param];
    const { results, distances } = await selectorStore.quickSearch(
      searchDocs,
      searchTerm,
      filter
    );
    results.forEach(({ id }, i) => {
      const identifier = identifiers.find((item) => item.id === id);
      identifier.totalDistance += distances[i];
      identifier.totalSearches++;
    });
  }
  await Promise.all(params.map((param) => paramSearch(param)));
  return {
    results: identifiers,
    distances: identifiers.map(
      ({ totalDistance, totalSearches }) => totalDistance / totalSearches
    ),
  };
}
async function checkCache(mwData, next) {
  const { fn, args } = mwData;
  if (args.selectedElement) return next();
  const filter = {
    type: fn === "type" ? "typeable" : "clickable",
  };

  const { results, distances } = await driver.checkCache(
    `${args.elementName}: ${args.elementFunctionality}`,
    filter
  );
  const cachedIdentifiers = results.filter((data, i) => distances[i] <= 0.45);
  const dist = distances.filter((value) => value <= 0.45);
  console.log("cachedIdentifiers, distances", cachedIdentifiers, dist);
  if (cachedIdentifiers.length) {
    const filteredIdentifiers = await driver.pageFilter(cachedIdentifiers);
    if (filteredIdentifiers.length) {
      const { results, distances } = await multiParameterSearch(
        filteredIdentifiers,
        args
      );
      console.log("results, distances: multiParameterSearch", results, distances);

      const selectedElement = await evaluateSelection(results, distances, mwData);
      if (selectedElement) {
        args.selectedElement = selectedElement;
      }
    }
  }

  next();
}
function removeDuplicates(arr, prop) {
  const uniqueValues = new Set();
  return arr.filter((item) => {
    if (uniqueValues.has(item[prop])) {
      return false;
    } else {
      uniqueValues.add(item[prop]);
      return true;
    }
  });
}
async function domainMemory(state) {
  if (!state.domainMemory) return "";
  const savedIdentifiers = await driver.pageFilter(state.domainMemory);
  const filteredIdentifiers = removeDuplicates(savedIdentifiers, "selector");
  console.log("domainMemory filteredIdentifiers.length", filteredIdentifiers);
  if (filteredIdentifiers.length) {
    const containers = filteredIdentifiers.reduce(
      (acc, { containerName, containerFunctionality }) => {
        if (!acc.some((item) => item.containerName === containerName)) {
          acc.push({ containerName, containerFunctionality });
        }
        return acc;
      },
      []
    );
    let domainMemory = "";
    let c = 0,
      e = 0;
    console.log("containers domainMemory", containers);
    for (const container of containers) {
      c++;
      const { containerName, containerFunctionality } = container;
      domainMemory += `## Container ${c}
containerName = ${containerName}, 
containerFunctionality = ${containerFunctionality}
The following elements are apart of the above container:
      `;
      e = 0;
      for (const identifier of filteredIdentifiers) {
        if (identifier.containerName === containerName) {
          e++;
          const { elementName, elementFunctionality, id } = identifier;
          domainMemory += `
- **Element ${e}:**          
elementName = ${elementName},
elementFunctionality =  ${elementFunctionality},
domainMemoryId = ${id}
`;
        }
      }
    }
    return `
#Domain Memory
Following is a list of parameters for containers and elements you've previously identified on this page. 
${domainMemory}
Use these saved identifiers to help select elements from memory when applicable to you current task.  
IMPORTANT: Remember to use the domainMemoryId when calling type and click functions using domain memory.
    `;
  }
  console.log("state.domainMemory", state.domainMemory);
  return "";
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
      // iterations: 2,
      state: (state) => state.abort,
    },
    agents: ["ElementIdentifier", "VisualConfirmation", "ElementLocator"],
  });
  const executionReminder = `
As you continue, follow these steps:

1. **Confirm Action**
  - Verify if the intended outcome or that correct element was interacted with.

2. **Plan Next Task**
  - Analyze the overall objective and determine the next logical step.

3. **Locate Target Element**
  - Carefully examine the current screenshot for the next element to interact with.
  - Describe what you can see.
  - If the target element is not visible, scroll up or down to find it.
  - Use scroll functions to move to the desired area.

4. **Element Selection**
  - Collect specific, unique text and distinguishing information about the target element from the screenshot.
  - Gather all container text to ensure the correct element and the correct container is selected.
  - Use this detailed information to construct precise arguments for click and type functions.

IMPORTANT REMINDER:
- Use the promptUser function if you need more context or if you have finished all tasks.
- SCROLL TO FIND THE ITEM YOU WANT TO click or type into if it's not in the current screenshot.
  `;
  this.navigate = async function ({ url }, { state, agents }) {
    const results = await driver.navigate(url);
    await Promise.all([getDomainMemory({ state }), driver.setContainers()]);

    state.screenshot = await driver.getScreenShot();
    state.screenshot_message = `This is an image of the page you have just navigated to. ${executionReminder} ${await domainMemory(
      state
    )}`;

    return `${results}. ${executionReminder} ${await domainMemory(state)}`;
  };
  this.type = async function (
    { selectedElement, elementName, inputText, searchHelpMessage = "", identifier },
    { state }
  ) {
    if (selectedElement) {
      await selectedElement.type(inputText, { delay: 100 });
      if (identifier.positionRefresh === "static") {
        if (typeof identifier.usage === "number") {
          identifier.usage++;
        } else {
          identifier.usage = 1;
        }
        driver.saveSelectors(identifier);
      }
      state.screenshot = await driver.getScreenShot();
      state.screenshot_message = `The input was found and typed into. ${executionReminder} ${await domainMemory(
        state
      )}`;
      return `The input was found and typed into. ${executionReminder} ${await domainMemory(
        state
      )}`;
    }

    return `The ${elementName} was not successfully selected. ${searchHelpMessage}`;
  };

  this.click = async function (
    { selectedElement, elementName, searchHelpMessage = "", identifier },
    { state }
  ) {
    if (selectedElement) {
      try {
        await selectedElement.click();
        if (identifier.positionRefresh === "static") {
          if (typeof identifier.usage === "number") {
            identifier.usage++;
          } else {
            identifier.usage = 1;
          }
          driver.saveSelectors(identifier);
        }
        await wait(1000);
        state.screenshot = await driver.getScreenShot();
        state.screenshot_message = `The element was found and clicked.  ${executionReminder} ${await domainMemory(
          state
        )}`;
        return `The element was found and clicked.  ${executionReminder} ${await domainMemory(
          state
        )}`;
      } catch (error) {
        console.log("selectedElement.click error", error);
        return `There was an error when attempting to click the ${elementName}`;
      }
    }
    return `The ${elementName} was not successfully selected. ${searchHelpMessage}`;
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

  this.promptUser = async function ({ text }, { state }) {
    console.log(`\n${text}\n`);
    const response = await new Promise((resolve) => {
      state.promptUserCallBack = resolve;
    });
    return response;
  };

  const resetContainers = async function ({}, next) {
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
      await driver.clearSelection();
      const { totalSections } = await driver.setupSections();
      console.log("totalSections2-->", totalSections);
      if (totalSections > 1) {
        const fullPage = await driver.getScreenShot(true);
        await driver.clearSections();
        const currentSection = await driver.getCurrentSection();
        console.log("invoking ElementLocation", fullPage, currentSection);
        const { sectionNumber, reasoning } = await ElementLocator.invoke({
          message: `We are currently in section ${currentSection} of the web page. Please locate the section of the element that matches the follow search criteria: 
            - Element Name: ${args.elementName}.
            - Element Functionality: ${args.elementFunctionality}`,
          image: fullPage,
          ...args,
        });
        await driver.showContainers();
        console.log("sectionNumber, reasoning", sectionNumber, reasoning);
        if (!sectionNumber) {
          args.searchHelpMessage = reasoning;
        } else if (Math.abs(sectionNumber - currentSection) < 0.6) {
          args.searchHelpMessage = `We have scrolled to section ${sectionNumber}. The ${args.elementName} should be seen in this current location of the web page. Please refine your search parameters to properly get a handle on the element.`;
          await driver.goToSection(sectionNumber);
        } else {
          args.searchHelpMessage = `We have scrolled to section ${sectionNumber}. The ${args.elementName} should be seen in this current location of the web page. Please refine your search parameters to properly get a handle on the element.`;
          await driver.goToSection(sectionNumber);
          return searchPage(mwData, next);
        }
      }
    }
    next();
  }
  async function getDomainMemory({ state }) {
    state.domainMemory = await driver.getSelectors();

    console.log("state.domainMemory", state.domainMemory);
  }

  async function awaitNavigation({ state, agents }, next) {
    // console.log("state.navigationStarted", state.navigationStarted);
    if (state.navigationStarted) {
      while (state.navigationStarted) {
        console.log("waiting for page to load...");
        await wait(500);
      }
      console.log("page load is now complete");
      await Promise.all([getDomainMemory({ state }), driver.setContainers()]);
      state.screenshot = await driver.getScreenShot();
      state.screenshot_message = `This is an image of the page you have just navigated to. ${executionReminder} ${await domainMemory(
        state
      )}`;

      next();
    } else next();
  }
  this.before(
    "type",
    checkMemory,
    checkCache,
    selectContainers,
    searchPage,
    getElementLocations
  );
  this.before(
    "click",
    checkMemory,
    checkCache,
    selectContainers,
    searchPage,
    getElementLocations
  );

  //this.before("$invoke", insertScreenshot);
  this.after("click", awaitNavigation, resetContainers);
  this.after("type", resetContainers);
  this.after("$all", awaitNavigation, insertScreenshot);
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
        state.previousUrl = state.currentUrl;
        state.currentUrl = request.url();

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

// I need a function to properly insert and remove containers
// - I discovered this when trying to select a container from memory
// - filter out duplicates from memory

//fix highlight bounding boxes

//Refine ElementIdentifier
//- When the search input was highlighted but the button was not, it decided that the bonding box belonged to the button
//- so we need to make sure to reinforce the boundaries of the highlighted element somehow
