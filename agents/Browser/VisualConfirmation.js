import OpenAI from "openai";
import dotenv from "dotenv";
dotenv.config();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
function prompt({ input }) {
  return `You are an AI assistant designed to help users find specific elements or container on web pages by analyzing a screenshot. 
  
  The component you are looking for is based on the following search criteria. 

  - Container Name: ${input.containerName}
  - Container Purpose: ${input.containerPurpose}
  - Container Text: ${input.containerText}
  - Element Name: ${input.elementName}
  - Element Purpose: ${input.elementPurpose}
  - Inner Text: ${input.innerText}

  
  Please carefully examine the screenshot, paying close attention to the selected element or container, which is highlighted by the green box. Determine if the highlighted element or container represents what the user is searching for by examining the text content or description of the container or element.
  
  Write out your reasoning for why you believe the highlighted element or container does or does not match the user's search query. Explain what specific aspects of the highlighted element or container led you to your conclusion.
  
  Finally, based on your reasoning above, if you believe the highlighted component matches what the user is looking for, call:
  
  yes({ certainty, reasoning })
  
  Where certainty is a score from 1-5 representing your confidence in the match (1 = not confident at all, 5 = extremely confident)
  
  If you believe the highlighted component does not match what the user is looking for, or no element is highlighted, call:
  
  no({ certainty , reasoning })
  Good Luck!
  `;
}
const yes = {
  type: "function",
  function: {
    name: "yes",
    description: "Indicates that the selected element matching the user's query.",
    parameters: {
      type: "object",
      properties: {
        certainty: {
          type: "number",
          description:
            "A score from 1-5 representing your confidence in the match (1 = not confident at all, 5 = extremely confident)",
        },
        reasoning: {
          type: "string",
          description:
            "explain why you are certain the selected component matches the user's query",
        },
        // matchingText: {
        //   type: "string",
        //   description: "print all matching text that helped you draw a conclusion",
        // },
      },
      required: ["certainty", "reasoning"],
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
      properties: {
        certainty: {
          type: "number",
          description:
            "A score from 1-5 representing your confidence in the match (1 = not confident at all, 5 = extremely confident)",
        },
        reasoning: {
          type: "string",
          description:
            "explain why you are certain the selected component matches the user's query",
        },
      },
      required: ["certainty", "reasoning"],
    },
  },
};

const schema = [yes, no];
export default function VisualConfirmation() {
  this.use({
    provider: "openai",
    model: "gpt-4o",
    sdk: openai,
    schema,
    prompt,
    exitConditions: { functionCall: ["yes", "no"], errors: 1 },
    temperature: 0.5,
  });

  this.yes = async function ({ certainty }) {
    return true;
  };

  this.no = function () {
    return false;
  };
}
