import puppeteer from "puppeteer";
import getContentContainers from "./getContentContainers";
import addContentContainers from "./addContentContainers";
import setSelection from "./setSelection";

function browserController() {
  let browser;
  let page;
  let containers = [];
  const browserState = {
    currentPage: "",
    lastPage: "",
    previousAction: [],
    selectedElement: "",
    selectedContainers: [],
    containers: [],
  };
  const state = () => browserState;
  async function navigate(url) {
    if (!browser) {
      browser = await puppeteer.launch({ headless: false, args: ["--start-maximized"] });
      page = await browser.newPage();
      page.on("load", function () {
        browserState.currentPage = url;
        browserState.lastPage = lastPage;
        browserState.previousAction.push(`Navigated to ${page.url()}`);
      });
    }

    await page.setViewport({ width: 0, height: 0 });
    await page.goto(url);

    const lastPage = browserState.currentPage;
    return browserState;
  }
  async function setContainers() {
    if (containers.length) return containers;
    const html = await page.content();
    browserState.containers = getContentContainers(html);
    await page.evaluate(addContentContainers, containers);
    return browserState;
  }

  async function clearContainers() {
    await page.evaluate(() => {
      const elementToRemove = document.getElementById("cambrian-ai-containers"); // Replace '.className' with the class name of the elements you want to remove
      if (elementToRemove) elementToRemove.remove();
    });
    browserState.containers = [];
    return browserState;
  }
  async function selectContainers(numbers) {
    const selectors = numbers.map(
      (number) => browserState.containers[number - 1].container
    );
    await page.evaluate(setSelection, selectors);
    browserState.selectedContainers.push(...selectors);
    return browserState;
  }

  async function selectElements(selector) {
    await page.evaluate(setSelection, [selector]);
    browserState.selectedElement = selector;
    return browserState;
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
  async function click(selector) {
    await page.click(selector);
    browserState.previousAction.push("clicked button");
    return browserState;
  }
  async function type(selector, text) {
    await page.type(selector, text);
    browserState.previousAction.push(`typed "${text}" into input`);
    return browserState;
  }
  async function getHtml(selector) {
    const element = await page.$(selector);
    return await page.evaluate((element) => element.outerHTML, element);
  }
  async function getInnerText(selector) {
    const element = await page.$(selector);
    return await page.evaluate((element) => element.textContent, element);
  }

  async function scrollUp() {
    await page.evaluate(() => {
      window.scrollBy(0, 500); // Scroll down by 500 pixels
    });
    browserState.previousAction.push(`scrolled up`);
    return browserState;
  }
  async function scrollDown() {
    await page.evaluate(() => {
      window.scrollBy(0, 500); // Scroll down by 500 pixels
    });
    browserState.previousAction.push(`scrolled down`);
    return browserState;
  }
  async function getScreenShot() {
    const path = `${__dirname}/screenshots/${Date.now()}.png`;
    await page.screenshot({ path });
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
  };
}
const driver = browserController();
export default driver;
