import puppeteer from "puppeteer";
import injectMarkdownResources from "./utils/injectMarkdownResources.js";
import insertRecorder from "./utils/insertRecorder.js";
import injectMemoryDisplay from "./utils/injectMemoryDisplay.js";
import insertLoadingComponent from "./utils/insertLoadingComponent.js";
import insertChatbot from "./utils/insertChatbot.js";
import insertSidePanel from "./utils/insertSidePanel.js";
import getContentContainers from "./utils/getContentContainers.js";
import getInteractiveElements from "./utils/getInteractiveElements.js";
import getAnchors from "./utils/getAnchors.js";
import filterAnchors from "./utils/filterAnchors.js";
import setContentContainers from "./utils/setContentContainers.js";
import setSelection from "./utils/setSelection.js";
import setupPageSections from "./utils/setupPageSections.js";
import htmlVectorSearch from "./utils/htmlVectorSearch.js";
import getViewport from "./utils/getViewport.js";
import selectorStore from "./utils/selectorStore.js";
import setLabels from "./utils/setLabels.js";
import insertContainerLabels from "./utils/insertContainerLabels.js";
import getElementDescriptions from "./utils/getElementDescriptions.js";
const webAssistantState = { messages: [] };

function browserController() {
  let browser;
  let page;
  const internalState = {
    currentPage: "",
    lastPage: "",
    selectedElement: undefined,
    selectedContainers: [],
    scrollHeight: 0,
    containers: [],
    labeledElements: [],
    showSelection: true,
    interactions: [],
    agents: {},
  };
  function init({ ElementIdentifier, WebAssistant } = {}) {
    console.log(" ElementIdentifier, WebAssistant", ElementIdentifier, WebAssistant);
    Object.assign(internalState.agents, { ElementIdentifier, WebAssistant });
  }
  const state = () => internalState;
  const getContainer = (n) => internalState.containers[n - 1];
  const getContainers = (numbers) => {
    return internalState.containers.filter(({ containerNumber }) =>
      numbers.includes(containerNumber)
    );
  };
  const getLabeledElement = (n) => internalState.labeledElements[n - 1];
  async function navigate(url) {
    if (!browser) {
      browser = await puppeteer.launch({ headless: false, args: ["--start-maximized"] });
      page = (await browser.pages())[0];
      // Set up communication channel between browser and Node.js
      await page.exposeFunction("saveInteraction", (interaction) => {
        if (Array.isArray(interaction)) {
          internalState.interactions = interaction;
          clearInsertedLabels().then(() => insertLabels(interaction));
        } else {
          internalState.interactions.push(interaction);
          insertLabels([interaction]);
        }

        console.log("Interaction recorded:", interaction);
      });

      await page.exposeFunction("recordingComplete", async (interaction) => {
        if (internalState.interactions.length) {
          console.log("internalState.agents:", internalState.agents);

          const { elementDescriptions } = await getElementDescriptions({
            targetElements: internalState.interactions,
            progressCallback: showLoading,
            ...internalState.agents,
            driver,
          });
          clearContainers();
          await saveSelectors(elementDescriptions);
          await clearLoading();
          showMemory();
        } else {
          clearContainers();
          showMemory();
        }
        internalState.interactions = [];

        console.log("Interaction recorded2:", interaction);
      });
      await page.exposeFunction("updateIdentifier", async (identifier) => {
        if (identifier) await saveSelectors(identifier);
        console.log("Updating Identifier:", identifier);
      });
      await page.exposeFunction("deleteIdentifier", async (identifier) => {
        await deleteIdentifiers([identifier]);
        await showMemory();
        console.log("Deleting Identifier:", identifier);
      });
      await page.exposeFunction("showChat", async () => {
        await showChat();
      });
      await page.exposeFunction("insertChatMessage", async (input) => {
        console.log("insertChatMessage input", input);
        await insertChatMessage(input);
      });

      await page.exposeFunction("showMemory", async () => {
        await showMemory();
      });
      await page.exposeFunction("showRecorder", async () => {
        await showRecorder();
      });
      await page.exposeFunction("clearContainers", clearContainers);
      page.on("load", async function () {
        console.log("page load event --->");
        internalState.lastPage = internalState.currentPage;
        internalState.currentPage = url;
        internalState.selectedElement = undefined;
        internalState.selectedContainers = [];
        internalState.containers = [];
        internalState.labeledElements = [];
        internalState.interactions = [];
        internalState.scrollHeight = 0;
        if (internalState.agents.WebAssistant) {
          await injectMarkDown();
          showChat();
        }
        console.log("internalState", internalState);
      });
      const dimensions = await page.evaluate(() => {
        return {
          width: window.innerWidth,
          height: window.innerHeight,
        };
      });

      // Set the viewport size to match the window dimensions
      await page.setViewport({
        width: dimensions.width,
        height: dimensions.height,
      });
    }

    await page.setViewport({ width: 0, height: 0 });
    await page.goto(url);

    internalState.lastPage = internalState.currentPage;
    return `The Browser has navigated to ${page.url()}`;
  }

  async function findContainers(searchText, where) {
    const viewportContainers = await page.evaluate(getViewport, internalState.containers);
    // console.log("viewportContainers <----", viewportContainers);
    return await htmlVectorSearch.findContainers(
      viewportContainers,
      searchText,
      where,
      5
    );
  }
  async function addContainer(selector) {
    console.log("addContainer length", internalState.containers.length);
    const { updatedContainers, newContainer } = await page.evaluate(
      function (containers, selector) {
        console.log("containers, selector", containers, selector);
        const newContainerElement = document.querySelector(selector);
        if (!newContainerElement) return {};
        const existingContainer = containers.find((container) =>
          newContainerElement.matches(container.selector)
        );
        let newContainer;
        if (existingContainer) {
          existingContainer.selector = selector;
          newContainer = existingContainer;
        } else {
          newContainer = {
            containerNumber: containers.length + 1,
            html: "",
            innerText: "",
            selector,
          };
          containers.push(newContainer);
        }
        return { updatedContainers: containers, newContainer };
      },
      internalState.containers,
      selector
    );
    if (updatedContainers) {
      console.log(
        "updatedContainers.length , internalState.containers",
        updatedContainers.length,
        internalState.containers.length
      );
      if (updatedContainers.length > internalState.containers.length)
        await insertContainer(newContainer);
      internalState.containers = updatedContainers;
      return newContainer;
    } else {
      throw Error(
        `driver.addContainer(...) Error: target container  element ${selector} does not exit on this page. Remember to apply driver.pageFilter to a list of identifier  before attempt to add the container.`
      );
    }
  }
  async function viewFilter(identifiers) {
    return await page.evaluate(getViewport, identifiers);
  }
  async function pageFilter(identifiers) {
    return await page.evaluate(function (identifiers) {
      function isVisible(element) {
        const style = window.getComputedStyle(element);
        return !(
          style.display === "none" ||
          style.visibility === "hidden" ||
          element.offsetParent === null
        );
      }
      return identifiers.filter((identifier) => {
        const element = document.querySelector(identifier.selector);
        if (!element) return false;
        const { width, height } = element.getBoundingClientRect();
        if (parseInt(width) < 1 && parseInt(height) < 1) return false;

        return isVisible(element);
      });
    }, identifiers);
  }

  const clickable =
    'a, [onclick], button, input[type="button"], [type="submit"], [type="reset"], [type="image"], [type="file"], [type="checkbox"], [type="radio"]';

  const typeable = "input, textarea";
  const both = clickable + ", " + typeable;
  const elementType = { clickable, typeable, both };
  async function searchPage(searchText, targetContainers, where) {
    console.log("searchText, targetContainers", searchText, targetContainers);
    await setContainers();
    await clearInsertedLabels();
    if (!targetContainers) targetContainers = [];
    const viewportContainers = targetContainers.length
      ? targetContainers
      : await viewFilter(internalState.containers);

    console.log("viewportContainers-->", viewportContainers.length, viewportContainers);
    const interActiveElements = await page.evaluate(
      getInteractiveElements,
      viewportContainers,
      both
    );
    const { results } = await htmlVectorSearch.findElements(
      interActiveElements,
      searchText,
      where,
      6
    );
    if (!results.length) return [];
    const filteredIdentifiers = await page.evaluate(function filterHiddenElements(
      results
    ) {
      return results.reduce(function (acc, identifier, i) {
        const element = document.querySelector(identifier.selector);
        if (!element) {
          console.log("element missing", identifier);
          return acc;
        }
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const width = parseFloat(rect.width);
        const height = parseFloat(rect.height);
        if (
          !(
            (
              width <= 1 ||
              height <= 1 ||
              style.display === "none" ||
              style.visibility === "hidden"
            )
            // element.offsetParent === null
          )
        ) {
          identifier.number = acc.length + 1;
          identifier.width = rect.width;
          identifier.height = rect.height;
          identifier.display = style.display;
          identifier.visibility = style.visibility;
          identifier.offset = element.offsetParent === null;
          acc.push(identifier);
        } else {
          identifier.number = acc.length + 1;
          identifier.width = rect.width;
          identifier.height = rect.height;
          identifier.display = style.display;
          identifier.visibility = style.visibility;
          identifier.offset = element.offsetParent === null;
          console.log(identifier);
        }
        return acc;
      }, []);
    },
    results);
    console.log("filteredIdentifiers", filteredIdentifiers);
    await insertLabels(filteredIdentifiers);

    return filteredIdentifiers;
  }

  async function insertLabels(identifiers) {
    await page.evaluate(insertContainerLabels, identifiers);
  }
  async function clearInsertedLabels() {
    await page.evaluate(() => {
      const elements = document.querySelectorAll(".inserted-identifiers");
      elements.forEach((element) => element.remove());
    });
  }

  async function addLabels(identifiers) {
    await page.evaluate(setLabels, identifiers);
    internalState.labeledElements = identifiers;
  }

  async function clearLabels() {
    const test = await page.evaluate(() => {
      const elementToRemove = document.getElementById("cambrian-ai-labels"); // Replace '.className' with the class name of the elements you want to remove
      if (elementToRemove) elementToRemove.remove();
      else return true;
    });
    if (test) console.log("failed to remove labels <--------------");
    internalState.labeledElements = [];
  }
  function isUnderScreenSize(selector) {
    return page.evaluate((selector) => {
      const element = document.querySelector(selector);
      if (!element) return false;

      const elementRect = element.getBoundingClientRect();
      const screenWidth = window.innerWidth;
      const screenHeight = window.innerHeight;

      return elementRect.width <= screenWidth && elementRect.height <= screenHeight;
    }, selector);
  }
  async function clearSections() {
    await page.evaluate(() => {
      const elementToRemove = document.getElementById("cambrian-ai-sections"); // Replace '.className' with the class name of the elements you want to remove
      if (elementToRemove) elementToRemove.remove();
    });
    internalState.containers = [];
    return "Clearing search containers";
  }

  async function setupSections() {
    const pageSectionData = await page.evaluate(setupPageSections);
    console.log("pageSectionData-->", pageSectionData);
    Object.assign(internalState, pageSectionData);
    return pageSectionData;
  }
  async function getCurrentSection() {
    const currentSection = await page.evaluate(() => {
      const windowHeight = window.innerHeight / 2;
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop;

      const currentSection = Math.round(((scrollTop + 1) / windowHeight) * 100) / 100;

      return currentSection;
    });
    return currentSection + 1;
  }

  async function setContainers(chunkSize, elementLimit) {
    console.log("internalState.containers.length", internalState.containers.length);
    if (internalState.containers.length) return await showContainers();

    internalState.containers = await page.evaluate(
      getContentContainers,
      chunkSize,
      elementLimit
    );
    //console.log("internalState.containers", internalState.containers);

    await page.evaluate(setContentContainers, internalState.containers);
    return "setting search containers";
  }
  async function insertContainer(container) {
    await page.evaluate(setContentContainers, [container]);
  }
  async function clearContainers() {
    await page.evaluate(() => {
      const elementToRemove = document.getElementById("cambrian-ai-containers"); // Replace '.className' with the class name of the elements you want to remove
      if (elementToRemove) elementToRemove.remove();
    });
    internalState.containers = [];
    return "Clearing search containers";
  }

  async function selectElement(identifier, isContainer) {
    const { selector } = identifier;
    console.log("selectElement", identifier);

    const elementHandler = await page.$(selector);

    if (elementHandler) {
      internalState.selectedElement = undefined;
      if (internalState.showSelection)
        await page.evaluate(setSelection, elementHandler, isContainer);
      internalState.selectedElement = identifier;
      return elementHandler;
    }
  }

  async function clearSelection() {
    await page.evaluate(() => {
      const elementToRemove = document.getElementById("cambrian-ai-selection"); // Replace '.className' with the class name of the elements you want to remove
      if (elementToRemove) elementToRemove.remove();
    });
    internalState.selectedElement = undefined;
    return internalState;
  }
  async function click(identifier = [internalState.selectedElement]) {
    await page.click(identifier.selector);
  }
  async function type(identifier = [internalState.selectedElement], text) {
    const element = await selectElement(identifier);
    if (element) {
      element.type(text, { delay: 100 });
      return true;
    }
  }
  async function getHtml(selector = internalState.selectedElement) {
    const element = await page.$(selector);
    return await page.evaluate((element) => element.outerHTML, element);
  }
  async function getInnerText(selector = internalState.selectedElement) {
    const element = await page.$(selector);
    return await page.evaluate((element) => element.textContent, element);
  }

  async function scrollUp(multiple = 1) {
    internalState.scrollEnded = false;
    await page.evaluate((multiple) => {
      window.scrollBy(0, -(window.innerHeight / 2) * multiple);
      return document.body.scrollHeight;
    }, multiple);
    return await getCurrentSection();
  }
  async function goToSection(sectionNumber) {
    await page.evaluate((sectionNumber) => {
      const windowHeight = window.innerHeight / 2;
      const targetScrollTop = windowHeight * (sectionNumber - 1);
      window.scrollTo(0, targetScrollTop);
    }, sectionNumber);
  }
  async function scrollDown(multiple = 1) {
    internalState.scrollEnded = false;
    await page.evaluate((multiple) => {
      window.scrollBy(0, (window.innerHeight / 2) * multiple);
      return document.body.scrollHeight;
    }, multiple);
    return await getCurrentSection();
  }
  async function getScreenshot(fullPage = false) {
    const path = `${process.cwd()}/screenshots/${Date.now()}.png`;
    await page.screenshot({ path, fullPage, captureBeyondView: false });
    return path;
  }

  async function captureElement(selector, containerOnly) {
    const clip = await page.evaluate(
      (selector, containerOnly) => {
        const scrollOffsetX = window.pageXOffset || document.documentElement.scrollLeft;
        const scrollOffsetY = window.pageYOffset || document.documentElement.scrollTop;
        const element = document.querySelector(selector);
        const { x, y, width, height } = element.getBoundingClientRect();

        if (containerOnly) {
          return {
            x: x + scrollOffsetX - 5,
            y: y + scrollOffsetY - 10,
            width: width + 10,
            height: height + 20,
          };
        } else {
          return {
            x: 0,
            y: y + scrollOffsetY - 10,
            width: window.innerWidth,
            height: height + 20,
          };
        }
      },
      selector,
      containerOnly
    );
    const path = `${process.cwd()}/screenshots/${Date.now()}.png`;
    await page.screenshot({ clip, path });
    return path;
  }

  async function captureContainer(number, containerOnly) {
    console.log("number", number, internalState.containers.length);
    const { selector } = getContainer(number);
    return await captureElement(selector, containerOnly);
  }
  async function toggleContainers(input, show = true, excludeNumber) {
    console.log("input", input);
    const numbers = !input
      ? internalState.containers
          .filter(({ containerNumber }) => excludeNumber !== containerNumber)
          .map(({ containerNumber }) => containerNumber)
      : Array.isArray(input)
      ? input
      : [input];
    console.log("numbers", numbers);
    const display = show ? "initial" : "none";
    const hidden = await page.evaluate(
      (numbers, display) => {
        for (number of numbers) {
          const selector = `#container_${number}`;
          const element = document.getElementById(selector);
          if (element) element.style.display = display;
        }
      },
      numbers,
      display
    );
    return hidden;
  }
  async function hideContainers(input, excludeNumber) {
    return toggleContainers(input, false, excludeNumber);
  }
  async function showContainers(input, excludeNumber) {
    return toggleContainers(input, true, excludeNumber);
  }
  async function searchSelectors(description = "", where) {
    const domain = parseDomain(page.url());
    return await selectorStore.search(domain, description, 5, where);
  }
  async function getSelectors(where) {
    const domain = parseDomain(page.url());
    return await selectorStore.get(domain, where);
  }
  async function saveSelectors(identifiers) {
    const newIdentifiers = Array.isArray(identifiers) ? identifiers : [identifiers];
    const domain = parseDomain(page.url());
    await selectorStore.save(domain, newIdentifiers);
  }
  async function deleteIdentifiers(identifiers) {
    const domain = parseDomain(page.url());
    await selectorStore.delete(domain, identifiers);
  }
  async function saveIdentifier(identifier, element) {
    console.log("saveIdentifier", identifier);
    if (identifier.usage) {
      identifier.usage++;
    } else {
      identifier.usage = 1;
      identifier.anchors = await getPotentialAnchors(identifier, element);
    }
    if (identifier.anchors)
      if (identifier.usage > 3) {
        identifier.anchors = "";
        identifier.subSelector = "";
        identifier.positionRefresh = "static";
      } else if (identifier.usage > 1) {
        identifier.anchors = await removeInvalidAnchors(identifier, element);
      }
    const domain = parseDomain(page.url());
    await selectorStore.save(domain, [identifier]);
  }
  async function searchCache(description = "", where) {
    const domain = `${parseDomain(page.url())}-cache`;
    return await selectorStore.search(domain, description, 20, where);
  }
  async function clearCache() {
    const domain = `${parseDomain(page.url())}-cache`;
    return await selectorStore.clear(domain);
  }
  async function cacheSelectors(identifiers) {
    const domain = `${parseDomain(page.url())}-cache`;
    const newIdentifiers = Array.isArray(identifiers) ? identifiers : [identifiers];
    await selectorStore.save(domain, newIdentifiers);
  }

  function onPageLoad(handler) {
    page.on("load", handler);
  }
  async function scrollIntoView(selector) {
    await page.evaluate((selector) => {
      const element = document.querySelector(selector);
      if (element) {
        element.scrollIntoView();
      }
    }, selector);
  }

  async function showRecorder() {
    hideSidePanel();
    await clearContainers();
    await setContainers();

    const interactiveElements = await page.evaluate(
      getInteractiveElements,
      internalState.containers,
      both
    );
    await page.evaluate(insertRecorder, interactiveElements);
  }
  async function showMemory() {
    const memory = await getSelectors();
    const filteredMemory = await pageFilter(memory);
    await clearContainers();
    await setContainers();
    await hideContainers();
    const identifiedContainers = [];
    const uniqueContainers = [];
    const identifiers = [];
    let number = 1;
    for (const item of filteredMemory) {
      const container = await addContainer(item.container);
      const { containerNumber } = container;

      if (!uniqueContainers.includes(containerNumber)) {
        identifiedContainers.push(container);
        uniqueContainers.push(containerNumber);
      }

      identifiers.push({ ...item, number, containerNumber });
      number++;
    }
    await showContainers(
      identifiedContainers.map(({ containerNumber }) => containerNumber)
    );
    console.log("identifiers", identifiers);
    await insertLabels(identifiers);
    await page.evaluate(insertSidePanel, identifiers);
    await page.evaluate(injectMemoryDisplay, identifiers);
  }
  async function insertChatMessage(input) {
    const { WebAssistant } = internalState.agents;

    console.log("WebAssistant, input", WebAssistant, input);
    if (WebAssistant) {
      try {
        const res = await WebAssistant.invoke(input, webAssistantState);
        console.log("res", res);
        await showChat();
      } catch (error) {
        console.log("InsertChatMessage ERROR", error);
      }
    } else {
      console.error("Error:WebAssistant Agent not setup");
    }
  }
  // const messages = [
  //   {
  //     sender: "bot",
  //     text: "Hello! Welcome to the Cambrian AI assistant. How can I help you today?",
  //   },
  // ]
  async function showChat() {
    const { WebAssistant } = internalState.agents;
    const messages = WebAssistant.getNormalizedMessages();
    console.log("WebAssistant messages", messages);
    await page.evaluate(insertSidePanel);
    await page.evaluate(insertChatbot, messages.slice(1));
  }
  async function showSidePanel() {
    await page.evaluate(insertSidePanel);
  }
  async function showLoading(tasklist) {
    await page.evaluate(insertLoadingComponent, tasklist);
  }

  async function clearLoading(containerId = "cambrian-ai-loading-component-container") {
    await page.evaluate((containerId) => {
      const loadingComponent = document.getElementById(containerId); // Replace '.className' with the class name of the elements you want to remove
      if (loadingComponent) loadingComponent.remove();
    }, containerId);
  }
  async function hideSidePanel() {
    await page.evaluate(() => {
      const sidePanel = document.getElementById("cambrianAiSidePanelWrapper"); // Replace '.className' with the class name of the elements you want to remove
      if (sidePanel) sidePanel.style.display = "none";
    });
  }
  async function filterPotentialAnchors(identifier) {
    return await page.evaluate(filterAnchors, identifier);
  }

  async function getPotentialAnchors(identifier, elementHandler) {
    return await page.evaluate(getAnchors, identifier, elementHandler);
  }
  async function removeInvalidAnchors(identifier, elementHandler) {
    return await page.evaluate(
      ({ anchors, subSelector }, element) =>
        anchors
          .split(",")
          .filter((selector) => element.matches(`${selector} ${subSelector}`))
          .join(","),
      identifier,
      elementHandler
    );
  }
  async function injectMarkDown() {
    return await page.evaluate(injectMarkdownResources);
  }
  return {
    init,
    page: () => page,
    navigate,
    click,
    type,
    scrollUp,
    scrollDown,
    getScreenshot,
    setContainers,
    getLabeledElement,
    clearContainers,
    clearSelection,
    selectElement,
    getInnerText,
    getHtml,
    state,
    getContainer,
    getContainers,
    searchPage,
    findContainers,
    addContainer,
    captureElement,
    captureContainer,
    hideContainers,
    searchSelectors,
    getSelectors,
    searchCache,
    clearCache,
    saveSelectors,
    saveIdentifier,
    cacheSelectors,
    showContainers,
    toggleContainers,
    clearLabels,
    clearInsertedLabels,
    addLabels,
    insertLabels,
    onPageLoad,
    scrollIntoView,
    showRecorder,
    setupSections,
    getCurrentSection,
    goToSection,
    clearSections,
    viewFilter,
    pageFilter,
    filterPotentialAnchors,
    getPotentialAnchors,
    removeInvalidAnchors,
    showMemory,
    showChat,
    showSidePanel,
    hideSidePanel,
    showLoading,
    clearLoading,
    deleteIdentifiers,
    compareIdentifiers: selectorStore.quickSearch,
    getElementDescriptions: function (params) {
      params.driver = driver;
      return getElementDescriptions(params);
    },
  };
}
function parseDomain(url) {
  // Regular expression to match domain from URL
  var domainRegex = /^(?:https?:\/\/)?(?:[^@\n]+@)?(?:www\.)?([^:\/\n?]+)/gi;

  // Executing the regex on the URL
  var matches = domainRegex.exec(url);

  // Extracting the domain from the matched groups
  var domain = matches && matches.length > 1 ? matches[1] : null;

  // Replace all occurrences of "." with "_"
  return domain ? domain.replace(/\./g, "_") : null;
}
const driver = browserController();
export default driver;

// fix the style
//- add a color button in the header to match with the recorder
//- adjust the style and placement
//-
