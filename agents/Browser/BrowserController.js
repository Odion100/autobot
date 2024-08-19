import OpenAI from "openai";
import prompt from "./prompts/BrowserController.js";
import schema from "./schemas/BrowserController.js";
import driver from "./utils/driver.js";
import dotenv from "dotenv";
import { insertScreenshot } from "./middleware.js";
import selectorStore from "./utils/selectorStore.js";
import uniqueId from "./utils/uniqueId.js";
import getElementDescriptions from "./utils/getElementDescriptions.js";
const wait = (timeout = 0) =>
  new Promise((resolve) => setTimeout(() => resolve(new Date()), timeout));

dotenv.config();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function compareElements(targetElements, fullScreenshot, type, { args, agents }) {
  const { elementDescriptions, fullMatchContainers, partialMatchContainers, fullMatch } =
    await getElementDescriptions({ targetElements, fullScreenshot, args, type });
  args.searchedContainers = args.targetContainers;
  args.searchedElements = elementDescriptions.filter(
    ({ matchesCriteria }) => matchesCriteria === "no-match"
  );
  args.fullMatchContainers = fullMatchContainers.length ? fullMatchContainers : null;

  driver.cacheSelectors(elementDescriptions);

  if (fullMatch) return { results: [fullMatch], distances: [0.2] };
  if (!elementDescriptions.length) return { results: [], distances: [] };
  const filteredElements = elementDescriptions.filter(
    ({ matchesCriteria }) => matchesCriteria !== "no-match"
  );
  console.log("filteredElements xx-->>", filteredElements);
  if (!filteredElements.length) return { results: [], distances: [] };

  return await multiParameterSearch(filteredElements, args, { type });
}

async function getAnchoredSelector(identifier, mwData) {
  const potentialAnchors = await driver.filterPotentialAnchors(identifier);
  const potentialIdentifiers = [];
  for (const anchor of potentialAnchors) {
    const { containerNumber } = driver.addContainer(anchor);
    potentialIdentifiers.push({
      ...identifier,
      container: anchor,
      selector: `${anchor} > ${identifier.subSelector}`,
      containerNumber,
    });
  }
  console.log("potentialIdentifiers:", potentialIdentifiers);
  if (potentialIdentifiers.length === 1) return potentialIdentifiers[0];
  if (potentialIdentifiers.length > 1) {
    const fullScreenshot = await driver.getScreenshot();
    const { fn, args } = mwData;
    const { fullMatch } = await getElementDescriptions({
      targetElements: potentialIdentifiers,
      fullScreenshot,
      args,
      type: mwData.fn === "type" ? "typeable" : "clickable",
    });
    return fullMatch;
  }
}
async function evaluateSelection(elementIdentifiers, distances, mwData) {
  console.log("elementIdentifiers/:", elementIdentifiers);
  const { args, agents } = mwData;
  const { VisualConfirmation } = agents;
  for (const i in elementIdentifiers) {
    const dist = distances[i];
    if (dist < 0.4) {
      const identifier = elementIdentifiers[i].anchors
        ? await getAnchoredSelector(elementIdentifiers[i], mwData)
        : elementIdentifiers[i];
      if (identifier) {
        if (dist < 0.34) {
          const element = await driver.selectElement(identifier);
          if (element) {
            args.identifier = identifier;
            console.log("args.identifier", args.identifier);
            return element;
          }
        } else {
          const element = await driver.selectElement(identifier);
          if (element) {
            const image = identifier.container
              ? await driver.captureElement(identifier.container)
              : await driver.getScreenshot();
            const isMatch = await VisualConfirmation.invoke({
              message: `Is the correct element selected (surrounded by a green box) in the screenshot?`,
              image,
              ...args,
            });
            console.log("isMatch", isMatch);
            if (isMatch) {
              args.identifier = identifier;
              console.log("args.identifier", args.identifier);
              return element;
            }
          }
        }
      }
    }
  }
}

