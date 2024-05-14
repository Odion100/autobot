const yes = {
  type: "function",
  function: {
    name: "yes",
    description: "Indicates that the selected element matching the user's query.",
    parameters: {
      type: "object",
      properties: {
        searchText: {
          type: "string",
          certainty:
            "A score from 1-5 representing your confidence in the match (1 = not confident at all, 5 = extremely confident)",
        },
      },
    },
  },
};
const no = {
  type: "function",
  function: {
    name: "no",
    description:
      "Indicates that the selected element does not match what the user is search for, or that no item is selected",
    parameters: {
      type: "object",
      properties: {},
    },
  },
};

export default [yes, no];
