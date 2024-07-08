import OpenAI from "openai";
import dotenv from "dotenv";
import Agentci from "agentci";
dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const prompt = `You will be provided with a screenshot of an entire webpage, which has been split in to multiple sections. Each section is separated by red container with a section number in the upper right corner of the section container. Your job is to locate all elements and components necessary to completing all objectives on this webpage. 

If you think we are currently on the wrong page for completing the current step in our task please call wrongPage({ certainty, reasoning }).

1. First ensure that you are on the correct page for the current task
2. Identify all relevant elements, such as buttons, links, search bars, menus, product listings, and other elements which which are relevant to the execution of your task.
3. Identify in which section of the entire page each relevant component is located by noting the section number in the to right corner.

Provide the location of all relevant elements by calling the following function:

## locateElements({ sectionNumber, elementName })
  - sectionNumber: The section of the page in which the element is located.
  - elementName: A concise name or label to describe the element.

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

Make sure to include all necessary elements and components relevant to achieving the user's goal. If you do not see any relevant elements in the current page please call wrongPage({ certainty, reasoning }).

Good luck!`;

const schema = [
  {
    type: "function",
    function: {
      name: "locateElements",
      description: "Provide the location of all relevant elements.",
      parameters: {
        type: "object",
        properties: {
          searchResults: {
            type: "array",
            items: {
              type: "object",
              properties: {
                sectionNumber: {
                  type: "number",
                  description: "The section the element is located on the page.",
                },
                elementName: {
                  type: "string",
                  description:
                    "A concise name or label to call the element including the element functionality and type (i.e search bar, delete button, etc)",
                },
              },
              required: ["sectionNumber", "elementName"],
            },
          },
        },
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
              "A score from 1-5 representing your confidence in this assessment (1 = not confident at all, 5 = extremely confident)",
          },
          reasoning: {
            type: "string",
            description:
              "explain why you are certain we are on the wrong page for completing the current step in or objective.",
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
      functionCall: ["locateElements", "wrongPage"],
    },
    temperature: 0.5,
  });

  this.wrongPage = async function ({ certainty, reasoning }) {
    return `You may be on the wrong page. ${reasoning}`;
  };

  this.locateElements = async function (plan, { input: { totalSections } }) {
    return `This page has ${totalSections} scrollable sections. Please use the following details to help you locate relevant elements or components. 
    
    ## Element Locations

    ${getElementLocations(plan)}
    `;
  };
}
function getElementLocations(plan) {
  const { searchResults } = plan;
  let elementLocations = "";

  searchResults.forEach((step) => {
    elementLocations += `The ${step.elementName} is in Section ${step.sectionNumber}\n`;
  });

  return elementLocations;
}
// const testAgent = Agentci().rootAgent(ElementLocator);

// testAgent
//   .invoke({
//     message: "Search Amazon for the best selling laptop and add it to the cart.",
//     images: ["C:/DevSpace/3912/autobot/screenshots/Screenshot2024-07-04060923.png"],
//   })
//   .then((r) => console.log("results", r))
//   .catch(console.error);
