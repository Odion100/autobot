export default function setSelection(selections) {
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

  let zIndex = 9999;
  let selectionContainer = document.getElementById("cambrian-ai-selection");
  if (!selectionContainer) {
    selectionContainer = document.createElement("div");
    document.body.appendChild(selectionContainer);
    selectionContainer.id = "cambrian-ai-selection";
  }

  selections.forEach((selector, i) => {
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
    box.style.border = "2px solid green";
    box.style.pointerEvents = "none";
    box.style.zIndex = `${zIndex}`;
    box.id = `${i + 1}`;
    selectionContainer.appendChild(box);
  });

  return {};
}
