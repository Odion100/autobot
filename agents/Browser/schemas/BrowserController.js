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
const findAndType = {
  type: "function",
  function: {
    name: "findAndType",
    description:
      "Types the given text into the first element matching the element matching a search using a description of the element and text found in and around the element.",
    parameters: {
      type: "object",
      properties: {
        elementName: {
          type: "string",
          description: "A concise name or label to describe the element.",
        },
        elementDescription: {
          type: "string",
          description:
            "Describe the element's purpose and functionality as it relates to the entire page.",
        },
        elementText: {
          type: "string",
          description: "Any text that is visible within the element.",
        },
        containerText: {
          type: "string",
          description:
            "As much text as can be seen within the same red container as the target element. The boundaries of the container are the red box in which the element is inside",
        },
        inputText: {
          type: "string",
          description: "The text to type into the input",
        },
      },
      required: [
        "elementName",
        "elementDescription",
        "elementText",
        "containerText",
        "inputText",
      ],
    },
  },
};
const findAndClick = {
  type: "function",
  function: {
    name: "findAndClick",
    description:
      "Clicks on the first element matching a search using a description of the element and text found in and around the element.",
    parameters: {
      type: "object",
      properties: {
        elementName: {
          type: "string",
          description: "A concise name or label to describe the element.",
        },
        elementDescription: {
          type: "string",
          description:
            "Describe the element's purpose and functionality as it relates to the entire page.",
        },
        elementText: {
          type: "string",
          description: "Any text that is visible within the element.",
        },
        containerText: {
          type: "string",
          description:
            "As much text as can be seen within the same red container as the target element. The boundaries of the container are the red box in which the element is inside",
        },
      },
      required: ["elementName", "elementDescription", "elementText", "containerText"],
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
          description: "A simple description of the element from you want extract data.",
        },
      },
    },
  },
};

const scrollUp = {
  type: "function",
  function: {
    name: "scrollUp",
    description: "Scrolls the web page downward and get a screenshot.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
};
const scrollDown = {
  type: "function",
  function: {
    name: "scrollDown",
    description: "Scrolls the web page downward and get a screenshot.",
    parameters: {
      type: "object",
      properties: {},
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

export default [
  navigate,
  findAndType,
  findAndClick,
  saveContent,
  scrollUp,
  scrollDown,
  promptUser,
];
