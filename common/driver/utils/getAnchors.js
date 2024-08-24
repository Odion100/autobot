export default function getAnchors({ container, subSelector }, targetElement) {
  const element = document.querySelector(container);
  if (!element) return null;
  const anchors = [];
  const combinedAnchors = [];
  const attributeSelectors = [];
  let classSelector = "";

  // Get the element name (tag name)
  const elementName = element.tagName.toLowerCase();

  if (element.id) {
    combinedAnchors.push(`${elementName}#${CSS.escape(element.id)}`);
  }

  for (const attr of element.attributes) {
    if (attr.name !== "class" && attr.name !== "style") {
      attributeSelectors.push(`[${attr.name}="${CSS.escape(attr.value)}"]`);
    }
  }

  anchors.push(...attributeSelectors);

  if (element.classList.length > 0) {
    classSelector =
      "." +
      Array.from(element.classList)
        .map((c) => CSS.escape(c))
        .join(".");
    anchors.push(classSelector);
  }

  if (attributeSelectors.length > 0) {
    if (classSelector) {
      for (const attrSelector of attributeSelectors) {
        combinedAnchors.push(`${elementName}${classSelector}${attrSelector}`);
      }
    }
    for (let i = 0; i < attributeSelectors.length; i++) {
      for (let j = i + 1; j < attributeSelectors.length; j++) {
        combinedAnchors.push(
          `${elementName}${attributeSelectors[i]}${attributeSelectors[j]}`
        );

        for (let k = j + 1; k < attributeSelectors.length; k++) {
          combinedAnchors.push(
            `${elementName}${attributeSelectors[i]}${attributeSelectors[j]}${attributeSelectors[k]}`
          );
        }
      }
    }
  }

  // Add element name to single selectors
  anchors.forEach((anchor) => combinedAnchors.push(`${elementName}${anchor}`));

  return combinedAnchors
    .reduce((acc, anchor) => {
      if (targetElement.matches(`${anchor} > ${subSelector}`)) acc.push(anchor);
      return acc;
    }, [])
    .join(",");
}
