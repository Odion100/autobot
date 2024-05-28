import puppeteer from "puppeteer";
import getContentContainers from "./getContentContainers.js";
import setContentContainers from "./setContentContainers.js";
import setSelection from "./setSelection.js";
import htmlVectorSearch from "./htmlVectorSearch.js";
import getViewport from "./getViewport.js";
import selectorStore from "./selectorStore.js";
import setLabels from "./setLabels.js";
import insertContainerLabels from "./insertContainerLabels.js";

function browserController() {
  let browser;
  let page;
  const browserState = {
    currentPage: "",
    lastPage: "",
    actions: [],
    selectedElement: undefined,
    selectedContainers: [],
    scrollHeight: 0,
    containers: [],
    labeledElements: [],
    showSelection: true,
  };
  const state = () => browserState;
  const getContainer = (n) => browserState.containers[n - 1];
  const getLabeledElement = (n) => browserState.labeledElements[n - 1];
  async function navigate(url) {
    if (!browser) {
      browser = await puppeteer.launch({ headless: false, args: ["--start-maximized"] });
      page = await browser.newPage();
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
        await searchContainers();
        await selectorStore.clear("active-page");
      });
    }

    await page.setViewport({ width: 0, height: 0 });
    await page.goto(url);

    browserState.lastPage = browserState.currentPage;
    return `You have navigated to ${page.url()}`;
  }

  const clickable =
    'a, [onclick], button, input[type="button"], [type="submit"], [type="reset"], [type="image"], [type="file"], [type="checkbox"], [type="radio"]';

  const typeable = "input, textarea";
  const both = clickable + ", " + typeable;
  const elementType = { clickable, typeable, both };

  async function searchContainers(containers = [], searchText, target = "both") {
    return await htmlVectorSearch(containers, searchText, 5, both);
  }
  async function searchPage(searchText, target = "both") {
    await setContainers();
    await clearInsertedLabels();
    const viewportContainers = await page.evaluate(getViewport, browserState.containers);
    console.log("viewportContainers-->", viewportContainers.length);
    const { results } = await searchContainers(viewportContainers, searchText, target);
    if (!results.length) return;
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
            width <= 1 ||
            height <= 1 ||
            style.display === "none" ||
            style.visibility === "hidden" ||
            element.offsetParent === null
          )
        ) {
          identifier.number = acc.length + 1;
          identifier.width = rect.width;
          identifier.height = rect.height;
          identifier.display = style.display;
          identifier.visibility = style.visibility;
          identifier.offset = element.offsetParent === null;
          acc.push(identifier);
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
  async function updateLabels(updates = [], type = "labeledElements") {
    const updatedLabels = [];
    const labels = browserState[type];
    const newLabels = Array.isArray(updates) ? updates : [updates];
    for (const newLabel of newLabels) {
      const oldLabel = labels[newLabel.number - 1];
      if (oldLabel) {
        Object.assign(oldLabel, newLabel);
        updatedLabels.push(oldLabel);
      }
    }

    const labelSelector =
      type === "labeledElements" ? "#cambrian-ai-labels" : "#cambrian-ai-containers";
    await page.evaluate(
      (updatedLabels, labelSelector) => {
        for (const label of updatedLabels) {
          const selector = `${labelSelector} > div:nth-child(${label.number}) > div.box-label`;
          const element = document.querySelector(selector);
          if (element) element.textContent = label.label;
        }
      },
      updatedLabels,
      labelSelector
    );
    await selectorStore.save("active-page", updatedLabels);
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
  async function setContainers(chunkSize, elementLimit) {
    if (browserState.containers.length) return await showContainers();

    const html = await page.content();
    browserState.containers = getContentContainers(html, chunkSize, elementLimit);

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

  async function selectElement(identifier, shouldSave) {
    const { selector, additionalSelectors = [] } = identifier;
    const selectors = [selector, ...additionalSelectors];
    let elementHandler;
    console.log("selectElement", identifier, selectors);
    for (const selector of selectors) {
      elementHandler = await page.$(selector);
      if (elementHandler) {
        if (selector !== identifier.selector) {
          identifier.additionalSelectors.unshift(identifier.selector);
          identifier.selector = selector;
          identifier.additionalSelectors.filter((s) => s !== selector);
          saveSelectors(identifier);
        } else if (shouldSave) saveSelectors(identifier);
        break;
      }
    }

    if (elementHandler) {
      browserState.selectedElement = undefined;
      if (browserState.showSelection) await page.evaluate(setSelection, elementHandler);
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

  async function scrollUp() {
    browserState.scrollEnded = false;
    const scrollHeight = await page.evaluate(() => {
      window.scrollBy(0, -window.innerHeight);
      return document.body.scrollHeight;
    });
    if (scrollHeight === browserState.scrollHeight) return "scroll complete";
    browserState.scrollHeight = scrollHeight;
    const action = `scrolling up`;
    browserState.actions.push(action);
    return action;
  }
  async function scrollDown() {
    browserState.scrollEnded = false;
    const scrollHeight = await page.evaluate(() => {
      window.scrollBy(0, window.innerHeight);
      return document.body.scrollHeight;
    });
    if (scrollHeight === browserState.scrollHeight) return "scroll complete";
    browserState.scrollHeight = scrollHeight;
    const action = `scrolling down`;
    browserState.actions.push(action);
    return action;
  }
  async function getScreenShot() {
    const path = `${process.cwd()}/screenshots/${Date.now()}.png`;
    await page.screenshot({ path });
    browserState.actions.push("getting screen shot");
    return path;
  }

  async function captureElement(selector) {
    const clip = await page.evaluate((selector) => {
      const element = document.querySelector(selector);
      const { x, y, width, height } = element.getBoundingClientRect();

      return { x, y, width, height };
    }, selector);
    const path = `${process.cwd()}/screenshots/${Date.now()}.png`;
    await page.screenshot({ clip, path });
    return path;
  }

  async function captureContainer(number) {
    const { selector } = getContainer(number);
    return await captureElement(selector);
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
  async function getSelector(description = "", { type, types = [], nIds }) {
    const filter = {};
    const targets = type ? [type] : types;
    if (targets.length) filter.type = { $in: targets };
    if (nIds) filter.id = { $nin: nIds };
    const domain = parseDomain(browserState.currentPage);
    const { results: savedIdentifiers, distances: dist } = await selectorStore.search(
      domain,
      description,
      1,
      filter
    );

    if (savedIdentifiers.length) {
      console.log("savedIdentifier x", savedIdentifiers[0], dist[0]);
      if (dist[0] <= 0.45) return savedIdentifiers[0];
    }

    const { results: activeIdentifiers, distances } = await selectorStore.search(
      "active-page",
      description,
      1,
      filter
    );

    if (activeIdentifiers.length) {
      console.log("activeIdentifier x", activeIdentifiers[0], distances[0]);
      if (distances[0] <= 0.45) return activeIdentifiers[0];
    }
  }
  async function saveSelectors(identifiers) {
    const newIdentifiers = Array.isArray(identifiers) ? identifiers : [identifiers];
    const domain = parseDomain(browserState.currentPage);
    await selectorStore.save(domain, newIdentifiers);
  }
  async function cacheSelectors(identifiers) {
    const newIdentifiers = Array.isArray(identifiers) ? identifiers : [identifiers];
    await selectorStore.save("active-page", newIdentifiers);
  }
  function onPageLoad(handler) {
    page.on("load", handler);
  }
  return {
    navigate,
    click,
    type,
    scrollUp,
    scrollDown,
    getScreenShot,
    setContainers,
    getLabeledElement,
    clearContainers,
    clearSelection,
    selectElement,
    getInnerText,
    getHtml,
    state,
    getContainer,
    searchPage,
    searchContainers,
    captureElement,
    captureContainer,
    hideContainers,
    getSelector,
    saveSelectors,
    cacheSelectors,
    showContainers,
    toggleContainers,
    clearLabels,
    addLabels,
    updateLabels,
    insertLabels,
    onPageLoad,
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
