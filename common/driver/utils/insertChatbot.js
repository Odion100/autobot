export default function insertChatbot(messages) {
  function convertMarkdown(markdownText) {
    const markdown = markdownText.replace(/@internalInstructions:[\s\S]*$/, "");
    if (!markdown) return "";
    // Configure marked options
    marked.setOptions({
      gfm: true,
      breaks: true,
      highlight: function (code, lang) {
        if (Prism.languages[lang]) {
          return Prism.highlight(code, Prism.languages[lang], lang);
        }
        return code;
      },
      langPrefix: "language-",
      pedantic: false,
      smartLists: true,
      smartypants: false,
      xhtml: false,
    });
    console.log("markdown", markdown);
    // Parse Markdown to HTML
    let html = marked(markdown);

    // Post-process the HTML
    html = html.replace(
      /<pre><code class="(language-\w+)">/g,
      '<pre class="$1"><code class="$1">'
    );

    // Fix potentially broken tables
    html = html.replace(/<code>([|].*?[|])<\/code>/g, "$1");

    // Wrap tables with a div for potential scrolling
    html = html.replace(/<table>/g, '<div class="table-wrapper"><table>');
    html = html.replace(/<\/table>/g, "</table></div>");

    // Wrap the entire output in a div with class "markdown"
    return `<div class="markdown">${html}</div>`;
  }

  const chatbotHTML = `
    <div id="chat-bot">
      <div class="chat-messages">
        ${messages
          .map(
            (message) => `
          <div class="message-container">
            ${
              message.role === "assistant"
                ? '<img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIgY2xhc3M9Imx1Y2lkZSBsdWNpZGUtYm90Ij48cGF0aCBkPSJNMTIgOFY0SDgiLz48cmVjdCB3aWR0aD0iMTYiIGhlaWdodD0iMTIiIHg9IjQiIHk9IjgiIHJ4PSIyIi8+PHBhdGggZD0iTTIgMTRoMiIvPjxwYXRoIGQ9Ik0yMCAxNGgyIi8+PHBhdGggZD0iTTE1IDEzdjIiLz48cGF0aCBkPSJNOSAxM3YyIi8+PC9zdmc+" alt="bot" class="bot-image">'
                : ""
            }
            <div class="message ${
              message.role === "user" ? "user" : "bot"
            }">${convertMarkdown(message.message || "")}</div>
          </div>
        `
          )
          .join("")}
      </div>
      <div class="chat-input">
        <textarea placeholder="Type a message..." rows="1"></textarea>
        <img class="send-button" src="data:image/png;base64,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" alt="Converted image">
      </div>
    </div>
  `;

  const style = `
    <style id="cambrian-ai-chat-display">
      #cambrianAiSidePanelWrapper #chat-bot {
        width: 660px;
        display: flex;
        flex-direction: column;
        background: #282c34;
        border: 1px solid black;
        border: 1px solid #c023a6;
        border: 1px dashed #0fff0e;
        border-radius: 5px;
        max-height: 85vh;
        min-height: 33vh;
        opacity: .9;
      }
      #cambrianAiSidePanelWrapper #chat-bot:hover {
        opacity: 1;
      }
      #cambrianAiSidePanelWrapper .chat-messages {
        flex: 1;
        overflow-y: auto;
        padding: 10px;
        margin-right: 10px;
      }

      #cambrianAiSidePanelWrapper .message {
        margin: 5px;
        padding: 8px;
        border-radius: 5px;
      }

      #cambrianAiSidePanelWrapper .user {
        margin-left: auto;
        background-color: #8e9c7a;
      }
      #cambrianAiSidePanelWrapper .user * {
        color: #090b0d !important;
      }
      #cambrianAiSidePanelWrapper .bot {
        background-color: #333741;
        color: #fff;
      }

      #cambrianAiSidePanelWrapper .chat-input {
        display: flex;
        align-items: center;
        padding: 10px;
        margin: 10px;
        border: 1px solid #0f0f0f;
        border-radius: 4px;
        background-color: #282c34;
      }

      #cambrianAiSidePanelWrapper .chat-input textarea {
        flex: 1;
        padding: 8px;
        border: none;
        border-radius: 5px;
        margin-right: 10px;
        min-height: 42px;
        max-height: 100px;
        resize: none;
        font-size: 16px;
        background-color: #fff !important;
      }

      #cambrianAiSidePanelWrapper .chat-input textarea:focus {
        outline: none;
      }

      #cambrianAiSidePanelWrapper .send-button {
        cursor: pointer;
      }

      #cambrianAiSidePanelWrapper .bot-image {
        width: 25px;
        height: 25px;
        margin: 10px 6px;
      }

      #cambrianAiSidePanelWrapper .message-container {
        display: flex;
      }

      @keyframes pulse {
        0% { opacity: 0.5; }
        50% { opacity: 1; }
        100% { opacity: 0.5; }
      }

      #cambrianAiSidePanelWrapper .loading-message {
        display: flex;
        align-items: center;
        padding: 8px;
        background-color: #333741;
        border-radius: 5px;
        color: #fff;
        animation: pulse 1.5s infinite;
      }

      #cambrianAiSidePanelWrapper .loading-dots {
        display: flex;
        margin-left: 8px;
      }

      #cambrianAiSidePanelWrapper .loading-dot {
        width: 8px;
        height: 8px;
        background-color: #fff;
        border-radius: 50%;
        margin: 0 2px;
      }
    </style>
  `;
  const sidePanel = document.querySelector("#cambrianAiSidePanelWrapper");
  if (!sidePanel.querySelector("style#cambrian-ai-chat-display")) {
    sidePanel.insertAdjacentHTML("afterbegin", style);
  }
  // Insert the memory display content
  const itemsContainer = document.querySelector(
    "#cambrianAiSidePanelWrapper .cambrian-ai-chat-container"
  );
  itemsContainer.innerHTML = chatbotHTML;

  // Get references to important elements
  const sendButton = itemsContainer.querySelector(".send-button");
  const textareaField = itemsContainer.querySelector(".chat-input textarea");
  const messagesContainer = itemsContainer.querySelector(".chat-messages");

  // Function to add a new message
  function addMessage(role, message) {
    const messageElement = document.createElement("div");
    messageElement.className = "message-container";
    messageElement.innerHTML = `
       <div class="message ${role === "user" ? "user" : "bot"}">${convertMarkdown(
      message
    )}</div>
     `;
    messagesContainer.appendChild(messageElement);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  // Function to add a loading message
  function addLoadingMessage() {
    const messageElement = document.createElement("div");
    messageElement.className = "message-container";
    messageElement.innerHTML = `
     <img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIgY2xhc3M9Imx1Y2lkZSBsdWNpZGUtYm90Ij48cGF0aCBkPSJNMTIgOFY0SDgiLz48cmVjdCB3aWR0aD0iMTYiIGhlaWdodD0iMTIiIHg9IjQiIHk9IjgiIHJ4PSIyIi8+PHBhdGggZD0iTTIgMTRoMiIvPjxwYXRoIGQ9Ik0yMCAxNGgyIi8+PHBhdGggZD0iTTE1IDEzdjIiLz48cGF0aCBkPSJNOSAxM3YyIi8+PC9zdmc+" alt="bot" class="bot-image">
     <div class="loading-message">
       Thinking
       <div class="loading-dots">
         <div class="loading-dot"></div>
         <div class="loading-dot"></div>
         <div class="loading-dot"></div>
       </div>
     </div>
   `;
    messagesContainer.appendChild(messageElement);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  // Function to handle sending a message
  function handleSendMessage() {
    const message = textareaField.value.trim();
    if (message) {
      addMessage("user", message);
      messages.push({ message, role: "user" });
      textareaField.value = "";
      textareaField.style.height = "26px";
      console.log("message", message);
      addLoadingMessage(); // Add this line to show the loading message
      window.insertChatMessage(message);
    }
  }

  // Add event listeners
  sendButton.addEventListener("click", handleSendMessage);

  textareaField.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  });

  textareaField.addEventListener("input", () => {
    textareaField.style.height = "26px";
    textareaField.style.height = `${Math.min(textareaField.scrollHeight, 100)}px`;
  });

  // Scroll to the bottom of the messages
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}
