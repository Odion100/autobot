import puppeteer from "puppeteer";
import getContentContainers from "./getContentContainers.js";
import addContentContainers from "./addContentContainers.js";
import setSelection from "./setSelection.js";
import htmlVectorSearch from "./htmlVectorSearch.js";

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
        browserState.actions.push(`Navigated to ${page.url()}`);
        browserState.selectedElement = "";
        browserState.selectedContainers = [];
      });
    }

    await page.setViewport({ width: 0, height: 0 });
    await page.goto(url);

    const lastPage = browserState.currentPage;
    return `Navigated to ${page.url()}`;
  }
  async function setContainers() {
    if (containers.length) return "search containers already set";
    const html = await page.content();
    containers = getContentContainers(html);
    await page.evaluate(addContentContainers, containers);
    return "setting search containers";
  }
  const clickable =
    'a, [onclick], button, input[type="button"], [type="submit"], [type="reset"], [type="image"], [type="file"], [type="checkbox"], [type="radio"], select, option';

  const typeable = 'input[type="text"], textarea';
  const elementType = { clickable, typeable };
  async function searchContainer(number, searchText, target = "none") {
    const selector = getContainer(number);
    const html = await getHtml(selector);
    const results = await htmlVectorSearch(html, searchText, 3, elementType[target]);

    if (results[0]) {
      console.log("results", results, results[0].selector, Object.keys(results[0]));
      await selectElements(results[0].selector);
      return true;
    } else {
      return false;
    }
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

  async function selectElements(selector, description = "element") {
    console.log("selectElement", selector);
    await clearSelection();
    await page.evaluate(setSelection, [selector]);
    browserState.selectedElement = selector;
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
  };
}
const driver = browserController();
export default driver;
