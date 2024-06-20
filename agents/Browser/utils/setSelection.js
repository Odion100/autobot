export default function setSelection(element) {
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

  let zIndex = 9999;
  let selectionContainer = document.getElementById("cambrian-ai-selection");
  if (!selectionContainer) {
    selectionContainer = document.createElement("div");
    document.body.appendChild(selectionContainer);
    selectionContainer.id = "cambrian-ai-selection";
  }

  const rect = getRect(element);
  const box = document.createElement("div");

  zIndex--;
  box.style.position = "absolute";
  box.style.top = rect.top;
  box.style.left = rect.left;
  box.style.width = rect.width;
  box.style.height = rect.height;
  box.style.border = "2px solid #0eff0e";
  box.style.pointerEvents = "none";
  box.style.zIndex = `${zIndex}`;
  box.id = `selected-element`;

  const label = document.createElement("div");
  label.textContent = "Selected Element";
  label.style.position = "absolute";
  label.style.top = rect.height;
  label.style.right = "0";
  label.style.background = "#0eff0e";
  label.style.color = "black";
  label.style.padding = "4px";
  label.style.lineHeight = "13px";
  label.style.border = "1px solid #0eff0e";
  label.style.fontSize = "13px";

  box.appendChild(label);
  selectionContainer.appendChild(box);
}
