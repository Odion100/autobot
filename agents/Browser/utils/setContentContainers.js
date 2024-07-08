export default function setContentContainers(contentContainers) {
  function getRect(element) {
    const scrollOffsetX = window.pageXOffset || document.documentElement.scrollLeft;
    const scrollOffsetY = window.pageYOffset || document.documentElement.scrollTop;
    const rect = element.getBoundingClientRect();
    return {
      top: `${rect.top + scrollOffsetY}px`,
      left: `${rect.left + scrollOffsetX}px`,
      bottom: `${rect.bottom}px`,
      right: `${rect.right}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    };
  }

  function getPosition(element) {
    const style = window.getComputedStyle(element);
    return style.position;
  }
  function isVisible(element) {
    const style = window.getComputedStyle(element);
    return !(
      style.display === "none" ||
      style.visibility === "hidden" ||
      element.offsetParent === null
    );
  }
  const windowWidth = window.innerWidth;
  const windowHeight = window.innerHeight;
  const existingContainer = document.querySelector(`#cambrian-ai-containers`);
  if (existingContainer) existingContainer.remove();
  let zIndex = 8888;
  const boxContainer = document.createElement("div");
  document.body.appendChild(boxContainer);
  boxContainer.id = `cambrian-ai-containers`;

  contentContainers.forEach(({ selector, label: lb }, i) => {
    const element = document.querySelector(selector);
    if (!element) return; // Skip if element is not found

    const rect = getRect(element);
    const position = getPosition(element);
    const visible = isVisible(element); // Skip if element's dimensions are greater than window size and its position is absolute or fixed
    const box = document.createElement("div");
    const width = parseFloat(rect.width);
    const height = parseFloat(rect.height);

    if (
      !visible ||
      width < 10 ||
      height < 10 ||
      ((width > windowWidth || height > windowHeight * 0.9) &&
        (position === "absolute" || position === "static" || position === "sticky"))
    ) {
      console.log(element);
      box.style.display = "none";
    }

    zIndex--;
    box.style.position = position === "fixed" ? position : "absolute";
    box.style.top = rect.top;
    box.style.left = rect.left;
    box.style.width = rect.width;
    box.style.height = rect.height;
    box.style.border = "2px solid red";
    box.style.pointerEvents = "none";
    box.style.zIndex = `${zIndex}`;
    box.id = `container_${i + 1}`;
    box.setAttribute("data-selector", selector);
    // Add a box with number in the top right corner
    // const label = document.createElement("div");
    // label.className = "box-label";
    // label.textContent = lb || `${i + 1}`; // Change the number as needed
    // label.style.position = "absolute";
    // label.style.top = "0";
    // label.style.right = "0";
    // label.style.background = "red";
    // label.style.color = "white";
    // label.style.padding = "4px";
    // label.style.lineHeight = "11px";
    // label.style.fontSize = "20px";

    // box.appendChild(label);
    boxContainer.appendChild(box);
  });

  return {};
}
