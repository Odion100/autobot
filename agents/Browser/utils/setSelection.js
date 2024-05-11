export default function setSelection(selections) {
  function getRect(element) {
    const rect = element.getBoundingClientRect();
    // Convert the position and dimensions to string values with "px" units
    return {
      top: `${rect.top}px`,
      left: `${rect.left}px`,
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
  selections.forEach((selector, i) => {
    console.log("selector---", selector);
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
    box.style.border = "2px solid #0eff0e";
    box.style.pointerEvents = "none";
    box.style.zIndex = `${zIndex}`;
    box.id = `${i + 1}`;

    const label = document.createElement("div");
    label.textContent = "Selected Element"; // Change the label as needed
    label.style.position = "absolute";
    label.style.top = "0";
    label.style.right = "0";
    label.style.background = "#0eff0e";
    label.style.color = "black";
    label.style.padding = "4px";
    label.style.lineHeight = "11px";
    label.style.border = "1px solid black";
    label.style.fontSize = "13px";
    //if (i + 1 === 21) viewElement = selector;
    box.appendChild(label);
    selectionContainer.appendChild(box);
  });

  return {};
}
