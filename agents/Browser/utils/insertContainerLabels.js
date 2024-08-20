export default function insertLabels(identifiers) {
  function getRect(element, elementContainer) {
    const scrollOffsetX = window.pageXOffset || document.documentElement.scrollLeft;
    const scrollOffsetY = window.pageYOffset || document.documentElement.scrollTop;
    const rect = element.getBoundingClientRect();
    const elementXOffset = scrollOffsetX + rect.x;
    const elementYOffset = scrollOffsetY + rect.y;
    const containerRect = elementContainer.getBoundingClientRect();
    const containerXOffset = scrollOffsetX + containerRect.x;
    const containerYOffset = scrollOffsetY + containerRect.y;
    const borderWidth = 3; // Adjust the border width here if necessary

    // Convert the position and dimensions to string values with "px" units
    return {
      top: `${elementYOffset - containerYOffset - borderWidth}px`,
      left: `${elementXOffset - containerXOffset - borderWidth}px`,
      bottom: `${rect.bottom}px`,
      right: `${rect.right}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    };
  }

  let zIndex = 200000;
  identifiers.forEach(
    ({ selector, label: lb, number, containerNumber, container }, i) => {
      console.log("selector", selector, containerNumber);
      const element = document.querySelector(selector);
      const elementContainer = document.querySelector(container);
      const labelContainer = document.querySelector(
        `#cambrian-ai-containers > div#container_${containerNumber}`
      );
      if (!element) return null; // Return null if element is not found
      if (!labelContainer) return null; // Return null if element is not found
      const rect = getRect(element, elementContainer);

      const box = document.createElement("div");
      zIndex++;
      box.className = "inserted-identifiers";
      box.style.position = "absolute";
      box.style.top = rect.top;
      box.style.left = rect.left;
      box.style.width = rect.width;
      box.style.height = rect.height;
      box.style.border = "2px solid #0eff0e";
      box.style.pointerEvents = "none";
      box.style.zIndex = `${zIndex}`;
      // box.id = `container_${i + 1}`;

      const label = document.createElement("div");
      let top = "0px";
      let right = "0px";
      if (parseInt(rect.width) <= 120) {
        right = "-11px";
        top = "-6px";
      }
      label.className = "box-label";
      label.textContent = lb || number;
      label.style.position = "absolute";
      label.style.top = top;
      label.style.right = right;
      label.style.background = "#0eff0e";
      label.style.color = "black";
      label.style.padding = "4px";
      label.style.lineHeight = "13px";
      label.style.border = "1px solid #0eff0e";
      label.style.fontSize = "13px";
      label.style.zIndex = `${zIndex + 1000}`;
      box.appendChild(label);
      labelContainer.appendChild(box);
    }
  );

  return {};
}
