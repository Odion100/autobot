export default function addLabels(identifiers) {
  function getRect(element) {
    const scrollOffsetX = window.pageXOffset || document.documentElement.scrollLeft;
    const scrollOffsetY = window.pageYOffset || document.documentElement.scrollTop;
    const rect = element.getBoundingClientRect();
    // Convert the position and dimensions to string values with "px" units
    return {
      top: `${rect.top + scrollOffsetY}px`,
      left: `${rect.left + scrollOffsetX}px`,
      bottom: `${rect.bottom}px`,
      right: `${rect.right}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    };
  }
  function isVisible(element) {
    const style = window.getComputedStyle(element);
    return !(
      style.display === "none" ||
      style.visibility === "hidden" ||
      element.offsetParent === null
    );
  }

  let zIndex = 9999;
  let boxContainer = document.getElementById("cambrian-ai-labels");
  if (!boxContainer) {
    boxContainer = document.createElement("div");
    document.body.appendChild(boxContainer);
    boxContainer.id = "cambrian-ai-labels";
  }
  identifiers.forEach(({ selector, number, containerNumber }, i) => {
    console.log("selector", selector);
    const element = document.querySelector(selector);
    if (!element) return null; // Return null if element is not found
    const rect = getRect(element);

    const box = document.createElement("div");
    if (!isVisible(element)) {
      box.style.display = "none";
    }
    zIndex--;
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
    if (parseInt(rect.width) <= 45) {
      right = "-11px";
      top = "-2px";
    }
    label.className = "box-label";
    label.textContent = number || containerNumber;
    label.style.position = "absolute";
    label.style.top = top;
    label.style.right = right;
    label.style.background = "#0eff0e";
    label.style.color = "black";
    label.style.padding = "4px";
    label.style.lineHeight = "13px";
    label.style.border = "1px solid #0eff0e";
    label.style.fontSize = "13px";

    box.appendChild(label);
    boxContainer.appendChild(box);
  });

  return {};
}
