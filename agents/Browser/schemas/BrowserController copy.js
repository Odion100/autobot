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
      "Types the given text into the first element matching a natural language description of where you want to type",
    parameters: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description: "A simple description of the element you want to type into",
        },
        text: {
          type: "string",
          description: "The text to type into the input",
        },
      },
    },
  },
};
const findAndClick = {
  type: "function",
  function: {
    name: "findAndClick",
    description:
      "Clicks on the first element matching a natural language description of the item you want to click",
    parameters: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description: "A simple description of the element you want to click",
        },
      },
    },
  },
};
const findContent = {
  type: "function",
  function: {
    name: "findContent",
    description:
      "Finds text content based on a natural language description of the content",
    parameters: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description: "A simple description of the element from you want extract data.",
        },
      },
    },
  },
};
const findAndSelect = {
  type: "function",
  function: {
    name: "findAndSelect",
    description: "Finds and selects elements based on a natural language description.",
    parameters: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description: "A simple description of the element you want to type into",
        },
      },
    },
  },
};
const click = {
  type: "function",
  function: {
    name: "click",
    description: "Clicks on the selected element.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
};
const type = {
  type: "function",
  function: {
    name: "type",
    description: "Types into the selected input.",
    parameters: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "The text to type into the selected input",
        },
      },
    },
  },
};
const getText = {
  type: "function",
  function: {
    name: "getText",
    description: "Get the text from the selected element.",
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
          prompt: "A question or, request help for the use",
        },
      },
    },
  },
};
export default function schema(state) {
  if (state.itemSelected) {
    return [
      navigate,
      findAndType,
      findAndClick,
      findAndSelect,
      click,
      type,
      getText,
      promptUser,
    ];
  } else {
    return [navigate, findAndType, findAndClick, findAndSelect, findContent, promptUser];
  }
}

// const  tools = [
//   {
//     type: "function",
//     function: {
//       name: "navigate",
//       description: "Navigate the browser to a given URL",
//       parameters: {
//         type: "object",
//         properties: {
//           url: {
//             type: "string",
//             description: "The full URL to a web page",
//           },
//         },
//       },
//     },
//   },
//   {
//     type: "function",
//     function: {
//       name: "click",
//       description: "Click on the first element matching a CSS selector",
//       parameters: {
//         type: "object",
//         properties: {
//           selector: {
//             type: "string",
//             description: "The CSS selector for the element to click",
//           },
//         },
//       },
//     },
//   },
//   {
//     type: "function",
//     function: {
//       name: "typeToInput",
//       description: "Type text into the first element matching a CSS selector",
//       parameters: {
//         type: "object",
//         properties: {
//           selector: {
//             type: "string",
//             description: "The CSS selector for the input element",
//           },
//           text: {
//             type: "string",
//             description: "The text to type into the input element",
//           },
//         },
//       },
//     },
//   },
//   {
//     type: "function",
//     function: {
//       name: "searchHTML",
//       description:
//         "Find the css selector for an element based on a natural language description of the element",
//       parameters: {
//         type: "object",
//         properties: {
//           selectors: {
//             type: "array",
//             description:
//               "a list of natural language descriptions of the elements for which you want to find a selector",
//             items: {
//               type: "string",
//               description:
//                 "natural-language description of the element for which you want to find a selector",
//             },
//           },
//         },
//       },
//     },
//   },
// ];
