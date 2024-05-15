export default function addLabels(selections) {
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
  let boxContainer = document.getElementById("cambrian-ai-labels");
  if (!boxContainer) {
    boxContainer = document.createElement("div");
    document.body.appendChild(boxContainer);
    boxContainer.id = "cambrian-ai-labels";
  }
  selections.forEach(({ selector, label: lb }, i) => {
    console.log("selector", selector);
    const element = document.querySelector(selector);
    if (!element) return null; // Return null if element is not found
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
    box.id = `${i + 1}`;

    const label = document.createElement("div");
    let top = "0px";
    let right = "0px";
    if (parseInt(rect.width) <= 45) {
      right = "-11px";
      top = "-2px";
    }
    label.textContent = lb || `${i + 1}`; // Change the label as needed
    label.style.position = "absolute";
    label.style.top = top;
    label.style.right = right;
    label.style.background = "#0eff0e";
    label.style.color = "black";
    label.style.padding = "4px";
    label.style.lineHeight = "13px";
    label.style.border = "1px solid #0eff0e";
    label.style.fontSize = "13px";
    //if (i + 1 === 21) viewElement = selector;
    box.appendChild(label);
    boxContainer.appendChild(box);
  });

  return {};
}
