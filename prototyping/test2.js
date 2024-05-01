import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import cheerio from "cheerio";

async function naturalLanguageSelector(url, queryTexts = [], nResults = 3) {
  const targetElements = await getPage({ url });
  console.log(path.join(process.cwd()), "---<> path is within");

  fs.writeFileSync(
    path.join(`${process.cwd()}/prototyping`, "test2.json"),
    JSON.stringify(targetElements, null, 2),
    "utf-8"
  );
  return console.log(targetElements.length);
}

async function getPage({ url }) {
  // Launch the browser and open a new blank page
  const browser = await puppeteer.launch({
    headless: false,
    args: ["--start-maximized"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 0, height: 0 });

  // Navigate the page to a URL
  await page.goto(url);

  // Get the HTML content of the page
  const html = await page.content();
  const contentContainers = parseHtml(html);

  const selector =
    "#search > div.s-desktop-width-max.s-desktop-content.s-opposite-dir.s-wide-grid-style.sg-row > div.sg-col-20-of-24.s-matching-dir.sg-col-16-of-20.sg-col.sg-col-8-of-12.sg-col-12-of-16 > div > span.rush-component.s-latency-cf-section > div.s-main-slot.s-result-list.s-search-results.sg-row > div.sg-col-4-of-24.sg-col-4-of-12.s-result-item.s-asin.sg-col-4-of-16.sg-col.s-widget-spacing-small.sg-col-4-of-20";

  // Get the position of the element using evaluate function
  const elementPosition = await page.evaluate((contentContainers) => {
    function getRect(element) {
      const rect = element.getBoundingClientRect();
      // Convert the position and dimensions to string values with "px" units
      return {
        top: `${rect.top}px`,
        left: `${rect.left}px`,
        bottom: `${rect.bottom}px`,
        right: `${rect.right}px`,
        width: `${rect.width - rect.width * 0.01}px`,
        height: `${rect.height - rect.height * 0.01}px`,
      };
    }

    function getAttributes(element) {
      const attributes = {};
      Array.from(element.attributes).forEach((attr) => {
        if (!["class", "id", "style"].includes(attr.name))
          attributes[attr.name] = attr.value;
      });
      return attributes;
    }
    let zIndex = 9999;
    let viewElement;
    contentContainers.forEach(({ container: selector }, i) => {
      const element = document.querySelector(selector);
      if (!element) return null; // Return null if element is not found
      const rect = getRect(element);
      // Add a red border with 2px width
      console.log("rect:", rect);
      const box = document.createElement("div");
      // Apply styles to the box
      zIndex--;
      box.style.position = "absolute";
      box.style.top = rect.top;
      box.style.left = rect.left;
      box.style.width = rect.width;
      box.style.height = rect.height;
      box.style.border = "1px solid orange";
      box.style.pointerEvents = "none";
      box.style.zIndex = `${zIndex}`;
      box.id = `${i + 1}`;
      box.setAttribute("data-selector", selector);
      const attrs = getAttributes(element);
      for (key in attrs) {
        box.setAttribute(key, attrs[key]);
      }
      // Add a box with number in the top right corner
      const number = document.createElement("div");
      number.textContent = i + 1; // Change the number as needed
      number.style.position = "absolute";
      number.style.top = "0";
      number.style.right = "0";
      number.style.background = "red";
      number.style.color = "white";
      number.style.padding = "2px";
      number.style.lineHeight = "11px";
      number.style.border = "1px solid black";
      //if (i + 1 === 21) viewElement = selector;
      box.appendChild(number);
      document.body.appendChild(box);
    });
    //window.scrollBy(0, window.innerHeight);
    document
      .querySelector(
        "#search > div.s-desktop-width-max.s-desktop-content.s-opposite-dir.s-wide-grid-style.sg-row > div.sg-col-20-of-24.s-matching-dir.sg-col-16-of-20.sg-col.sg-col-8-of-12.sg-col-12-of-16 > div > span.rush-component.s-latency-cf-section > div.s-main-slot.s-result-list.s-search-results.sg-row > div:nth-child(7)"
      )
      .scrollIntoView();
    return {};
  }, contentContainers);
  // Close the browser
  // await browser.close();

  page.screenshot({ path: `${process.cwd()}/prototyping/test2.png` });
  return contentContainers;
}

function parseHtml(html, chunkSize = 4000) {
  // Load HTML content using Cheerio
  const $ = html.length ? cheerio.load(html) : null;
  const pageLength = $("body").text().length;
  chunkSize = pageLength * 0.012;

  // Array to store chunked HTML strings
  const htmlContent = [];
  const skipElements = [
    "script",
    "style",
    "head",
    "path",
    "noscript",
    "link",
    "meta",
    "svg",
  ];
  async function extractContent(parent) {
    let innerText = parent
      .text()
      .split("\n")
      .map((word) => word.trim())
      .filter((word) => word)
      .join(" ");
    const interActiveElements = parent.find(
      'button, input[type="text"], input[type="checkbox"], input[type="radio"], select, textarea, a, input[type="submit"], form, img'
    );

    if (innerText.length <= chunkSize && interActiveElements.length <= 250) {
      const container = getFullSelector(parent);
      const section = getFullSelector(findRealContainer(parent));

      parent.empty();
      parent.text(innerText);
      const elementsTxt = $.html(parent).toString();
      console.log({ section, container });
      htmlContent.push({ section, container, elementsTxt });
    } else {
      console.log("checking children -->");
      parent.children().each((index, child) => {
        console.log("next child -->");
        const el = $(child);
        const tagName = el.get(0).tagName;

        if (!skipElements.includes(tagName)) {
          extractContent(el);
        } else console.log("skipping -->", tagName);
      });
    }
  }

  // Start chunking from the body element
  extractContent($("body"));
  console.log('$("body").text.length', $("body").text().length, chunkSize);

  // Return the array of chunked HTML strings
  return htmlContent;
}
function getSelector(el) {
  //console.log("el.attr", el.attr);
  if (!el) return "";
  if (el.attr("id")) return `#${el.attr("id")}`;
  if (el.attr("class")) {
    return getClassSelector(el);
  } else {
    return getChildSelector(el);
  }
}
function getClassSelector(el) {
  let selector = el.get(0).tagName;

  if (el.attr("class")) {
    const classes = el
      .attr("class")
      .split(" ")
      .filter((str) => !str.includes("=") && !str.includes(":"))
      .join(".")
      .trim();
    selector += `.${classes}`;
  }
  return selector;
}
function getChildSelector(el) {
  let selector = el.get(0).tagName;
  if (el.parent().children().length > 1) {
    const index = el.index();
    if (index !== -1) {
      const nthChild = index + 1; // nth-child is 1-indexed
      selector += `:nth-child(${nthChild})`;
    }
  }
  return selector;
}
function getFullSelector(element) {
  console.log("tag1", element.get(0).tagName);
  if (element.get(0).tagName === "html") return "html";
  let parent = element.parent();
  let selector = getChildSelector(element);
  if (selector.charAt(0) === "#") return selector;
  // Iterate through parent nodes until reaching the document root or a parent with more than one child
  while (!["body", "html"].includes(parent.get(0).tagName) && !parent.attr("id")) {
    if (parent.get(0)) console.log("tag2", parent.get(0).tagName);
    selector = `${getSelector(parent)} > ${selector}`;
    console.log("selector->", selector);
    parent = parent.parent();
  }
  console.log("tag3", parent.get(0).tagName);

  // Return the first parent with more than one child or with an ID
  return getSelector(parent) + " > " + selector;
}
function findRealContainer(element) {
  let parent = element.parent();
  console.log("parent.get(0).tagName)", parent.get(0).tagName);
  while (parent.get(0).tagName !== "html" && parent.children().length <= 1) {
    parent = parent.parent();
  }
  return parent;
}
naturalLanguageSelector(
  "https://www.amazon.com/s?k=natural+soap&ref=nb_sb_noss",
  // "https://www.amazon.com/Molivera-Organics-Handmade-Oatmeal-Honey/dp/B0C5NYJV53/ref=sr_1_56?dib=eyJ2IjoiMSJ9.3-mKm6FTyOiYuCI112Yjyd_6cQQnag7t97MhK2MPxguRiGYJHvtUcOlZ8jfFtaFOu2S64Hgo4gmOA6t_GbPMCjOPwJfKEZAxUuxrGslA7MAaZr_mthCUpwiMwoPu7Q93mgEAGCWgR3QLd1sAbXH1abHMb2W8--Fenxtr7Sx-sqod3fEEO24kcfiKp2mQBkacV8u-yagg85NK-VhjR0UAKI7_-GE0riwIRU290TjZ2XyQ8TgRbE8cY3oRMU9qCbEWV-xmGdeO25K-56SqFNE5vCve1HcKaOfnUB5NG_B0BE8.2NkOc4PNjfefBrlJv1gUYp5N7Jk8Ckn8FfNNQKbm8SE&dib_tag=se&keywords=natural+soap&qid=1714159972&sr=8-56",
  // "https://upwork.com",
  ["listing"],
  20
)
  .then(async (res) => {
    console.log("results -->", res);
    //await vectorStore.reset();
  })
  .catch(console.error);
