import OpenAI from "openai";
import dotenv from "dotenv";
dotenv.config();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
function prompt({ input }) {
  return `You are an AI assistant designed to help users find specific elements or content on web pages by analyzing a screenshot. 
  
  The use is looking for the following item: ${input.elementName}
  
  Please carefully examine the screenshot, paying close attention to the selected element, which is highlighted by the green box. Determine if the highlighted element represents what the user is searching for.
  
  Write out your reasoning for why you believe the highlighted element either does or does not match the user's search query. Explain what specific aspects of the highlighted element led you to your conclusion.
  
  Finally, based on your reasoning above, if you believe the highlighted element matches what the user is looking for, call:
  
  yes(certainty)
  
  Where certainty is a score from 1-5 representing your confidence in the match (1 = not confident at all, 5 = extremely confident)
  
  If you believe the highlighted element does not match what the user is looking for, or no element is highlighted, call:
  
  no()
  
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
