export default function addContentContainers(contentContainers) {
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

  let zIndex = 8888;
  const boxContainer = document.createElement("div");
  document.body.appendChild(boxContainer);
  boxContainer.id = `cambrian-ai-containers`;
  contentContainers.forEach(({ container: selector }, i) => {
    const element = document.querySelector(selector);
    if (!element) return null; // Return null if element is not found
    const rect = getRect(element);
    // Add a red border with 2px width
    const box = document.createElement("div");
    // Apply styles to the box
    zIndex--;
    box.style.position = "absolute";
    box.style.top = rect.top;
    box.style.left = rect.left;
    box.style.width = rect.width;
    box.style.height = rect.height;
    box.style.border = "2px solid red";
    box.style.pointerEvents = "none";
    box.style.zIndex = `${zIndex}`;
    box.id = `${i + 1}`;

    // Add a box with number in the top right corner
    const number = document.createElement("div");
    number.textContent = i + 1; // Change the number as needed
    number.style.position = "absolute";
    number.style.top = "0";
    number.style.right = "0";
    number.style.background = "red";
    number.style.color = "white";
    number.style.padding = "4px";
    number.style.lineHeight = "11px";
    // number.style.border = "1px solid black";
    number.style.fontSize = "20px";
    //if (i + 1 === 21) viewElement = selector;
    box.appendChild(number);
    boxContainer.appendChild(box);
  });
  return {};
}
