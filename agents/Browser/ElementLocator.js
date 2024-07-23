import OpenAI from "openai";
import dotenv from "dotenv";
import Agentci from "agentci";
dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const prompt = `You will be provided with a screenshot of an entire webpage, which has been split in to multiple sections. Each section is separated by red container with a section number in the upper right corner of the section container. Your job is to locate the element or components the user is looking for. 

If you think the item cannot be found on this page call wrongPage({ certainty, reasoning }).

1. First ensure that you are on the correct page for the current task
2. Identify the relevant element or component.
3. Identify in which section of the entire page the element is located by noting the section number in the top right corner.

Provide the location of the desired elements by calling the following function:

## locateElement({ sectionNumber, certainty, reasoning, innerPosition })
  - sectionNumber: The section of the page in which the element is located.
  - certainty: A score from 1-5 representing your confidence in your assessment (1 = not confident at all, 5 = extremely confident).
  - reasoning: Explain why you are certain the correct element was found in that location. 
  - innerPosition: Is the element in the bottom, middle or top part of the specified section.

Please provide your answer in the following format:

<answer>
locateElements({
  searchResults: [
    {
      sectionNumber: 1,
      elementName: "Main Navigation Menu",
    },
    {
      sectionNumber: 1,
      elementName: "Search Submit Button"
    }
  ]
})
</answer>

Make sure to include all necessary elements and components relevant to achieving all goals on this web page. Also include any element that might be useful later.
If you do not see any relevant elements in the current page please call wrongPage({ certainty, reasoning }).
Remember, If you do not see the desired elements in the current page please call wrongPage({ certainty, reasoning }).

Good luck!`;

const schema = [
  {
    type: "function",
    function: {
      name: "locateElement",
      description: "Provide the location of all relevant elements.",
      parameters: {
        type: "object",
        properties: {
          sectionNumber: {
            type: "number",
            description: "The section the element is located on the page.",
          },
          certainty: {
            type: "number",
            description:
              "A score from 1-5 representing your confidence in your assessment (1 = not confident at all, 5 = extremely confident)",
          },
          reasoning: {
            type: "string",
            description:
              "Explain why you are certain the correct element was found in that location.",
          },
          innerPosition: {
            type: "string",
            description:
              "Is the element in the bottom, middle or top part of the specified section.",
          },
        },
        required: ["sectionNumber", "certainty", "reasoning", "innerPosition"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "wrongPage",
      description:
        "Provide a reasoning for why the necessary elements cannot be found on this page.",
      parameters: {
        type: "object",
        properties: {
          certainty: {
            type: "number",
            description:
              "A score from 1-5 representing your confidence in your assessment (1 = not confident at all, 5 = extremely confident)",
          },
          reasoning: {
            type: "string",
            description:
              "explain why you are certain we are on the wrong page for completing the current step in or objective.",
          },
          sectionNumber: {
            type: "number",
            description: "The section the element is located on the page.",
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
