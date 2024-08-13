import puppeteer from "puppeteer";
import getContentContainers from "./getContentContainers.js";
import getInteractiveElements from "./getInteractiveElements.js";
import getAnchors from "./getAnchors.js";
import filterAnchors from "./filterAnchors.js";
import setContentContainers from "./setContentContainers.js";
import setSelection from "./setSelection.js";
import setupPageSections from "./setupPageSections.js";
import htmlVectorSearch from "./htmlVectorSearch.js";
import getViewport from "./getViewport.js";
import selectorStore from "./selectorStore.js";
import setLabels from "./setLabels.js";
import insertContainerLabels from "./insertContainerLabels.js";
import getElementDescriptions from "./getElementDescriptions.js";

function browserController() {
  let browser;
  let page;
  const browserState = {
    currentPage: "",
    totalSections: 0,
    lastPage: "",
    actions: [],
    selectedElement: undefined,
    selectedContainers: [],
    scrollHeight: 0,
    containers: [],
    labeledElements: [],
    showSelection: true,
    interactions: [],
  };
  const state = () => browserState;
  const getContainer = (n) => browserState.containers[n - 1];
  const getContainers = (numbers) => {
    return browserState.containers.filter(({ containerNumber }) =>
      numbers.includes(containerNumber)
    );
  };
  const getLabeledElement = (n) => browserState.labeledElements[n - 1];
  async function navigate(url) {
    if (!browser) {
      browser = await puppeteer.launch({ headless: false, args: ["--start-maximized"] });
      page = (await browser.pages())[0];
      // Set up communication channel between browser and Node.js
      await page.exposeFunction("saveInteraction", (interaction) => {
        if (Array.isArray(interaction)) {
          browserState.interactions = interaction;
          clearInsertedLabels().then(() => insertLabels(interaction));
        } else {
          browserState.interactions.push(interaction);
          insertLabels([interaction]);
        }

        console.log("Interaction recorded:", interaction);
      });

      await page.exposeFunction("recordingComplete", async (interaction) => {
        if (browserState.interactions.length) {
          const { elementDescriptions } = await getElementDescriptions({
            targetElements: browserState.interactions,
          });
          clearContainers();
          await saveSelectors(elementDescriptions);
          browserState.interactions = [];
        }

        console.log("Interaction recorded:", interaction);
      });
      page.on("load", async function () {
        console.log("page load event --->");
        browserState.lastPage = browserState.currentPage;
        browserState.currentPage = url;
        browserState.actions.push(`You have navigated to ${page.url()}`);
        browserState.selectedElement = undefined;
        browserState.selectedContainers = [];
        browserState.containers = [];
        browserState.labeledElements = [];
        browserState.scrollHeight = 0;
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

    browserState.lastPage = browserState.currentPage;
    return `You have navigated to ${page.url()}`;
  }

  async function findContainers(searchText, where) {
    const viewportContainers = await page.evaluate(getViewport, browserState.containers);
    // console.log("viewportContainers <----", viewportContainers);
    return await htmlVectorSearch.findContainers(
      viewportContainers,
      searchText,
      where,
      5
    );
  }
  function addContainer(selector) {
    const existingContainer = browserState.containers.find(
      (container) => selector === container.selector
    );
    if (existingContainer) return existingContainer;
    const container = {
      containerNumber: browserState.containers.length + 1,
      html: "",
      innerText: "",
      selector,
    };

    browserState.containers.push(container);
    return container;
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
      : await viewFilter(browserState.containers);

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
  //1. insert label into the container so that they are hidden with them
  // - create a function called insertLabels
  // - container number must be added in the getContentContainers function
  // - containerNumber must then be added to the htmlVectorSearch
  // - it will take a list of identifiers and use the containerNumber to insert it
  // - show and hide only the target container when getting descriptions
  // - hideContainers and show... need to loop through all containers
  // - hideContainers needs a excludeNumber for the second parameter
  //--next
  // add getScreen shot method to the BrowserController
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
    browserState.labeledElements = identifiers;
  }

  async function clearLabels() {
    const test = await page.evaluate(() => {
      const elementToRemove = document.getElementById("cambrian-ai-labels"); // Replace '.className' with the class name of the elements you want to remove
      if (elementToRemove) elementToRemove.remove();
      else return true;
    });
    if (test) console.log("failed to remove labels <--------------");
    browserState.labeledElements = [];
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
    browserState.containers = [];
    return "Clearing search containers";
  }

  async function setupSections() {
    const pageSectionData = await page.evaluate(setupPageSections);
    console.log("pageSectionData-->", pageSectionData);
    Object.assign(browserState, pageSectionData);
    return pageSectionData;
  }
  async function getCurrentSection() {
    const currentSection = await page.evaluate(() => {
      const windowHeight = window.innerHeight / 2;
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop;

      const currentSection = Math.round(((scrollTop + 1) / windowHeight) * 100) / 100;

      return currentSection;
    });
    console.log(
      "currentSection-->",
      browserState.totalSections - currentSection,
      typeof currentSection
    );
    return currentSection + 1;
  }

  async function setContainers(chunkSize, elementLimit) {
    if (browserState.containers.length) return await showContainers();

    const html = await page.content();
    browserState.containers = await page.evaluate(
      getContentContainers,
      chunkSize,
      elementLimit
    );

    await page.evaluate(setContentContainers, browserState.containers);
    return "setting search containers";
  }
  async function clearContainers() {
    await page.evaluate(() => {
      const elementToRemove = document.getElementById("cambrian-ai-containers"); // Replace '.className' with the class name of the elements you want to remove
      if (elementToRemove) elementToRemove.remove();
    });
    browserState.containers = [];
    return "Clearing search containers";
  }

  async function selectElement(identifier, isContainer) {
    const { selector } = identifier;
    console.log("selectElement", identifier);

    const elementHandler = await page.$(selector);

    if (elementHandler) {
      browserState.selectedElement = undefined;
      if (browserState.showSelection)
        await page.evaluate(setSelection, elementHandler, isContainer);
      browserState.selectedElement = identifier;
      return elementHandler;
    }
  }

  async function clearSelection() {
    await page.evaluate(() => {
      const elementToRemove = document.getElementById("cambrian-ai-selection"); // Replace '.className' with the class name of the elements you want to remove
      if (elementToRemove) elementToRemove.remove();
    });
    browserState.selectedElement = undefined;
    return browserState;
  }
  async function click(identifier = [browserState.selectedElement]) {
    await page.click(identifier.selector);
  }
  async function type(identifier = [browserState.selectedElement], text) {
    const element = await selectElement(identifier);
    if (element) {
      element.type(text, { delay: 100 });
      return true;
    }
  }
  async function getHtml(selector = browserState.selectedElement) {
    const element = await page.$(selector);
    browserState.actions.push(`getting html from ${selector}`);
    return await page.evaluate((element) => element.outerHTML, element);
  }
  async function getInnerText(selector = browserState.selectedElement) {
    const element = await page.$(selector);
    browserState.actions.push(`getting inner text from ${selector}`);
    return await page.evaluate((element) => element.textContent, element);
  }

  async function scrollUp(multiple = 1) {
    browserState.scrollEnded = false;
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
    browserState.scrollEnded = false;
    await page.evaluate((multiple) => {
      window.scrollBy(0, (window.innerHeight / 2) * multiple);
      return document.body.scrollHeight;
    }, multiple);
    return await getCurrentSection();
  }
  async function getScreenshot(fullPage = false) {
    const path = `${process.cwd()}/screenshots/${Date.now()}.png`;
    await page.screenshot({ path, fullPage, captureBeyondView: false });
    browserState.actions.push("getting screen shot");
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
    console.log("number", number, browserState.containers.length);
    const { selector } = getContainer(number);
    return await captureElement(selector, containerOnly);
  }
  async function toggleContainers(input, show = true, excludeNumber) {
    const numbers = !input
      ? browserState.containers
          .filter(({ containerNumber }) => excludeNumber !== containerNumber)
          .map(({ containerNumber }) => containerNumber)
      : Array.isArray(input)
      ? input
      : [input];
    const display = show ? "initial" : "none";
    const hidden = await page.evaluate(
      (numbers, display) => {
        for (number of numbers) {
          const selector = `#cambrian-ai-containers > div:nth-child(${number})`;
          const element = document.querySelector(selector);
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

  async function startRecorder() {
    await setContainers();

    const interactiveElements = await page.evaluate(
      getInteractiveElements,
      browserState.containers
    );
    await page.evaluate((watchList) => {
      window.watchList = watchList;
      window.interactions = [];
      // Create and insert the recording control button
      const button = document.createElement("button");
      button.id = "recordingControl";
      //button.innerHTML = "&#9679;"; // Unicode for a large dot
      button.style.cssText = `
        position: fixed;
        top: 10px;
        right: 10px;
        z-index: 10000;
        width: 30px;
        height: 30px;
        background-color: #4CAF50;
        border: none;
        border-radius: 50%;
        font-size: 24px;
        display: flex;
        justify-content: center;
        align-items: center;
        cursor: pointer;
        opacity: .9;
        transition: background-color 0.3s ease;
      `;
      document.querySelector(`#cambrian-ai-containers`).appendChild(button);

      // Initialize recording state
      window.isRecording = false;

      // Function to handle clicks on interactive elements
      function clickHandler(event) {
        if (!window.isRecording) return;

        const element = event.target;
        const identifier = window.watchList.find(({ selector }) =>
          element.matches(selector)
        );

        if (identifier) {
          const alreadyClicked = window.interactions.find(
            ({ selector }) => identifier.selector === selector
          );
          if (alreadyClicked) {
            window.interactions = window.interactions
              .filter(({ selector }) => selector !== alreadyClicked.selector)
              .map((item, i) => ({ ...item, number: i + 1 }));
            window.saveInteraction(window.interactions);
          } else {
            console.log(element, "element");
            console.log(identifier, "identifier");
            window.interactions.push(identifier);
            window.saveInteraction({
              ...identifier,
              innerText: element.textContent,
              timestamp: new Date().toISOString(),
              number: window.interactions.length,
            });
          }
          event.stopImmediatePropagation();
          event.preventDefault();
        }
      }

      // Function to start recording
      function startRecording() {
        window.isRecording = true;
        document.addEventListener("click", clickHandler, true);
        button.style.backgroundColor = "#f44336"; // Red color for recording
        console.log("Recording started");
      }

      // Function to stop recording
      function stopRecording() {
        window.isRecording = false;
        document.removeEventListener("click", clickHandler, true);
        button.style.backgroundColor = "#4CAF50"; // Green color for not recording
        console.log("Recording stopped and event listeners removed");
        window.recordingComplete();
      }

      // Toggle recording state when button is clicked
      button.addEventListener("click", () => {
        if (window.isRecording) {
          stopRecording();
        } else {
          startRecording();
        }
      });
    }, interactiveElements);
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
  return {
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
    startRecorder,
    setupSections,
    getCurrentSection,
    goToSection,
    clearSections,
    viewFilter,
    pageFilter,
    filterPotentialAnchors,
    getPotentialAnchors,
    removeInvalidAnchors,
  };
}
function parseDomain(url) {
  // Regular expression to match domain from URL
  var domainRegex = /^(?:https?:\/\/)?(?:[^@\n]+@)?(?:www\.)?([^:\/\n?]+)/gi;

  // Executing the regex on the URL
  var matches = domainRegex.exec(url);

  // Extracting the domain from the matched groups
  var domain = matches && matches.length > 1 ? matches[1] : null;

  return domain.replace(".", "_");
}
const driver = browserController();
export default driver;
