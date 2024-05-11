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
          description: "text or description found in the item you are want to select",
        },
      },
    },
  },
};
const confirmSelection = {
  type: "function",
  function: {
    name: "scrollDown",
    description:
      "Confirm that the target element is selected (surrounding by a green box)",
    parameters: {
      type: "object",
      properties: {},
    },
  },
};
export default [scrollUp, scrollDown, searchContainer, confirmSelection];
