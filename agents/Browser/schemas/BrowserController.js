export default function ({ state }) {
  const navigate = {
    type: "function",
    function: {
      name: "navigate",
      description: "Navigate the browser to a given URL",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The full URL to a web page",
          },
        },
      },
    },
  };
  const type = {
    type: "function",
    function: {
      name: "type",
      description:
        "Types the given text into the first element matching the element matching a search using a description of the element and text found within the same red box as the element.",
      parameters: {
        type: "object",
        properties: {
          elementName: {
            type: "string",
            description: `Provide a specific, distinguishing name or label for the element based on its visible details or functionality. Use distinguishing functionality or exact text content."`,
          },
          elementDescription: {
            type: "string",
            description:
              "Describe the element's visible features and identifiers including general description, colors, text, and position.",
          },
          elementFunctionality: {
            type: "string",
            description:
              "Describe the element's specific purpose and functionality in relation to its component and the entire page.",
          },
          innerText: {
            type: "string",
            description: "As much text as can be seen within the element.",
          },
          containerName: {
            type: "string",
            description: `Provide a concise, specific label for the container based on its content visible on the page, e.g., "Wireless Headphones XH-2000 Product Details and Purchase Options Panel. For ALL containerName values, use highly specific, distinguishing labels that uniquely identify container. Avoid generic terms like "product container", "search results". Instead, use names that precisely describe the element's unique role or content on this specific page, such as "iPhone 14 Pro configuration panel" or "Prime Video categories dropdown".`,
          },
          containerFunctionality: {
            type: "string",
            description:
              "Describe the container's purpose and it's functionality as it relates to this specific component the page.",
          },
          containerText: {
            type: "string",
            description:
              "As much text as can be seen around the element and within the same red container as the target element. The boundaries of the container are the red box in which the element is found",
          },
          inputText: {
            type: "string",
            description: "The text to type into the input",
          },
          domainMemoryId: {
            type: "string",
            description: `Use this value ONLY when selecting an element from Domain Memory.`,
          },
        },
        required: [
          "elementName",
          "elementFunctionality",
          "elementDescription",
          "innerText",
          "containerText",
          "containerName",
          "containerFunctionality",
          "inputText",
        ],
      },
    },
  };
  const click = {
    type: "function",
    function: {
      name: "click",
      description:
        "Clicks on the first element matching a search using a description of the element and text found within the same red box as the element.",
      parameters: {
        type: "object",
        properties: {
          elementName: {
            type: "string",
            description: `Provide a specific, distinguishing name or label for the element based on its visible details or functionality. Use distinguishing functionality or exact text content."`,
          },
          elementDescription: {
            type: "string",
            description:
              "Describe the element's visible features and identifiers including general description, colors, text, and position.",
          },
          elementFunctionality: {
            type: "string",
            description:
              "Describe the element's purpose and it's functionality as it relates to the entire page.",
          },
          innerText: {
            type: "string",
            description: "As much text as can be seen within the element.",
          },
          containerName: {
            type: "string",
            description: `Provide a concise, specific label for the container based on its content visible on the page, e.g., "Wireless Headphones XH-2000 Product Details and Purchase Options Panel. For ALL containerName values, use highly specific, distinguishing labels that uniquely identify container. Avoid generic terms like "product container", "search results". Instead, use names that precisely describe the element's unique role or content on this specific page, such as "iPhone 14 Pro configuration panel" or "Prime Video categories dropdown".`,
          },
          containerFunctionality: {
            type: "string",
            description:
              "Describe the container's purpose and it's functionality as it relates to this specific component the page.",
          },
          containerText: {
            type: "string",
            description:
              "As much text as can be seen around the element and within the same red container as the target element. The boundaries of the container are the red box in which the element is found",
          },
          domainMemoryId: {
            type: "string",
            description: `Use this value ONLY when selecting an element from Domain Memory.`,
          },
        },
        required: [
          "elementName",
          "elementFunctionality",
          "elementDescription",
          "innerText",
          "containerText",
          "containerName",
          "containerFunctionality",
        ],
      },
    },
  };
  const saveContent = {
    type: "function",
    function: {
      name: "saveContent",
      description:
        "Use this function to collect any data you can see on the screen. The content should be a list of the data collected in csv format.",
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description:
              "A simple description of the element from you want extract data.",
          },
        },
      },
    },
  };

  const scrollUp = {
    type: "function",
    function: {
      name: "scrollUp",
      description: `Use scrollUp to move up a portion of the webpage. You are currently at section ${state.currentSection}. There are ${state.totalSections} in the webpage, where section 1 is the top of the page.`,
      parameters: {
        type: "object",
        properties: {
          scrollLength: {
            type: "number",
            description:
              "A number representing the amount of scrolling. A value of 1 scrolls up half the screen's height, while a value of 2 scrolls up the full screen's height.",
          },
        },
      },
    },
  };

  const scrollDown = {
    type: "function",
    function: {
      name: "scrollDown",
      description: `Use scrollDown to move down a portion of the webpage. You are currently at section ${state.currentSection}. There are ${state.totalSections} in the webpage, where section 1 is the top of the page.`,
      parameters: {
        type: "object",
        properties: {
          scrollLength: {
            type: "number",
            description:
              "A number representing the amount of scrolling. A value of 1 scrolls down half the screen's height, while a value of 2 scrolls down the full screen's height.",
          },
        },
      },
    },
  };

  const promptUser = {
    type: "function",
    function: {
      name: "promptUser",
      description:
        "Used this method to question or prompt the user for help or information.",
      parameters: {
        type: "object",
        properties: {
          text: {
            type: "string",
            prompt:
              "Call the function when you have completed your task or if to ask the user for context or clarification.",
          },
        },
      },
    },
  };

  return [navigate, type, click, saveContent, scrollUp, scrollDown, promptUser];
}
