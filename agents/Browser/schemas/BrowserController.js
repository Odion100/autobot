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
            description: `A specific, unique name or label for the element based on its visible content or attributes. Avoid generic descriptors like "first option" or "second listing". Instead, use distinguishing features or exact text content, e.g., "Buy Now button for Wireless Headphones" or "Username input field"`,
          },
          elementDescription: {
            type: "string",
            description:
              "Describe the element's visible features and identifiers including general description, colors, text, and position.",
          },
          elementPurpose: {
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
            description: `A specific, unique name or label for the component based on its visible content or attributes. Avoid generic descriptors like "first option" or "second listing". Instead, use distinguishing features or exact text content, e.g., "Buy Now button for Wireless Headphones" or "Username input field`,
          },
          containerPurpose: {
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
        },
        required: [
          "elementName",
          "elementPurpose",
          "elementDescription",
          "innerText",
          "containerText",
          "containerName",
          "containerPurpose",
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
            description:
              "A concise name or label to call the element specific to details you can see about the element or its container (i.e search bar, delete button, etc)",
          },
          elementDescription: {
            type: "string",
            description:
              "Describe the element's visible features and identifiers including general description, colors, text, and position.",
          },
          elementPurpose: {
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
            description: `A specific, unique name or label for the component based on its visible content or attributes. Avoid generic descriptors like "first option" or "second listing". Instead, use distinguishing features or exact text content, e.g., "Buy Now button for Wireless Headphones" or "Username input field`,
          },
          containerPurpose: {
            type: "string",
            description:
              "Describe the container's purpose and it's functionality as it relates to this specific component the page.",
          },
          containerText: {
            type: "string",
            description:
              "As much text as can be seen around the element and within the same red container as the target element. The boundaries of the container are the red box in which the element is found",
          },
        },
        required: [
          "elementName",
          "elementPurpose",
          "elementDescription",
          "innerText",
          "containerText",
          "containerName",
          "containerPurpose",
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
      description: `Use scrollUp to move up a fullscreen-length section of the webpage. You are currently at section ${state.currentSection}. There are ${state.totalSections} in the webpage, wherein section 1 is the top of the page.`,
      parameters: {
        type: "object",
        properties: {
          scrollLength: {
            type: "number",
            description:
              "a number greater than zero representing the amount of space to scroll to as a percentage of the screen size. For example 2 will scroll by the size of the screen twice, while .5 will scroll only half the length of the screen size.",
          },
        },
      },
    },
  };
  const scrollDown = {
    type: "function",
    function: {
      name: "scrollDown",
      description: `Use scrollDown to move down a fullscreen-length section of the webpage. You are currently at section ${state.currentSection}. There are ${state.totalSections} in the webpage, wherein section 1 is the top of the page.`,
      parameters: {
        type: "object",
        properties: {
          scrollLength: {
            type: "number",
            description:
              "a number greater than zero representing the amount of space to scroll to as a percentage of the screen size. For example 2 will scroll by the size of the screen twice, while .5 will scroll only half the length of the screen size.",
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
