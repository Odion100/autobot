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

  // Function to delete an item
  function deleteItem(index) {
    window.deleteIdentifier(window.cambrianAiSidePanelData[index]);
  }

  // Store data and changes in window object for access across function calls
  window.cambrianAiSidePanelData = JSON.parse(JSON.stringify(initialData));
  window.cambrianAiSidePanelChanges = new Set();

  // Create the memory display content
  let memoryDisplayHTML;
  if (initialData.length === 0) {
    memoryDisplayHTML = `
       <div id="cambrian-ai-empty-message" class="cambrian-ai-empty-message">
        <p>No elements have been identified on this page. To get started:</p>
        <ol>
          <li>
            <p>Click the recorder button <span class="cambrian-ai-recorder-icon">⏺</span> above.</p>
          </li>
          <li>
            <p>Select the elements you'd like <span style="color:gainsboro;">Cambrian</span> to identify.</p>
          </li>
          <li>
            <p>Click the stop recorder button <span class="cambrian-ai-recorder-icon">◼</span> to identify the selected elements.</p>
          </li>
        </ol>
        <p>This will populate the list with identified elements.</p>
        <p><span style="color:gainsboro;font-weight:bold">Cambrian</span> can then easily interact with the identified elements.</p>
      </div>
    `;
  } else {
    const memoryItemsHTML = window.cambrianAiSidePanelData
      .map(
        (item, index) => `
      <div class="cambrian-ai-item" id="cambrian-ai-item-${index}">
        <div class="cambrian-ai-item-controls">
          <div class="cambrian-ai-delete-button" onclick="deleteItem(${index})">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16">
              <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M4 7h16M6 7v11a3 3 0 003 3h6a3 3 0 003-3V7M9 5a2 2 0 012-2h2a2 2 0 012 2v2H9V5zM10 11v6M14 11v6"/>
            </svg>
          </div>
          <div class="cambrian-ai-element-number" onclick="scrollToElement('${item.selector}')">${item.number}</div>
        </div>
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

    memoryDisplayHTML = `
      <div id="cambrian-ai-memory-items">
        ${memoryItemsHTML}
      </div>
    `;
  }

  const style = `
  <style id="cambrian-ai-memory-display">
    #cambrianAiSidePanelWrapper #cambrian-ai-memory-items {
      height: 100%;
      overflow-y: auto;
      width: 350px;
    }
    #cambrianAiSidePanelWrapper .cambrian-ai-item {
      margin-bottom: 8px;
      background-color: #333741;
      border-radius: 5px;
      box-shadow: 0 2px 5px rgba(0,0,0,0.1);
      display: flex;
      flex-direction: column;
      position: relative;
      border: 1px dashed #0fff0e;
      padding: 12px 12px;
      opacity: 0.9;
    }
    #cambrianAiSidePanelWrapper .cambrian-ai-item:hover {
      opacity: 1;
    }
    #cambrianAiSidePanelWrapper .cambrian-ai-field-container {
      display: flex;
      flex-direction: column;
      margin-bottom: 10px;
    }
    #cambrianAiSidePanelWrapper .cambrian-ai-field-container label {
      font-size: 14px;
      color: #f0f2f2;
    }
    #cambrianAiSidePanelWrapper .cambrian-ai-field-container input, #cambrianAiSidePanelWrapper .cambrian-ai-field-container textarea {
      border: none;
      border-radius: 3px;
      font-size: 14px;
      width: 100%;
      box-sizing: border-box;
      box-shadow: none;
      height: initial;
    }
    #cambrianAiSidePanelWrapper .cambrian-ai-field-container input:focus, #cambrianAiSidePanelWrapper .cambrian-ai-field-container textarea:focus {
      outline: none;
      border-color: #007bff;
      box-shadow: 0 0 0 2px rgba(0,123,255,0.25);
    }
    #cambrianAiSidePanelWrapper .cambrian-ai-field-container textarea {
      resize: vertical;
      min-height: 60px;
    }
    #cambrianAiSidePanelWrapper .cambrian-ai-read-only {
      background-color: #f8f9fa;
      color: #6c757d;
    }
    #cambrianAiSidePanelWrapper .cambrian-ai-save-button, #cambrianAiSidePanelWrapper .cambrian-ai-toggle-info-button {
      background-color: #28a745;
      color: white;
      border: none;
      border-radius: 3px;
      cursor: pointer;
      font-size: 14px;
    }
    #cambrianAiSidePanelWrapper .cambrian-ai-save-button:hover, #cambrianAiSidePanelWrapper .cambrian-ai-toggle-info-button:hover {
      background-color: #218838;
    }
    #cambrianAiSidePanelWrapper .cambrian-ai-save-button {
      visibility: hidden;
    }
    #cambrianAiSidePanelWrapper .cambrian-ai-toggle-info-button {
      background-color: #17a2b8;
    }
    #cambrianAiSidePanelWrapper .cambrian-ai-toggle-info-button:hover {
      background-color: #138496;
    }
    #cambrianAiSidePanelWrapper .cambrian-ai-additional-info {
      margin-top: 15px;
      border-top: 1px solid #dee2e6;
      padding-top: 15px;
      display: none;
    }
    #cambrianAiSidePanelWrapper .cambrian-ai-toggle-info-span {
      color: #007bff;
      cursor: pointer;
      font-size: 14px;
      display: inline-block;
      top: -11px;
    }
    #cambrianAiSidePanelWrapper .cambrian-ai-toggle-info-span:hover {
      text-decoration: underline;
    }
    #cambrianAiSidePanelWrapper .cambrian-ai-button-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    #cambrianAiSidePanelWrapper .cambrian-ai-item-controls {
      position: absolute;
      top: 5px;
      right: 10px;
      display: flex;
      align-items: center;
    }
    #cambrianAiSidePanelWrapper .cambrian-ai-delete-button {
      cursor: pointer;
      margin-right: 5px;
    }
    #cambrianAiSidePanelWrapper .cambrian-ai-delete-button svg {
      width: 21px;
      height: 21px;
      color: gainsboro;
      vertical-align: middle;
    }
    #cambrianAiSidePanelWrapper .cambrian-ai-delete-button:hover svg {
      color: #ff486f;
    }
    #cambrianAiSidePanelWrapper .cambrian-ai-delete-button:active {
      transform: translateY(1px);
    }
    #cambrianAiSidePanelWrapper .cambrian-ai-element-number {
      font-size: 14px;
      color: black;
      background: #0fff0e;
      width: 20px;
      height: 20px;
      text-align: center;
      border-radius: 52px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    #cambrianAiSidePanelWrapper .cambrian-ai-empty-message {
      background-color: #282c34;
      border: 1px dashed #0fff0e;
      border-radius: 5px;
      padding: 20px;
      color: #f0f2f2;
      opacity: 0.9;
      width: 386px;
    }
    #cambrianAiSidePanelWrapper .cambrian-ai-empty-message:hover {
      opacity: 1;
    }
      
    #cambrianAiSidePanelWrapper .cambrian-ai-empty-message p {
      margin-bottom: 10px;
      text-align: left;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }

    #cambrianAiSidePanelWrapper .cambrian-ai-empty-message ol {
      padding-left: 20px;
      margin-bottom: 10px;
      color: #6fbe72;
      font-weight: bold;
      list-style-type: decimal !important;
    }

    #cambrianAiSidePanelWrapper .cambrian-ai-empty-message li {
      margin-bottom: 5px;
    }

    #cambrianAiSidePanelWrapper .cambrian-ai-empty-message li p {
      margin-bottom: 0;
    }
      
    #cambrianAiSidePanelWrapper .cambrian-ai-recorder-icon {
      color: #c6495d;
      font-size: 18px;
      vertical-align: middle;
      text-shadow: 0px 0px 2px #177d1b;
    }
  </style>
`;

  const sidePanel = document.querySelector("#cambrianAiSidePanelWrapper");
  if (!sidePanel.querySelector("style#cambrian-ai-memory-display")) {
    sidePanel.insertAdjacentHTML("afterbegin", style);
  }
  // Insert the memory display content
  const itemsContainer = document.querySelector(
    "#cambrianAiSidePanelWrapper .cambrian-ai-memory-container"
  );
  itemsContainer.innerHTML = memoryDisplayHTML;

  // Expose necessary functions to window object
  window.scrollToElement = scrollToElement;
  window.handleInput = handleInput;
  window.toggleInfo = toggleInfo;
  window.saveChanges = saveChanges;
  window.deleteItem = deleteItem;
}
