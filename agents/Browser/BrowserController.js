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
    driver.cacheSelectors(staticIdentifiers);
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
    const identifiedContainer = await ElementIdentifier.invoke({
      message,
      images: [fullScreenshot, containerImage],
      ...args,
    });
    identifiedContainer.containerNumber = containerNumber;
    console.log("describeElement2", containerImage, identifiedContainer);
    return identifiedContainer;
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
  const fullMatchContainers = [];
  const partialMatchContainers = [];

  for (const identifiedContainer of identifiedContainers) {
    if (identifiedContainer.matchesCriteria === "full-match")
      fullMatchContainers.push({
        ...driver.getContainer(identifiedContainer.containerNumber),
        matchesCriteria: "full-match",
      });
    if (identifiedContainer.matchesCriteria === "partial-match")
      partialMatchContainers.push({
        ...driver.getContainer(identifiedContainer.containerNumber),
        matchesCriteria: "partial-match",
      });

    for (const identifier of identifiedContainer.identifiedElements) {
      const identifiedElement =
        targetElements.find(({ number }) => number === identifier.elementNumber) || {};

      if (identifiedElement) {
        identifier.selector = identifiedElement.selector;
        identifier.container = identifiedElement.container;
        identifier.type = identifiedElement.type;
        identifier.containerName = identifiedContainer.containerName;
        identifier.containerFunctionality = identifiedContainer.containerFunctionality;
        identifier.positionRefresh = identifiedContainer.positionRefresh;
        identifier.usage = 0;
        elementDescriptions.push(identifier);
        if (identifier.matchesCriteria === "full-match" && identifier.type === type)
          fullMatch = identifier;
      }
    }
  }
  args.searchedContainers = args.targetContainers;
  args.searchedElements = elementDescriptions.filter(
    ({ matchesCriteria }) => matchesCriteria === "no-match"
  );
  args.targetContainers = fullMatchContainers.length
    ? fullMatchContainers
    : partialMatchContainers;

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
async function searchPage(mwData, next, exit) {
  const { args, state, fn } = mwData;
  const { innerText, elementName } = args;
  const type = fn === "type" ? "typeable" : "clickable";
  if (state.navigationStarted) return next();
  if (args.selectedElement) return next();
  let filter;
  if (args.searchedElements) {
    filter = {
      $and: [
        {
          selector: { $nin: args.searchedElements.map(({ selector }) => selector) },
        },
        { type },
      ],
    };
  } else if (!innerText) {
    if (!filter) filter = { type };
  }

  const identifiedElements = await driver.searchPage(
    `${elementName}, ${innerText}`,
    args.targetContainers,
    filter
  );
  if (identifiedElements.length) {
    await driver.hideContainers();
    const fullScreenshot = await driver.getScreenShot();
    const { results, distances } = await searchDescription2(
      identifiedElements,
      fullScreenshot,
      type,
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
  console.log("args.targetContainers", args.targetContainers, exit);

  if (!exit && args.targetContainers.length) return searchPage(mwData, next, true);
  next();
}

async function selectContainers(mwData, next) {
  const { args, agents } = mwData;
  if (args.selectedElement) return next();
  const { innerText, containerText } = args;

  if (!containerText) {
    const { searchTerm, notFound } = agents.RefineSearch.invoke(
      {
        message:
          "Please provide search terms for the target element based on the previous screenshot",
      },
      { messages: [...state.messages] }
    );
    if (searchTerm) Object.assign(args, searchTerm);
  }
  if (!args.targetContainers && containerText) {
    const filter = args.searchedContainers
      ? { selector: { $nin: args.searchedContainers.map(({ selector }) => selector) } }
      : undefined;
    const { results, distances } = await driver.findContainers(
      `${containerText}, ${innerText}`,
      filter
    );
    if (distances[0] <= 0.3 && distances[1] > 0.3) {
      args.targetContainers = [results[0]];
    } else if (distances[0] <= 0.35) {
      args.targetContainers = results.filter(
        (item, index) => distances[index] <= distances[0] + 0.05
      );
      if (args.targetContainers.length > 1) {
        const r = await compareContainers(args.targetContainers, mwData);
        if (r.length) args.targetContainers = [driver.addContainer(r[0].container)];
      }

      if (!args.targetContainers.length || args.targetContainers.length > 1) {
        args.targetContainers = [driver.addContainer(results[0].container)];
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
        return next();
      }
    }
  }
  const { containerName } = args;
  if (containerName) {
    const identifiers = await driver.getSelectors({ containerName });
    if (identifiers.length) {
      args.targetContainers = [driver.addContainer(identifiers[0].container)];
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
    let xmlContent = '<?xml version="1.0" encoding="UTF-8"?>\n<domain-memory>\n';
    xmlContent +=
      "  <description>Following is a list of parameters for containers and elements you've previously identified on this page.</description>\n";
    console.log("containers domainMemory", containers);
    for (const [index, container] of containers.entries()) {
      const { containerName, containerFunctionality } = container;
      xmlContent += `  <container id="${index + 1}">\n`;
      xmlContent += `    <containerName>${escapeXml(containerName)}</containerName>\n`;
      xmlContent += `    <containerFunctionality>${escapeXml(
        containerFunctionality
      )}</containerFunctionality>\n`;
      xmlContent += "    <elements>\n";
      for (const identifier of filteredIdentifiers) {
        if (identifier.containerName === containerName) {
          const { elementName, elementFunctionality, id } = identifier;
          xmlContent += "      <element>\n";
          xmlContent += `        <elementName>${escapeXml(elementName)}</elementName>\n`;
          xmlContent += `        <elementFunctionality>${escapeXml(
            elementFunctionality
          )}</elementFunctionality>\n`;
          xmlContent += `        <domainMemoryId>${escapeXml(id)}</domainMemoryId>\n`;
          xmlContent += "      </element>\n";
        }
      }
      xmlContent += "    </elements>\n";
      xmlContent += "  </container>\n";
    }
    xmlContent += "  <instructions>\n";
    xmlContent +=
      "    <instruction>Use these saved identifiers to help select elements from memory when applicable to your current task.</instruction>\n";
    xmlContent +=
      "    <instruction>IMPORTANT: Remember to use the domainMemoryId when calling type and click functions using domain memory.</instruction>\n";
    xmlContent += "  </instructions>\n";
    xmlContent += "</domain-memory>";
    return xmlContent;
  }
  console.log("state.domainMemory", state.domainMemory);
  return "";
}

// Helper function to escape special characters for XML
function escapeXml(unsafe) {
  return unsafe.replace(/[<>&'"]/g, function (c) {
    switch (c) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "'":
        return "&apos;";
      case '"':
        return "&quot;";
    }
  });
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
    agents: ["ElementIdentifier", "VisualConfirmation", "ElementLocator", "RefineSearch"],
  });
  const executionReminder = `
  <?xml version="1.0" encoding="UTF-8"?>
  <execution-reminder>
    <introduction>As you continue, answer the following questions:</introduction>
    
    <question-set>
      <category>
        <name>Confirm Action</name>
        <questions>
          <question>Was the intended outcome achieved?</question>
          <question>Did I interact with the correct element?</question>
          <question>What visual or textual evidence confirms this?</question>
        </questions>
      </category>
      
      <category>
        <name>Plan Next Task</name>
        <questions>
          <question>Given the current state, what is the next logical step?</question>
        </questions>
      </category>
      
      <category>
        <name>Locate Target Element</name>
        <questions>
          <question>Is the target element visible in the current screenshot?</question>
          <sub-questions>
            <question>If not visible:</question>
            <bullet-points>
              <point>Should I scroll to find the element?</point>
              <point>Is the element in the Domain memory?</point>
            </bullet-points>
          </sub-questions>
        </questions>
      </category>
    </question-set>
    
    <element-selection-process>
      <title>Element Selection Process</title>
      <steps>
        <step>Collect specific, unique text and distinguishing information about the target element from the screenshot.</step>
        <step>Gather all container text to ensure the correct element and the correct container is selected.</step>
        <step>Use this detailed information to construct precise arguments for click and type functions.</step>
      </steps>
    </element-selection-process>
    
    <important-reminders>
      <reminder>Use the promptUser function if you need more context or if you have finished all tasks.</reminder>
      <reminder>SCROLL TO FIND THE ITEM YOU WANT TO click or type into if it's not in the current screenshot.</reminder>
    </important-reminders>
  </execution-reminder>
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
        driver.clearSelection();
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
          driver.clearSelection();
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
      agents: { ElementLocator, RefineSearch },
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
        } else if (Math.round(sectionNumber) === Math.round(currentSection)) {
          const { searchTerm, notFound } = await RefineSearch.invoke(
            {
              message:
                "Please provide search terms for the target element based on the previous screenshot",
            },
            { messages: [...state.messages] }
          );
          if (searchTerm) {
            Object.assign(args, searchTerm);
            return searchPage(mwData, next);
          } else {
            args.searchHelpMessage = `The ${args.elementName} should be seen in this current location of the web page. Please refine your search parameters to properly get a handle on the element.`;
            await driver.goToSection(sectionNumber);
          }
        } else {
          await driver.goToSection(sectionNumber);
          await driver.showContainers();
          const image = await driver.getScreenShot();
          const { searchTerm, notFound } = await RefineSearch.invoke(
            {
              image,
              message:
                "Please provide search terms for the target element based on the screenshot",
              ...args,
            },
            { messages: [...state.messages] }
          );
          if (searchTerm) {
            Object.assign(args, searchTerm);
            return searchPage(mwData, next);
          } else {
            args.searchHelpMessage = `We have scrolled to section ${sectionNumber}. The ${args.elementName} should be seen in this current location of the web page. Please refine your search parameters to properly get a handle on the element.`;
            await driver.goToSection(sectionNumber);
          }
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
    searchPage
    // getElementLocations
  );
  this.before(
    "click",
    checkMemory,
    checkCache,
    selectContainers,
    searchPage
    // getElementLocations
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

//Recursive Page search
//When a page search process fails we should attempt to recover and complete the search.

//1. In getDescriptions: check for a full match container and add it to the args
//- replace target containers with all full match containers (ideally there would only be one)
//2. Also save the previous search results to the args state: searchedContainers, searchedElements

// In getElementLocation
//3. If a full match container has been set then search it again while filtering out the previous search results
// if a full match container hasn't been set:
//1. Confirm that the target element is or is not in the screen shot
//2. If not use ElementLocator to move to the elements location
// - experiment between get element location and just give the ai instruction to scroll
//3. Use a new agent to get as much container test from the the target container
//4. redo a page search and container search which will now be filtering out previous searches

//5. The filtering can happen in the searchPage and in getTargetContainers middleware
