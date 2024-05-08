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
const containersFound = {
  type: "function",
  function: {
    name: "containersFound",
    description: "Returns the box numbers of the target containers",
    parameters: {
      type: "object",
      properties: {
        containers: {
          type: "array",
          description: "An array of numbers referencing each box matching the query",
          items: {
            type: "number",
          },
        },
      },
    },
  },
};

export default [scrollUp, scrollDown, containersFound];
