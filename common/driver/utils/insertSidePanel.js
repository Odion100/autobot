export default function insertSidePanel() {
  const style = `
    <style>
      #cambrianAiSidePanelWrapper .cambrian-ai-side-panel {
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
        width: 29px;
        height: 28px;
        background-color: #4CAF50;
        border: none;
        border-radius: 26px;
        font-size: 13px;
        display: flex;
        justify-content: center;
        align-items: center;
        cursor: pointer;
        opacity: 0.9;
        padding: 5px 5px;
        font-weight: bold;
      }
      #cambrianAiSidePanelWrapper .cambrian-ai-header-button:hover {
        opacity: 1;
      }
      #cambrianAiSidePanelWrapper .cambrian-ai-header-button:active {
        transform: scale(1.15);
      }
      #cambrianAiSidePanelWrapper .cambrian-ai-content-container {
        flex-grow: 1;
        overflow-y: auto;
        display: inline-flex;
      }
      #cambrianAiSidePanelWrapper .cambrian-ai-chat-container,
      #cambrianAiSidePanelWrapper .cambrian-ai-memory-container {
        margin-left: 10px;
      }
      #cambrianAiSidePanelWrapper .cambrian-ai-side-panel.cambrian-ai-panel-hidden .cambrian-ai-content-container,
      #cambrianAiSidePanelWrapper .cambrian-ai-side-panel.cambrian-ai-panel-hidden .cambrian-ai-side-button-holder:not(:last-child) {
        display: none;
      }
       #cambrianAiSidePanelWrapper .cambrian-ai-side-panel.cambrian-ai-panel-hidden {
        width: auto;
        right: -26px;
        margin: 0;
      }
      #cambrianAiSidePanelWrapper .cambrian-ai-side-panel.cambrian-ai-panel-hidden .cambrian-ai-side-button-holder {
        opacity: 0.8;
      }
    </style>
  `;

  const sidePanelStructure = `
    <div id="cambrianAiSidePanelWrapper">
      ${style}
      <div class="cambrian-ai-side-panel">
        <div class="cambrian-ai-side-header">
          <div class="cambrian-ai-side-button-holder">
            <button class="cambrian-ai-header-button" id="toggleChatButton">
              <img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIgY2xhc3M9Imx1Y2lkZSBsdWNpZGUtYm90Ij48cGF0aCBkPSJNMTIgOFY0SDgiLz48cmVjdCB3aWR0aD0iMTYiIGhlaWdodD0iMTIiIHg9IjQiIHk9IjgiIHJ4PSIyIi8+PHBhdGggZD0iTTIgMTRoMiIvPjxwYXRoIGQ9Ik0yMCAxNGgyIi8+PHBhdGggZD0iTTE1IDEzdjIiLz48cGF0aCBkPSJNOSAxM3YyIi8+PC9zdmc+" alt="bot" class="bot-image">
            </button>
          </div>
          <div class="cambrian-ai-side-button-holder">
            <button class="cambrian-ai-header-button" id="toggleMemoryButton">
              <span style="font-size: 21px; color: white;">ℹ</span>
            </button>
          </div>
          <div class="cambrian-ai-side-button-holder">
            <button class="cambrian-ai-header-button" id="showRecorderButton">
              <span style="width: 14px;height: 14px;background: #b12b40;border-radius: 93px;"></span>
            </button>
          </div>
          <div class="cambrian-ai-side-button-holder">
            <button class="cambrian-ai-header-button cambrian-ai-toggle-button">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="toggle-icon">
                <path d="M5 12h14M12 5l7 7-7 7" stroke="white" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="cambrian-ai-content-container">
          <div class="cambrian-ai-chat-container"></div>
          <div class="cambrian-ai-memory-container"></div>
        </div>
      </div>
    </div>
  `;

  if (!document.getElementById("cambrianAiSidePanelWrapper")) {
    const sidePanelElement = document.createElement("div");
    sidePanelElement.innerHTML = sidePanelStructure;
    document.body.appendChild(sidePanelElement.firstElementChild);

    // Add event listeners to the buttons
    const toggleChatButton = document.getElementById("toggleChatButton");
    const toggleMemoryButton = document.getElementById("toggleMemoryButton");
    const showRecorderButton = document.getElementById("showRecorderButton");
    const toggleSidePanelButton = document.querySelector(".cambrian-ai-toggle-button");
    const sidePanel = document.querySelector(".cambrian-ai-side-panel");

    if (toggleChatButton) {
      toggleChatButton.addEventListener("click", () => {
        if (typeof window.showChat === "function") {
          const chatContainer = document.querySelector(
            "#cambrianAiSidePanelWrapper .cambrian-ai-chat-container"
          );
          if (chatContainer.children.length) {
            chatContainer.replaceChildren();
          } else {
            window.showChat();
          }
        } else {
          console.error("window.showChat is not a function");
        }
      });
    }

    if (toggleMemoryButton) {
      toggleMemoryButton.addEventListener("click", () => {
        if (typeof window.showMemory === "function") {
          const memoryContainer = document.querySelector(
            "#cambrianAiSidePanelWrapper .cambrian-ai-memory-container"
          );
          if (memoryContainer.children.length) {
            memoryContainer.replaceChildren();
            if (typeof window.clearContainers === "function") window.clearContainers();
          } else {
            window.showMemory();
          }
        } else {
          console.error("window.showMemory is not a function");
        }
      });
    }

    if (showRecorderButton) {
      showRecorderButton.addEventListener("click", () => {
        if (typeof window.showRecorder === "function") {
          window.showRecorder();
        } else {
          console.error("window.showRecorder is not a function");
        }
      });
    }
    if (toggleSidePanelButton && sidePanel) {
      toggleSidePanelButton.addEventListener("click", () => {
        sidePanel.classList.toggle("cambrian-ai-panel-hidden");
        const toggleIcon = toggleSidePanelButton.querySelector(".toggle-icon");
        if (sidePanel.classList.contains("cambrian-ai-panel-hidden")) {
          toggleIcon.innerHTML =
            '<path d="M19 12H5M12 5l-7 7 7 7" stroke="white" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>';
        } else {
          toggleIcon.innerHTML =
            '<path d="M5 12h14M12 5l7 7-7 7" stroke="white" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>';
        }
      });
    }
  } else {
    const sidePanelElement = document.getElementById("cambrianAiSidePanelWrapper");
    sidePanelElement.style.display = "initial";
  }
}
