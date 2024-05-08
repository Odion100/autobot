const selectElement = {
  type: "function",
  function: {
    name: "selectElement",
    description: "Select and element inside the target container.",
    parameters: {
      type: "object",
      properties: {
        searchText: {
          type: "string",
          description: "text or description found in the item you are want to select",
        },
      },
    },
  },
};
const invalidContainer = {
  type: "function",
  function: {
    name: "invalidContainer",
    description:
      "Indicates that the highlighted container does not match or container the target item.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
};
const itemFound = {
  type: "function",
  function: {
    name: "itemFound",
    description: "Indicates that the that the correct item has been selected.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
};

export default [selectElement, invalidContainer, itemFound];
