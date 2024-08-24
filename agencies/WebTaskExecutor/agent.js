import OpenAI from "openai";
import prompt from "./prompt.js";
import schema from "./schema.js";
import driver from "../../common/driver/index.js";
import dotenv from "dotenv";
import { wait } from "../../common/utils/index.js";
import { getDomainMemory, domainMemory } from "../../common/middleware/utils/index.js";
import {
  checkMemory,
  selectContainers,
  searchPage,
  awaitNavigation,
  insertScreenshot,
} from "../../common/middleware/index.js";

dotenv.config();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
        await wait(2000);
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

  this.before("type", checkMemory, selectContainers, searchPage);
  this.before("click", checkMemory, selectContainers, searchPage);

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
