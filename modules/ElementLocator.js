import OpenAI from "openai";
import dotenv from "dotenv";
import Agentci from "agentci";
dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const prompt = ({
  input,
}) => `You will be provided with a screenshot of an entire webpage, which has been split into multiple sections. Each section is separated by a red container with a section number in the upper right corner.

## Search Criteria
Your task is to find the element or components that match the following search criteria:

- **Container Name**: ${input.containerName}
- **Container Functionality**: ${input.containerFunctionality}
- **Element Name**: ${input.elementName}
- **Element Functionality**: ${input.elementFunctionality}

## Guidelines
1. Ensure that you are on the correct page for the current task.
2. Identify the relevant element or component.
3. Note the section number where the element is located.
4. Pay attention to the context and surrounding elements to ensure accuracy.

## Reporting Functions

### If the element is found:
Call the \`locateElement\` function with the following parameters:

\`locateElement({ sectionNumber, certainty, reasoning, innerPosition })\`
- **sectionNumber**: The section of the page where the element is located.
- **certainty**: A score from 1-5 representing your confidence (1 = not confident at all, 5 = extremely confident).
- **reasoning**: Explain why you are certain the correct element was found. Your reasoning should be helpful and instructive.

### If the element is not found:
Call the \`wrongPage\` function with the following parameters:

\`wrongPage({ certainty, reasoning })\`
- **certainty**: A score from 1-5 representing your confidence that the page is incorrect.
- **reasoning**: Explain why you believe we are on the wrong page for completing the current task.

## Function Call Examples

<example>
locateElement({
  sectionNumber: 1,
  certainty: 5,
  reasoning: "The search bar can be seen at the top of the web page in section 1. It matches the description of '${input.elementName}' and its functionality of '${input.elementFunctionality}'.",
  innerPosition: "top-center"
})
</example>

OR

<example>
wrongPage({
  certainty: 4,
  reasoning: "The page does not contain any elements matching the description of '${input.elementName}' with the functionality of '${input.elementFunctionality}'. The content appears to be unrelated to the desired task."
})
</example>

Remember to thoroughly examine all sections of the page before concluding that the element is not present. Good luck!`;

const schema = [
  {
    type: "function",
    function: {
      name: "locateElement",
      description: "Provide the location of the element matching the search criteria.",
      parameters: {
        type: "object",
        properties: {
          sectionNumber: {
            type: "number",
            description: "The section where the element is located.",
          },
          certainty: {
            type: "number",
            description:
              "A score from 1-5 representing your confidence in your assessment (1 = not confident at all, 5 = extremely confident).",
          },
          reasoning: {
            type: "string",
            description:
              "Explain why you are certain the correct element was found in that location. The reasoning should be helpful and instructive.",
          },
        },
        required: ["sectionNumber", "certainty", "reasoning"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "wrongPage",
      description:
        "Provide reasoning for why the necessary elements cannot be found on this page.",
      parameters: {
        type: "object",
        properties: {
          certainty: {
            type: "number",
            description:
              "A score from 1-5 representing your confidence in your assessment (1 = not confident at all, 5 = extremely confident).",
          },
          reasoning: {
            type: "string",
            description:
              "Explain why you are certain we are on the wrong page for completing the current step or objective. The reasoning should be helpful and instructive.",
          },
        },
        required: ["certainty", "reasoning"],
      },
    },
  },
];

export default function ElementLocator() {
  this.use({
    provider: "openai",
    model: "gpt-4o",
    sdk: openai,
    schema,
    prompt,
    exitConditions: {
      errors: 1,
      functionCall: ["locateElement", "wrongPage"],
    },
    temperature: 0.5,
  });

  this.wrongPage = async function (results) {
    return results;
  };

  this.locateElement = async function (locationData) {
    return locationData;
  };
}

// const testAgent = Agentci().rootAgent(ElementLocator);

// testAgent
//   .invoke({
//     message: "Search Amazon for the best selling laptop and add it to the cart.",
//     images: ["C:/DevSpace/3912/autobot/screenshots/Screenshot2024-07-04060923.png"],
//   })
//   .then((r) => console.log("results", r))
//   .catch(console.error);
