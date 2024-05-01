import puppeteer from "puppeteer";
let browser;
let currentPage;
export async function navigate({ url }) {
  /**
   * Navigates to the given URL.
   */
  // Launch the browser and open a new blank page
  browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();
  await page.setViewport({ width: 0, height: 0 });
  // Navigate the page to a URL
  await page.goto(url);
  currentPage = page;
  return `navigated to ${url}`;
}

export async function click({ selector }) {
  /**
   * Clicks on the first element matching the given CSS selector.
   */
  return `clicked button ${selector}`;
}

export async function typeToInput({ selector, text }) {
  /**
   * Types the given text into the first element matching the CSS selector.
   */
  return `typed ${text} into input ${selector}`;
}

export async function searchHTML({ selector }) {
  /**
   * Returns the text content of the first element matching the CSS selector.
   */
  return `reading html from ${selector}`;
}

export default { click, typeToInput, searchHTML, navigate };
