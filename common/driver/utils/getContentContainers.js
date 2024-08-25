export default function getContentContainers(chunkSize, elementLimit) {
  // Load HTML content using Cheerio
  const pageLength = document.body.innerText.length;
  if (!chunkSize) chunkSize = pageLength * 0.27;
  if (!elementLimit) elementLimit = chunkSize * 0.05;
  console.log("chunkSize", chunkSize);
  console.log("elementLimit", elementLimit);
  console.log("pageLength", pageLength);
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
  const isValidCSSSelector = (str) => /^[a-zA-Z0-9\-_#\.\[\]=\(\):\s>+~]*$/.test(str);

  function isUnderScreenSize(element) {
    const elementRect = element.getBoundingClientRect();
    const screenWidth = window.innerWidth;
    const screenHeight = window.innerHeight;
    return elementRect.width <= screenWidth && elementRect.height <= screenHeight;
  }

  const cssPath = function (el) {
    var path = [];
    while (el.nodeType === Node.ELEMENT_NODE) {
      var selector = el.nodeName.toLowerCase();
      if (el.id && /^[a-zA-Z_-][\w-]*$/.test(el.id)) {
        selector += "#" + el.id;
        path.unshift(selector);
        break;
      } else {
        var sib = el,
          nth = 1;
        while ((sib = sib.previousElementSibling)) {
          if (sib.nodeName.toLowerCase() == selector) nth++;
        }
        selector += ":nth-of-type(" + nth + ")";
      }
      path.unshift(selector);
      el = el.parentNode;
    }
    return path.join(" > ");
  };

  function getRelevantText(element) {
    let texts = "";
    const childrenWithAttributes = element.querySelectorAll(
      "[aria-label], [alt], [title]"
    );
    childrenWithAttributes.forEach((child) => {
      const relevantAttributes = ["aria-label", "alt", "title"];
      relevantAttributes.forEach((attr) => {
        const text = child.getAttribute(attr);
        if (text) texts += ` ${text}`;
      });
    });
    return texts;
  }
  function isVisible(element) {
    const { width: w, height: h } = element.getBoundingClientRect();
    const width = parseFloat(w);
    const height = parseFloat(h);
    const style = window.getComputedStyle(element);
    console.log("width, height ,style", width, height, style);
    return !(
      style.display === "none" ||
      style.visibility === "hidden" ||
      element.offsetParent === null ||
      !width ||
      !height
    );
  }

  let containerNumber = 0;
  async function extractContent(parent) {
    let innerText = parent.innerText.replace(/\s+/g, " ").trim();
    const interActiveElements = parent.querySelectorAll(
      'button, input[type="text"], input[type="checkbox"], input[type="radio"], select, textarea, a, input[type="submit"], form, img'
    );
    console.log("potential container", innerText.length, interActiveElements.length);
    console.log(parent);

    const visible = isVisible(parent);

    if (
      visible &&
      interActiveElements.length &&
      (innerText.length <= chunkSize || interActiveElements.length <= 250)
    ) {
      const selector = cssPath(parent);
      const isValidSelector = isValidCSSSelector(selector);
      console.log("selector", isValidSelector);

      if (isValidSelector && isUnderScreenSize(parent)) {
        const html = parent.outerHTML.toString();
        containerNumber++;
        console.log("saving container", selector);
        return htmlContent.push({
          selector,
          html,
          innerText: innerText + " " + getRelevantText(parent),
          containerNumber,
        });
      } else {
        console.log("over screen size", parent);
      }
    }

    const children = Array.from(parent.children);
    for (const child of children) {
      const tagName = child.tagName.toLowerCase();
      if (!skipElements.includes(tagName)) {
        extractContent(child);
      }
    }
  }

  extractContent(document.body);

  return htmlContent;
}
