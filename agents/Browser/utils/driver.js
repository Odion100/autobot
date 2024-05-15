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
  let containers = [];
  const browserState = {
    currentPage: "",
    lastPage: "",
    actions: [],
    selectedElement: "",
    selectedContainers: [],
    scrollHeight: 0,
    containers,
    labeledElements: [],
  };
  const state = () => browserState;
  const getContainer = (n) => containers[n - 1].container;
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
        containers = [];
      });
    }

    await page.setViewport({ width: 0, height: 0 });
    await page.goto(url);

    browserState.lastPage = browserState.currentPage;
    return `You have navigated to ${page.url()}`;
  }
  async function setContainers() {
    if (containers.length) return "search containers already set";
    const html = await page.content();
    containers = getContentContainers(html);
    await page.evaluate(addContentContainers, containers);
    return "setting search containers";
  }
  const clickable =
    'a, [onclick], button, input[type="button"], [type="submit"], [type="reset"], [type="image"], [type="file"], [type="checkbox"], [type="radio"]';

  const typeable = "input, textarea";
  const both = clickable + ", " + typeable;
  const elementType = { clickable, typeable, both };
  async function searchContainer(number, searchText, target = "none") {
    const selector = getContainer(number);
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
  async function setLabels(selection, type = "item") {
    browserState.labeledElements = [];
    await page.evaluate(addLabels, selection, type);
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
    containers = [];
    return "Clearing search containers";
  }
  async function selectContainers(numbers) {
    const selectors = numbers.map((number) => containers[number - 1].container);
    await page.evaluate(setSelection, selectors);
    browserState.selectedContainers.push(...selectors);
    return `Found and selected ${numbers.length} containers.`;
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
    const selector = getContainer(number);
    return await captureElement(selector);
  }
  async function toggleContainers(input, show = true) {
    const numbers = !input
      ? containers.map((item, i) => i + 1)
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
    return selectors[0];
  }
  async function saveSelector(selector = browserState.selectedElement, description = "") {
    const url = browserState.currentPage;
    await selectorStore.save(url, selector, description);
  }

  return {
    navigate,
    click,
    type,
    scrollUp,
    scrollDown,
    getScreenShot,
    setContainers,
    clearContainers,
    clearSelection,
    selectContainers,
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
    saveSelector,
    showContainers,
    toggleContainers,
    clearLabels,
    setLabels,
  };
}
const driver = browserController();
export default driver;
