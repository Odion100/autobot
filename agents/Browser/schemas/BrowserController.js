export default tools = [
  {
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
  },
  {
    type: "function",
    function: {
      name: "click",
      description: "Click on the first element matching a CSS selector",
      parameters: {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description: "The CSS selector for the element to click",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "typeToInput",
      description: "Type text into the first element matching a CSS selector",
      parameters: {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description: "The CSS selector for the input element",
          },
          text: {
            type: "string",
            description: "The text to type into the input element",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "searchHTML",
      description:
        "Find the css selector for an element based on a natural language description of the element",
      parameters: {
        type: "object",
        properties: {
          selectors: {
            type: "array",
            description:
              "a list of natural language descriptions of the elements for which you want to find a selector",
            items: {
              type: "string",
              description:
                "natural-language description of the element for which you want to find a selector",
            },
          },
        },
      },
    },
  },
];
