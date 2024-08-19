// Function to insert the memory display content
export default function insertMemoryDisplay(initialData) {
  // Function to handle input changes
  function handleInput(index, field, value) {
    window.cambrianAiSidePanelData[index][field] = value;
    window.cambrianAiSidePanelChanges.add(index);
    const saveButton = document.querySelector(
      `#cambrian-ai-item-${index} .cambrian-ai-save-button`
    );
    saveButton.style.visibility = "initial";
  }

  // Function to toggle additional info
  function toggleInfo(index) {
    const additionalInfo = document.getElementById(
      `cambrian-ai-additional-info-${index}`
    );
    const toggleSpan = document.querySelector(
      `#cambrian-ai-item-${index} .cambrian-ai-toggle-info-span`
    );
    if (additionalInfo.style.display === "none" || additionalInfo.style.display === "") {
      additionalInfo.style.display = "block";
      toggleSpan.textContent = "hide details...";
    } else {
      additionalInfo.style.display = "none";
      toggleSpan.textContent = "show more...";
    }
  }

  // Function to save changes
  function saveChanges(index) {
    if (window.cambrianAiSidePanelChanges.has(index)) {
      console.log(
        `Saving changes for item at index ${index}:`,
        window.cambrianAiSidePanelData[index]
      );
      window.updateIdentifier(window.cambrianAiSidePanelData[index]);
      window.cambrianAiSidePanelChanges.delete(index);
      const saveButton = document.querySelector(
        `#cambrian-ai-item-${index} .cambrian-ai-save-button`
      );
      saveButton.style.visibility = "hidden";
    }
  }
  // Function to scroll to element
  function scrollToElement(selector) {
    const element = document.querySelector(selector);
    if (element) {
      element.scrollIntoView({ block: "center" });
    } else {
      console.warn(`Element with selector "${selector}" not found.`);
    }
  }

  // Store data and changes in window object for access across function calls
  window.cambrianAiSidePanelData = JSON.parse(JSON.stringify(initialData));
  window.cambrianAiSidePanelChanges = new Set();

  // Create the memory display content
  const memoryDisplayContent = window.cambrianAiSidePanelData
    .map(
      (item, index) => `
    <div class="cambrian-ai-item" id="cambrian-ai-item-${index}">
      <div class="cambrian-ai-element-number" onclick="scrollToElement('${item.selector}')">${item.number}</div>
      <div class="cambrian-ai-field-container">
        <label for="cambrian-ai-elementName-${index}">Element Name:</label>
        <input id="cambrian-ai-elementName-${index}" type="text" value="${item.elementName}" oninput="handleInput(${index}, 'elementName', this.value)" placeholder="Element Name">
      </div>
      <div class="cambrian-ai-field-container">
        <label for="cambrian-ai-elementFunctionality-${index}">Element Functionality:</label>
        <textarea id="cambrian-ai-elementFunctionality-${index}" oninput="handleInput(${index}, 'elementFunctionality', this.value)" placeholder="Element Functionality">${item.elementFunctionality}</textarea>
      </div>
      
      <div class="cambrian-ai-button-row">
        <button class="cambrian-ai-save-button" onclick="saveChanges(${index})">Save</button>
        <span class="cambrian-ai-toggle-info-span" onclick="toggleInfo(${index})">show more...</span>
      </div>

      <div class="cambrian-ai-additional-info" id="cambrian-ai-additional-info-${index}" style="display: none;">
        <div class="cambrian-ai-field-container">
          <label for="cambrian-ai-containerName-${index}">Container Name:</label>
          <input id="cambrian-ai-containerName-${index}" type="text" value="${item.containerName}" oninput="handleInput(${index}, 'containerName', this.value)" placeholder="Container Name">
        </div>
        <div class="cambrian-ai-field-container">
          <label for="cambrian-ai-containerFunctionality-${index}">Container Functionality:</label>
          <textarea id="cambrian-ai-containerFunctionality-${index}" oninput="handleInput(${index}, 'containerFunctionality', this.value)" placeholder="Container Functionality">${item.containerFunctionality}</textarea>
        </div>
        <div class="cambrian-ai-field-container">
          <label for="cambrian-ai-positionRefresh-${index}">Position Refresh:</label>
          <input id="cambrian-ai-positionRefresh-${index}" type="text" value="${item.positionRefresh}" oninput="handleInput(${index}, 'positionRefresh', this.value)" placeholder="Position Refresh">
        </div>
        <div class="cambrian-ai-field-container">
          <label for="cambrian-ai-type-${index}">Type:</label>
          <input id="cambrian-ai-type-${index}" type="text" value="${item.type}" oninput="handleInput(${index}, 'type', this.value)" placeholder="Type">
        </div>
        <div class="cambrian-ai-field-container">
          <label>Anchors:</label>
          <input type="text" value="${item.anchors}" readonly class="cambrian-ai-read-only">
        </div>
        <div class="cambrian-ai-field-container">
          <label>Selector:</label>
          <input type="text" value="${item.selector}" readonly class="cambrian-ai-read-only">
        </div>
        <div class="cambrian-ai-field-container">
          <label>Sub Selector:</label>
          <input type="text" value="${item.subSelector}" readonly class="cambrian-ai-read-only">
        </div>
        <div class="cambrian-ai-field-container">
          <label>ID:</label>
          <input type="text" value="${item.id}" readonly class="cambrian-ai-read-only">
        </div>
        <div class="cambrian-ai-field-container">
          <label>Usage:</label>
          <input type="text" value="${item.usage}" readonly class="cambrian-ai-read-only">
        </div>
      </div>
    </div>
  `
    )
    .join("");

  // Insert the memory display content
  const itemsContainer = document.querySelector(
    "#cambrianAiSidePanelWrapper .cambrian-ai-items-container"
  );
  itemsContainer.innerHTML = memoryDisplayContent;

  // Expose necessary functions to window object
  window.scrollToElement = scrollToElement;
  window.handleInput = handleInput;
  window.toggleInfo = toggleInfo;
  window.saveChanges = saveChanges;
}

// Usage example:
// insertSidePanel(initialData);
// insertMemoryDisplay(initialData);
