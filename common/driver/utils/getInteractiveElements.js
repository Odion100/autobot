export default async function getInteractiveElements(containers, targetType) {
  const clickable =
    'a, [onclick], button, input[type="button"], [type="submit"], [type="reset"], [type="image"], [type="file"], [type="checkbox"], [type="radio"], select';

  const typeable = "input, textarea, select";
  const filter = clickable + ", " + typeable;

  const cssPath = function (el, container) {
    var path = [];
    while (el.nodeType === Node.ELEMENT_NODE && el !== container) {
      var selector = el.nodeName.toLowerCase();
      if (!container && el.id && /^[a-zA-Z_-][\w-]*$/.test(el.id)) {
        selector += "#" + el.id;
        path.unshift(selector);
        break;
      } else {
        var parent = el.parentNode;
        var sameTypeSiblings = parent.querySelectorAll(":scope > " + selector);
        if (sameTypeSiblings.length > 1) {
          var index = Array.from(sameTypeSiblings).indexOf(el) + 1;
          selector += ":nth-of-type(" + index + ")";
        }
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
      tagName === "button" ||
      inputType === "submit" ||
      inputType === "reset" ||
      inputType === "image" ||
      inputType === "file" ||
      inputType === "checkbox" ||
      inputType === "radio"
    ) {
      return "clickable";
    } else if (tagName === "select") {
      return targetType || "clickable";
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

  function parseContainer({ selector, containerNumber, anchors }) {
    const container = document.querySelector(selector);
    if (!container) return [];
    return Array.from(container.querySelectorAll(filter)).reduce((acc, element, i) => {
      const attributes = Array.from(element.attributes)
        .filter((attr) => !["class", "style"].includes(attr.name))
        .map((attr) => attr.value)
        .join(" ");

      if (isVisible(element)) {
        console.log("element, element.innerText", element, element.innerText);
        acc.push({
          tagName: element.tagName.toLowerCase(),
          selector: cssPath(element),
          subSelector: cssPath(element, container),
          attributes,
          innerText: element.innerText.replace(/\s+/g, " ").trim(),
          type: getElementType(element),
          container: selector,
          number: i + 1,
          containerNumber,
          anchors,
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
