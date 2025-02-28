import cheerio from "cheerio";
export default async function getContentContainers(
  html,
  chunkSize,
  elementLimit,
  isUnderScreenSize
) {
  // Load HTML content using Cheerio
  const $ = html.length ? cheerio.load(html) : null;
  const pageLength = $("body").text().length;
  if (!chunkSize) chunkSize = pageLength * 0.015;
  if (!elementLimit) elementLimit = chunkSize * 0.05;
  console.log("chunkSize", chunkSize);
  console.log("elementLimit", elementLimit);
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
  let containerNumber = 0;
  async function extractContent(parent) {
    let innerText = parent.text().replace(/\s+/g, " ").trim();
    const interActiveElements = parent.find(
      'button, input[type="text"], input[type="checkbox"], input[type="radio"], select, textarea, a, input[type="submit"], form, img'
    );

    if (innerText.length <= chunkSize && interActiveElements.length <= 250) {
      const selector = getFullSelector(parent);
      // console.log("before inSizeRange-->", selector);
      const inSizeRange = await isUnderScreenSize(selector);
      // console.log("after inSizeRange-->", inSizeRange);
      if (inSizeRange) {
        // parent.empty();
        // parent.text(innerText);
        const html = $.html(parent).toString();
        // console.log({ section, container });
        containerNumber++;
        return htmlContent.push({ selector, html, innerText, containerNumber });
      }
    }

    const childPromises = parent
      .children()
      .map(async (index, child) => {
        const el = $(child);
        const tagName = el.get(0).tagName;

        if (!skipElements.includes(tagName)) {
          await extractContent(el);
        }
      })
      .get();

    await Promise.all(childPromises);
  }

  // Start chunking from the body element
  await extractContent($("body"));
  // console.log('$("body").text.length', $("body").text().length, chunkSize);

  // Return the array of chunked HTML strings
  return htmlContent;
}
function getSelector(el) {
  //console.log("el.attr", el.attr);
  if (!el) return "";
  if (el.attr("id") && /^[a-zA-Z_-][\w-]*$/.test(el.attr("id")))
    return `#${el.attr("id")}`;
  const selector = el.get(0).tagName;
  if (selector !== "body" && el.parent().children().length > 1) {
    if (el.attr("class")) {
      return getClassSelector(el);
    } else {
      return getChildSelector(el);
    }
  }
  return selector;
}
function getClassSelector(el) {
  let selector = el.get(0).tagName;

  if (el.attr("class")) {
    const classes = el
      .attr("class")
      .split(" ")
      .filter((str) => /^[a-zA-Z_-][\w-]*$/.test(str))
      .join(".")
      .trim();
    selector += `.${classes}`;
  }
  return selector;
}
function getChildSelector(el) {
  let selector = el.get(0).tagName;
  if (selector !== "body" && el.parent().children().length > 1) {
    const index = el.index();
    if (index !== -1) {
      const nthChild = index + 1; // nth-child is 1-indexed
      selector += `:nth-child(${nthChild})`;
    }
  }
  return selector;
}
function getFullSelector(element) {
  // console.log("tag1", element.get(0).tagName);
  if (element.get(0).tagName === "html") return "html";
  let parent = element.parent();
  let selector = getChildSelector(element);
  if (selector.charAt(0) === "#") return selector;
  // Iterate through parent nodes until reaching the document root or a parent with more than one child
  while (!["body", "html"].includes(parent.get(0).tagName) && !parent.attr("id")) {
    // if (parent.get(0)) console.log("tag2", parent.get(0).tagName);
    selector = `${getSelector(parent)} > ${selector}`;
    // console.log("selector->", selector);
    parent = parent.parent();
  }
  // console.log("tag3", parent.get(0).tagName);

  // Return the first parent with more than one child or with an ID
  return getSelector(parent) + " > " + selector;
}
function findRealContainer(element) {
  let parent = element.parent();
  // console.log("parent.get(0).tagName)", parent.get(0).tagName);
  while (parent.get(0).tagName !== "html" && parent.children().length <= 1) {
    parent = parent.parent();
  }
  return parent;
}
