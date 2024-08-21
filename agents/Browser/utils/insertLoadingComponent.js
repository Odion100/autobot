export default function updateLoadingComponent(
  tasks,
  containerId = "cambrian-ai-loading-component-container"
) {
  const loadingHTML = `
    <div id="cambrian-ai-loading-component">
      <div class="cambrian-ai-loading-header">
        <img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIgY2xhc3M9Imx1Y2lkZSBsdWNpZGUtYm90Ij48cGF0aCBkPSJNMTIgOFY0SDgiLz48cmVjdCB3aWR0aD0iMTYiIGhlaWdodD0iMTIiIHg9IjQiIHk9IjgiIHJ4PSIyIi8+PHBhdGggZD0iTTIgMTRoMiIvPjxwYXRoIGQ9Ik0yMCAxNGgyIi8+PHBhdGggZD0iTTE1IDEzdjIiLz48cGF0aCBkPSJNOSAxM3YyIi8+PC9zdmc+" alt="bot" class="cambrian-ai-bot-image">
        <span class="cambrian-ai-loading-message">Loading, please wait...</span>
      </div>
      <ul class="cambrian-ai-loading-tasks">
        ${tasks
          .map(
            (task) => `
          <li class="cambrian-ai-task ${
            task.complete ? "cambrian-ai-completed" : ""
          }" data-task="${task.task}">
            <span class="cambrian-ai-task-name">${task.task}</span>
            <span class="cambrian-ai-task-status"></span>
          </li>
        `
          )
          .join("")}
      </ul>
    </div>
  `;

  const style = `
    <style id="cambrian-ai-loading-component-style">
      @keyframes cambrian-ai-rotate {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
      
      #cambrian-ai-loading-component {
        width: 350px;
        background: #282c34;
        border: 1px dashed #ff5858;
        border-radius: 5px;
        padding: 15px;
        color: #fff;
        font-family: Arial, sans-serif;
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 500000;
        opacity: .9;
      }
      .cambrian-ai-loading-header {
        display: flex;
        align-items: center;
        margin-bottom: 15px;
      }
      .cambrian-ai-bot-image {
        width: 24px;
        height: 24px;
        margin-right: 10px;
      }
      .cambrian-ai-loading-message {
        font-size: 16px;
        font-weight: bold;
      }
      .cambrian-ai-loading-tasks {
        list-style-type: none;
        padding: 0;
        margin: 0;
      }
      .cambrian-ai-task {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
        color: #fff;
      }
      .cambrian-ai-task-name {
        font-size: 14px;
      }
      .cambrian-ai-task-status {
        position: relative;
        width: 1em;
        height: 1em;
        line-height: 1;
        display: inline-block;
      }
      .cambrian-ai-task-status::before {
        content: '⏳';
        font-size: 16px;
        position: absolute;
        top: 0;
        left: 0;
        animation: cambrian-ai-rotate 6s linear infinite;
      }
      .cambrian-ai-task.cambrian-ai-completed .cambrian-ai-task-status::before {
        content: '✅';
        animation: none;
      }
    </style>
  `;

  // Insert the style if it doesn't exist
  if (!document.querySelector("style#cambrian-ai-loading-component-style")) {
    document.head.insertAdjacentHTML("beforeend", style);
  }

  // Get or create the container
  let container = document.getElementById(containerId);
  if (!container) {
    container = document.createElement("div");
    container.id = containerId;
    document.body.appendChild(container);
  }

  // If the loading component doesn't exist, create it
  if (!container.querySelector("#cambrian-ai-loading-component")) {
    container.innerHTML = loadingHTML;
  } else {
    // If it exists, update the tasks
    const taskList = container.querySelector(".cambrian-ai-loading-tasks");
    taskList.innerHTML = tasks
      .map(
        (task) => `
      <li class="cambrian-ai-task ${
        task.complete ? "cambrian-ai-completed" : ""
      }" data-task="${task.task}">
        <span class="cambrian-ai-task-name">${task.task}</span>
        <span class="cambrian-ai-task-status"></span>
      </li>
    `
      )
      .join("");
  }

  // If all tasks are completed, update the loading message
  if (tasks.every((task) => task.complete)) {
    const loadingMessage = container.querySelector(".cambrian-ai-loading-message");
    loadingMessage.textContent = "All tasks completed!";
  }
}
