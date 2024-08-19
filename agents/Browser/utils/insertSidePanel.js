// Function to insert the side panel structure
export default function insertSidePanel(initialData) {
  const style = `
    <style>
      #cambrianAiSidePanelWrapper .cambrian-ai-side-panel {
        width: 350px;
        margin: 0 20px;
        height: 100vh;
        overflow-y: auto;
        font-family: Arial, sans-serif;
        display: flex;
        flex-direction: column;
        position: fixed;
        top: 0;
        right: 0;
        z-index: 300001;
      }
      #cambrianAiSidePanelWrapper .cambrian-ai-item {
        margin-bottom: 8px;
        background-color: #333741;
        border-radius: 5px;
        box-shadow: 0 2px 5px rgba(0,0,0,0.1);
        display: flex;
        flex-direction: column;
        border: 1px solid black;
        position: relative;
        border: 1px dashed #0fff0e;
        padding: 12px 12px;
        opacity: 0.9;
      }
      #cambrianAiSidePanelWrapper .cambrian-ai-item:hover {
        opacity: 1;
      }
      #cambrianAiSidePanelWrapper .cambrian-ai-item h3 {
        margin-top: 0;
        margin-bottom: 15px;
        color: #333;
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
      #cambrianAiSidePanelWrapper .cambrian-ai-additional-info h4 {
        margin-top: 0;
        margin-bottom: 10px;
        color: #495057;
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
      #cambrianAiSidePanelWrapper .cambrian-ai-side-header {
        display: flex;
        justify-content: flex-end;
        margin-bottom: 1px;
        padding: 10px;
        border-radius: 5px;
      }
      #cambrianAiSidePanelWrapper .cambrian-ai-side-button-holder {
        background: white;
        padding: 3px;
        border-radius: 54px;
        display: inline-block;
        border: 1px solid red;
        margin: 0 0px 0px 4px;
        opacity: .9;
      }
      #cambrianAiSidePanelWrapper .cambrian-ai-side-button-holder:hover {
        opacity: 1;
      }
      #cambrianAiSidePanelWrapper .cambrian-ai-header-button {
        width: 27px;
        height: 27px;
        background-color: #4CAF50;
        border: none;
        border-radius: 26px;
        font-size: 13px;
        display: flex;
        justify-content: center;
        align-items: center;
        cursor: pointer;
        opacity: 0.9;
        transition: background-color 0.3s ease;
        padding: 5px 5px;
        font-weight: bold;
      }
      #cambrianAiSidePanelWrapper .cambrian-ai-header-button:hover {
        opacity: 1;
      }
      #cambrianAiSidePanelWrapper .cambrian-ai-items-container {
        flex-grow: 1;
        overflow-y: auto;
      }
      #cambrianAiSidePanelWrapper .cambrian-ai-element-number {
        position: absolute;
        top: 5px;
        right: 10px;
        font-size: 14px;
        color: black;
        background: #0fff0e;
        width: 20px;
        height: 20px;
        text-align: center;
        border-radius: 52px;
        cursor: pointer;
      }
    </style>
    `;

  const sidePanelStructure = `
    <div id="cambrianAiSidePanelWrapper">
      ${style}
      <div class="cambrian-ai-side-panel">
        <div class="cambrian-ai-side-header">
          <div class="cambrian-ai-side-button-holder">
            <button class="cambrian-ai-header-button">
              <img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIgY2xhc3M9Imx1Y2lkZSBsdWNpZGUtYm90Ij48cGF0aCBkPSJNMTIgOFY0SDgiLz48cmVjdCB3aWR0aD0iMTYiIGhlaWdodD0iMTIiIHg9IjQiIHk9IjgiIHJ4PSIyIi8+PHBhdGggZD0iTTIgMTRoMiIvPjxwYXRoIGQ9Ik0yMCAxNGgyIi8+PHBhdGggZD0iTTE1IDEzdjIiLz48cGF0aCBkPSJNOSAxM3YyIi8+PC9zdmc+" alt="bot" class="bot-image">
            </button>
          </div>
          <div class="cambrian-ai-side-button-holder">
            <button class="cambrian-ai-header-button">
              <span style="font-size: 21px; color: white;">ℹ</span>
            </button>
          </div>
           <div class="cambrian-ai-side-button-holder">
            <button class="cambrian-ai-header-button">
              <span style="width: 12px;height: 12px;background: #b12b40;border-radius: 93px;"></span>
            </button>
          </div>
          <div class="cambrian-ai-side-button-holder">
            <button class="cambrian-ai-header-button">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                <path d="M5 12h14M12 5l7 7-7 7" stroke="white" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="cambrian-ai-items-container"></div>
      </div>
    </div>
    `;

  //     <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  //   <path d="M19 12H5M12 5l-7 7 7 7" stroke="white" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  // </svg>
  const existingSidePanel = document.querySelector("#cambrianAiSidePanelWrapper");
  if (!existingSidePanel) {
    const sidePanelElement = document.createElement("div");
    sidePanelElement.innerHTML = sidePanelStructure;
    document.body.appendChild(sidePanelElement.firstElementChild);
  }
}
