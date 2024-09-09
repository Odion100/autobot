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
          identifiedElementId: {
            type: "string",
            description: `Use this value ONLY when selecting an element from Identified Elements.`,
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
          identifiedElementId: {
            type: "string",
            description: `Use this value ONLY when selecting an element from Identified Elements.`,
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

  const executeJob = {
    type: "function",
    function: {
      name: "executeJob",
      description: "Executes a previously saved job with the given ID.",
      parameters: {
        type: "object",
        properties: {
          jobId: {
            type: "string",
            description: "The unique identifier of the job to execute.",
          },
        },
        required: ["jobId"],
      },
    },
  };

  const updateJob = {
    type: "function",
    function: {
      name: "updateJob",
      description:
        "Updates an existing job with the given ID, title, instructions, and milestones.",
      parameters: {
        type: "object",
        properties: {
          jobId: {
            type: "string",
            description: "The unique identifier of the job to update.",
          },
          title: {
            type: "string",
            description: "The title of the job.",
          },
          instructions: {
            type: "string",
            description:
              "A directive for executing the job that will be passed on to another agent. This is a directive not a description or a list. Do not micro manage. Do not be to specific. Do not give direction on how to complete the job.",
          },
          milestones: {
            type: "array",
            items: {
              type: "string",
            },
            description: "An array of milestone objectives for the job.",
          },
        },
        required: ["jobId", "title", "instructions", "milestones"],
      },
    },
  };

  const createJob = {
    type: "function",
    function: {
      name: "createJob",
      description:
        "Creates a new job with the given title, instructions, and milestone objectives.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "The title of the new job.",
          },
          instructions: {
            type: "string",
            description:
              "A directive for executing the job that will be passed on to another agent. This is a directive not a description or a list. Do not micro manage. Do not be to specific. Do not give direction on how to complete the job.",
          },
          milestones: {
            type: "array",
            items: {
              type: "string",
            },
            description: "An array of milestone objectives for the job.",
          },
        },
        required: ["title", "instructions", "milestones"],
      },
    },
  };

  const getScreenshot = {
    type: "function",
    function: {
      name: "getScreenshot",
      description: "Captures and returns a screenshot of the current webpage state",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  };

  return [
    navigate,
    getScreenshot,
    click,
    type,
    scrollUp,
    scrollDown,
    executeJob,
    updateJob,
    createJob,
  ];
}
