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
const searchContainer = {
  type: "function",
  function: {
    name: "searchContainer",
    description:
      "Searches a given container and selects an element based on the searchText",
    parameters: {
      type: "object",
      properties: {
        container: {
          type: "number",
          description: "Then numbers of box you want to search",
        },
        searchText: {
          type: "string",
          description:
            "A description of the element (ie. shopping cart button) or text found in the element you are want to select",
        },
      },
    },
  },
};
export default [scrollUp, scrollDown, searchContainer];
