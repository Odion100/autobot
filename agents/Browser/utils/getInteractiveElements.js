export default async function getInteractiveElements(containers, filter = "*") {
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
        if (nth != 1) selector += ":nth-of-type(" + nth + ")";
      }
      path.unshift(selector);
      el = el.parentNode;
    }
    return path.join(" > ");
  };

  function getElementType(element) {
    const tagName = element.tagName.toLowerCase();
    const attributes = element.attributes;
    const inputType = attributes.type ? attributes.type.value : "";
    if (
      attributes.onclick ||
      tagName === "a" ||
      tagName === "button" ||
      inputType === "button" ||
      inputType === "submit" ||
      inputType === "reset" ||
      inputType === "image" ||
      inputType === "file" ||
      inputType === "checkbox" ||
      inputType === "radio"
    ) {
      return "clickable";
    } else if (tagName === "input" || tagName === "textarea") {
      return "typeable";
    } else {
      return "content";
    }
  }
  function isVisible(element) {
    const rect = element.getBoundingClientRect();
    const width = parseFloat(rect.width);
    const height = parseFloat(rect.height);
    const style = window.getComputedStyle(element);
    return !(
      style.display === "none" ||
      style.visibility === "hidden" ||
      element.offsetParent === null ||
      width < 1 ||
      height < 1
    );
  }
  function parseContainer({ selector, containerNumber }) {
    const container = document.querySelector(selector);
    if (!container) return [];
    return Array.from(container.querySelectorAll(filter)).reduce((acc, element, i) => {
      const attributes = Array.from(element.attributes)
        .filter((attr) => !["class", "style"].includes(attr.name))
        .map((attr) => attr.value)
        .join(" ");

      if (isVisible(element)) {
        acc.push({
          tagName: element.tagName.toLowerCase(),
          selector: cssPath(element),
          attributes,
          innerText: element.innerText.replace(/\s+/g, " ").trim(),
          type: getElementType(element),
          container: selector,
          number: i + 1,
          containerNumber,
        });
      }
      return acc;
    }, []);
  }

  return containers.reduce(function (acc, container) {
    const interActiveElements = parseContainer(container);
    if (interActiveElements.length) acc.push(...interActiveElements);
    return acc;
  }, []);
}
