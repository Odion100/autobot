export default function setupPageSections() {
  const windowWidth = window.innerWidth;
  const windowHeight = window.innerHeight;
  const totalHeight = document.body.scrollHeight;
  const totalSections = Math.ceil(totalHeight / windowHeight);
  const existingContainer = document.querySelector(`#cambrian-ai-sections`);
  if (existingContainer) existingContainer.remove();

  const boxContainer = document.createElement("div");
  document.body.appendChild(boxContainer);
  boxContainer.id = `cambrian-ai-sections`;

  let zIndex = 8888;

  for (let i = 0; i < totalSections; i++) {
    const box = document.createElement("div");
    const sectionNumber = i + 1;
    box.style.position = "absolute";
    box.style.top = `${i * windowHeight}px`;
    box.style.left = "0px";
    box.style.width = `${windowWidth}px`;
    box.style.height = `${windowHeight}px`;
    box.style.border = "2px solid red";
    box.style.pointerEvents = "none";
    box.style.zIndex = `${zIndex}`;
    box.id = `section_${sectionNumber}`;

    // Add a box with number in the top right corner
    const label = document.createElement("div");
    label.className = "section-label";
    label.textContent = `SECTION ${sectionNumber}`;
    label.style.position = "absolute";
    label.style.top = "0";
    label.style.right = "0";
    label.style.background = "red";
    label.style.color = "white";
    label.style.padding = "4px";
    label.style.lineHeight = "11px";
    label.style.fontSize = "20px";

    box.appendChild(label);
    boxContainer.appendChild(box);

    zIndex--;
  }

  return { totalSections, windowHeight, windowWidth, totalHeight };
}
