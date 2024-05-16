import puppeteer from "puppeteer";
import getContentContainers from "./getContentContainers.js";
import addContentContainers from "./addContentContainers.js";
import setSelection from "./setSelection.js";
import htmlVectorSearch from "./htmlVectorSearch.js";
import selectorStore from "./selectorStore.js";
import addLabels from "./addLabels.js";

function browserController() {
  let browser;
  let page;
  const browserState = {
    currentPage: "",
    lastPage: "",
    actions: [],
    selectedElement: "",
    selectedContainers: [],
    scrollHeight: 0,
    containers: [],
    labeledElements: [],
  };
  const state = () => browserState;
  const getContainer = (n) => browserState.containers[n - 1];
  const getLabeledElement = (n) => browserState.labeledElements[n - 1];
  async function navigate(url) {
    if (!browser) {
      browser = await puppeteer.launch({ headless: false, args: ["--start-maximized"] });
      page = await browser.newPage();
      page.on("load", function () {
        browserState.lastPage = browserState.currentPage;
        browserState.currentPage = url;
        browserState.actions.push(`You have navigated to ${page.url()}`);
        browserState.selectedElement = "";
        browserState.selectedContainers = [];
        browserState.containers = [];
        browserState.labeledElements = [];
        browserState.scrollHeight = 0;
      });
    }

    await page.setViewport({ width: 0, height: 0 });
    await page.goto(url);

    browserState.lastPage = browserState.currentPage;
    return `You have navigated to ${page.url()}`;
  }
  async function setContainers() {
    if (browserState.containers.length) return "search containers already set";
    const html = await page.content();
    browserState.containers = getContentContainers(html);
    await page.evaluate(addContentContainers, browserState.containers);
    return "setting search containers";
  }
  const clickable =
    'a, [onclick], button, input[type="button"], [type="submit"], [type="reset"], [type="image"], [type="file"], [type="checkbox"], [type="radio"]';

  const typeable = "input, textarea";
  const both = clickable + ", " + typeable;
  const elementType = { clickable, typeable, both };

  async function searchContainer(number, searchText, target = "none") {
    const { selector } = getContainer(number);
    const html = await getHtml(selector);
    const results = await htmlVectorSearch(html, searchText, 5, elementType[target]);

    if (results[0]) {
      console.log("results", results, results[0].selector, Object.keys(results[0]));
      const s = results[0].selector.replace("body", selector);
      const selectors = results.map(({ selector: s }) => s.replace("body", selector));
      console.log("selectors", selectors);
      await setLabels(results);
      return true;
    } else {
      return false;
    }
  }
  async function updateLabels(updates = [], type = "labeledElements") {
    console.log("updates--->", updates);
    console.log(type, browserState[type]);
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
    console.log("updatedLabels", updatedLabels);

    const labelSelector =
      type === "labeledElements" ? "#cambrian-ai-labels" : "#cambrian-ai-containers";
    await page.evaluate(
      (updatedLabels, labelSelector) => {
        for (const label of updatedLabels) {
          const selector = `${labelSelector} > div:nth-child(${label.number}) > div.box-label`;
          console.log("selector4", selector);
          const element = document.querySelector(selector);
          if (element) element.textContent = label.label;
        }
      },
      updatedLabels,
      labelSelector
    );
    console.log(type, browserState[type]);
  }

  async function setLabels(selection) {
    await clearLabels();
    await page.evaluate(addLabels, selection);
    browserState.labeledElements = selection;
  }
  async function clearLabels() {
    await page.evaluate(() => {
      const elementToRemove = document.getElementById("cambrian-ai-labels"); // Replace '.className' with the class name of the elements you want to remove
      if (elementToRemove) elementToRemove.remove();
    });
    browserState.labeledElements = [];
    return "Clearing search containers";
  }
  async function clearContainers() {
    await page.evaluate(() => {
      const elementToRemove = document.getElementById("cambrian-ai-containers"); // Replace '.className' with the class name of the elements you want to remove
      if (elementToRemove) elementToRemove.remove();
    });
    browserState.containers = [];
    return "Clearing search containers";
  }

  async function selectElements(selectors, description = "element") {
    browserState.selectedContainers = [];
    browserState.selectedElement = "";
    await page.evaluate(setSelection, selectors);
    browserState.selectedElement = selectors;
    const action = `Selecting ${description}.`;
    browserState.actions.push(action);
    return action;
  }

  async function clearSelection() {
    await page.evaluate(() => {
      const elementToRemove = document.getElementById("cambrian-ai-selection"); // Replace '.className' with the class name of the elements you want to remove
      if (elementToRemove) elementToRemove.remove();
    });
    browserState.selectedContainers = [];
    browserState.selectedElement = "";
    return browserState;
  }
  async function click(selector = browserState.selectedElement, description = "") {
    await page.click(selector);
    const action = `Clicked ${description}.`;
    browserState.actions.push(action);
    return action;
  }
  async function type(
    selector = browserState.selectedElement,
    text,
    description = "input"
  ) {
    await page.type(selector, text);
    const action = `typed "${text}" into ${description}`;
    browserState.actions.push(action);
    return action;
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
    if (scrollHeight === browserState.scrollHeight) return "scroll ended";
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
    if (scrollHeight === browserState.scrollHeight) return "scroll ended";
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

      return { x: x, y: y, width, height };
    }, selector);
    const path = `${process.cwd()}/screenshots/${Date.now()}.png`;
    await page.screenshot({ clip, path });
    return path;
  }

  async function captureContainer(number) {
    const { selector } = getContainer(number);
    return await captureElement(selector);
  }
  async function toggleContainers(input, show = true) {
    const numbers = !input
      ? browserState.containers.map((item, i) => i + 1)
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
  async function hideContainers(input) {
    return toggleContainers(input, false);
  }
  async function showContainers(input) {
    return toggleContainers(input);
  }
  async function getSelector(description = "") {
    const url = browserState.currentPage;
    const selectors = await selectorStore.get(url, description);
    if (selectors.length) return selectors[0].selector;
  }
  async function saveSelectors(selectors) {
    const newSelectors = Array.isArray(selectors) ? selectors : [labels];
    const url = browserState.currentPage;
    await selectorStore.save(url, newSelectors);
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
    selectElements,
    getInnerText,
    getHtml,
    state,
    getContainer,
    searchContainer,
    captureElement,
    captureContainer,
    hideContainers,
    getSelector,
    saveSelectors,
    showContainers,
    toggleContainers,
    clearLabels,
    setLabels,
    updateLabels,
  };
}
const driver = browserController();
export default driver;