//evaluate containers
// add abort state to secondSearch loop from command line
// Plan off of full page
// scroll to any position
async function compareContainers(containers, { args, agents }) {
  const { ContainerIdentifier } = agents;
  await driver.hideContainers();
  await driver.addLabels(containers);
  const image = await driver.getScreenshot();
  const containerNumbers = containers
    .map(({ containerNumber }) => containerNumber)
    .join(", ");

  const message = `Please identify the highlighted containers of the following number(s): ${containerNumbers}.`;
  const results = await ContainerIdentifier.invoke({ message, image, ...args });
  const identifiedContainers = [];
  for (const item of results) {
    const identifiedContainer = containers.find(
      ({ containerNumber }) => containerNumber === item.containerNumber
    );
    if (identifiedContainer)
      identifiedContainers.push({
        ...item,
        ...identifiedContainer,
      });
  }
  driver.clearLabels();
  const fullMatch = identifiedContainers.filter(
    ({ matchesCriteria }) => matchesCriteria === "full-match"
  );
  console.log("compare containers identifiedContainers", identifiedContainers);
  console.log("compare containers fullMatch", fullMatch);
  return fullMatch.length
    ? fullMatch
    : identifiedContainers.filter(
        ({ matchesCriteria }) => matchesCriteria !== "no-match"
      );
}
async function searchPage(mwData, next, secondSearch) {
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
          selector: {
            $nin: args.searchedElements
              // .filter(({ selector }) => typeof selector === "string")
              .map(({ selector }) => selector.toString()),
          },
        },
        { type },
      ],
    };
  } else if (secondSearch) {
    if (!filter) filter = { type };
  }

  const identifiedElements = await driver.searchPage(
    `${elementName}, ${innerText}`,
    args.targetContainers,
    filter
  );
  if (identifiedElements.length) {
    await driver.hideContainers();
    const fullScreenshot = await driver.getScreenshot();
    const { results, distances } = await compareElements(
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
  console.log("args.targetContainers", args.targetContainers, secondSearch);

  if (!secondSearch) {
    args.targetContainers = args.fullMatchContainers;
    return searchPage(mwData, next, true);
  }
  next();
}
async function selectContainers(mwData, next) {
  const { args, agents, state } = mwData;
  if (args.selectedElement) return next();
  const { containerName } = args;
  if (containerName) {
    const identifiers = await driver.getSelectors({ containerName });
    if (identifiers.length) {
      args.targetContainers = [driver.addContainer(identifiers[0].container)];
    }
  }

  if (!args.targetContainers) {
    if (!args.containerText) {
      const { searchTerm } = await agents.RefineSearch.invoke(
        {
          message:
            "Please provide more containerText search terms for the target element based on the previous screenshot",
        },
        { messages: [...state.messages] }
      );
      if (searchTerm) Object.assign(args, searchTerm);
    }
    const filter = args.searchedContainers
      ? { selector: { $nin: args.searchedContainers.map(({ selector }) => selector) } }
      : undefined;
    const { results, distances } = await driver.findContainers(
      `${args.containerText}, ${args.innerText}`,
      filter
    );
    if (distances[0] <= 0.35) {
      args.targetContainers = results.filter(
        (item, index) => distances[index] <= distances[0] + 0.05
      );
      if (args.targetContainers.length > 1) {
        const containers = await compareContainers(args.targetContainers, mwData);
        if (containers.length) args.targetContainers = containers;
      }
    }
    if (!args.targetContainers) args.targetContainers = results;
  }
  if (args.targetContainers && args.targetContainers.length === 1)
    await driver.scrollIntoView(args.targetContainers[0].selector);

  next();
}
async function searchMemory(searchParams, filter, memoryDomain = "long-term") {
  const cache = memoryDomain === "cache";
  let searchResults;
  if (cache) {
    searchResults = await driver.searchCache(
      `${searchParams.elementName}: ${searchParams.elementFunctionality}`,
      filter
    );
  } else {
    searchResults = await driver.searchSelectors(
      `${searchParams.elementName}: ${searchParams.elementFunctionality}`,
      filter
    );
  }
  const { results, distances } = searchResults;

  const savedIdentifiers = results.filter((data, i) => distances[i] <= 0.45);
  const dist = distances.filter((value) => value <= 0.45);
  console.log(`savedIdentifiers, distances ${memoryDomain}`, savedIdentifiers, dist);
  if (savedIdentifiers.length) {
    const filteredIdentifiers = await driver.pageFilter(savedIdentifiers);
    if (filteredIdentifiers.length) {
      return await multiParameterSearch(filteredIdentifiers, searchParams);
    }
  }

  return { results: [], distances: [] };
}
async function checkMemory(mwData, next) {
  const { args, fn } = mwData;
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
  const type = fn === "type" ? "typeable" : "clickable";

  if (!args.selectedElement) {
    const filter = { $and: [{ type }, { positionRefresh: "dynamic" }] };
    const { results, distances } = await searchMemory(args, filter, "long-term");
    if (results.length) {
      const selectedElement = await evaluateSelection(results, distances, mwData);
      if (selectedElement) {
        args.selectedElement = selectedElement;
        return next();
      }
    }
  }
  if (!args.selectedElement) {
    const filter = { type };
    const { results, distances } = await searchMemory(args, filter, "cache");
    if (results.length) {
      const selectedElement = await evaluateSelection(results, distances, mwData);
      if (selectedElement) {
        args.selectedElement = selectedElement;
        return next();
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
    // console.log("searchDocs, param", searchDocs, param);
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
async function extraSearch(identifiers, args, filter) {
  for (const identifier of identifiers) {
    if (!identifier.id) identifier.id = uniqueId();
    identifier.totalDistance = 0;
    identifier.totalSearches = 0;
    const { elementName, elementFunctionality, containerName, containerFunctionality } =
      identifier;
    identifier.doc = `${containerName}, ${containerFunctionality}: ${elementName} ${elementFunctionality}`;
  }
  console.log("extra search identifiers", identifiers);
  const { elementName, elementFunctionality, containerName, containerFunctionality } =
    args;
  const searchTerm = `${containerName}, ${containerFunctionality}: ${elementName} ${elementFunctionality}`;
  const results = await selectorStore.quickSearch(identifiers, searchTerm, filter);
  console.log("results of extra search", results, searchTerm, args);
  return results;
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
    secondSearchConditions: {
      functionCall: "promptUser",
      shortCircuit: 3,
      // iterations: 2,
      state: (state) => state.abort,
    },
    agents: [
      "ElementIdentifier",
      "ContainerIdentifier",
      "VisualConfirmation",
      "ElementLocator",
      "RefineSearch",
    ],
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
  const searchHelpMessage = `Please revise your search terms for selecting the container and element you want to interact with by following these steps:

  1. Examine the screenshot to identify the target element.
  2. Double check to make sure that the target element is actually in the screenshot.
  - If the target element is not in the screen shot scroll to find it.
  3. CRITICAL: DO NOT MAKE ASSUMPTIONS ABOUT THE ELEMENTS, CONTAINERS, AND TEXT OUTSIDE OF THE CURRENT SCREENSHOT. IF THE ITEM YOU ARE LOOKING FOR IS NOT IN THE SCREENSHOT USE THE SCROLL FUNCTION TO FIND IT.
  4. Provide a clear and concise elementName.
  6. Specify the elementFunctionality to clarify the purpose or action of the element (e.g., 'Filters search results to show only items in new condition.').
  7. Include the exact innerText of the element if applicable (e.g., 'New') as seen in the screenshot.
  8. Revise the containerName for the container that actually holds the element based on the current screenshot.
  9. Describe the containerFunctionality to provide context for the element's location and purpose.
  10. Gather more exact containerText to help locate the correct red-bordered container, focusing on key identifiable text within the container.
  
  Remember to be as specific and accurate as possible in your descriptions to ensure the correct element and container are identified.`;
  this.navigate = async function ({ url }, { state, agents }) {
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
  };
  this.type = async function (
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
  };

  this.click = async function ({ selectedElement, elementName, identifier }, { state }) {
    if (selectedElement) {
      try {
        await selectedElement.click();
        driver.saveIdentifier(identifier, selectedElement);
        await wait(1000);
        state.screenshot = await driver.getScreenshot();
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
    state.screenshot = await driver.getScreenshot();
    state.screenshot_message = message;

    return message;
  };

  this.scrollDown = async function (data, { state }) {
    const scrollPosition = await driver.scrollDown();
    const message = `You have scrolled down to section ${scrollPosition}`;

    state.screenshot = await driver.getScreenshot();
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
    console.log("resetting containers --->");
    await driver.clearSelection();
    await driver.clearContainers();
    await driver.setContainers();
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
        const fullPage = await driver.getScreenshot(true);
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
          const image = await driver.getScreenshot();
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
    state.domainMemory = await driver.getSelectors({ positionRefresh: "static" });
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
      state.screenshot = await driver.getScreenshot();
      state.screenshot_message = `This is an image of the page you have just navigated to. ${executionReminder} ${await domainMemory(
        state
      )}`;

      next();
    } else next();
  }
  this.before(
    "type",
    checkMemory,
    selectContainers,
    searchPage
    // getElementLocations
  );
  this.before(
    "click",
    checkMemory,
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
//Whats left
//1. reorder the anchors so that id is prioritized
//2. check memory for dynamic items in the same way the cache is checked
//3. remove invalid anchors and consider keep the rest

// Improve memory selection:
// save dynamic selectors but filter them out of domain memory or add more conditions for using them
// Add a list of elements seen within the container to the identifier function
// add positionRefresh when selecting the element to help with matching for cache

// Improve saved selectors:
// add an anchor selector to the containers
// - The anchor is a selector using any other attributes that will consistently identify the same item
// first save anchor then confirm it's validity later
// add an subSelector to the element that selects from the anchor to the element

// Improve interfacing abilities:
// add the ability to edit memory items and add notes and inject the notes into domain memory
// add the ability for the ai to ask for help selecting an element when calling prompt user
// add the stellar interface

//Delete cache
