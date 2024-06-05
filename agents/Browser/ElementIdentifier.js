import OpenAI from "openai";
import dotenv from "dotenv";
import Agentci from "agentci";
dotenv.config();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const prompt = `You will be provided with two screenshots to analyze:

First, carefully examine the full page screenshot to understand the context and purpose of the webpage. 

Next, focus on the highlighted elements in the focus screenshot. Each highlighted element is surrounded by a green box with an ID number in the right corner.

Your task is to provide a description of each highlighted element using the identifyElements function. The function takes an array of objects as its argument, with each object containing the following properties:

- elementNumber: The number in the right corner of the highlighted element
- elementDescription: Describe the element's purpose and functionality as it relates to the entire page.
- elementName: A concise name or label to describe the element.

Please provide your answer in the following format:

<answer>
identifyElements([
  {
    elementNumber: 1,
    elementDescription: "This element appears to be the main navigation menu of the website, allowing users to access different sections of the site.",
    elementName: "Main Navigation Menu"
  },
  {
    elementNumber: 2,
    elementDescription: "This element is a search bar, enabling users to search for specific content within the website.",
    elementName: "Search Bar"
  }
])
</answer>

Make sure to include all highlighted elements from the focus screenshot in your answer. Provide clear and concise descriptions and names for each element based on its appearance and the context provided by the full page screenshot.
Please respond with all identifiers in one function call, with each element identifier in the array of identifiers. 

Please remember that highlighted element's ID number is in the top-right corner of the element. If you do not see a number to apply use number 0. Please examine and describe each element, while making sure you description matches the highlighted element.
`;
const schema = [
  {
    type: "function",
    function: {
      name: "identifyElements",
      description: "Provide a description for each highlighted element",
      parameters: {
        type: "object",
        properties: {
          elementNumber: {
            type: "number",
            description:
              "The number in the right corner of the highlighted element you are describing.",
          },
          elementDescription: {
            type: "string",
            description:
              "A description of the elements purpose and functionality in relation to the rest of the page.",
          },
          elementName: {
            type: "string",
            description: "A simple name or label to call the element",
          },
        },
      },
    },
  },
];
export default function ElementIdentifier() {
  this.use({
    provider: "openai",
    model: "gpt-4o",
    sdk: openai,
    schema,
    prompt,
    exitConditions: { errors: 1, iterations: 1, functionCall: "identifyElements" },
    temperature: 0.5,
  });

  this.identifyElements = async function (identifier, { state }) {
    state.identifiedElements.push(identifier);
    console.log("returin", state.identifiedElements);
    return state.identifiedElements;
  };
  this.before("$invoke", function ({ state }, next) {
    console.log("vefore invoke");
    state.identifiedElements = [];
    next();
  });
}

// const testAgent = Agentci().rootAgent(ElementIdentifier);

// testAgent
//   .invoke({
//     message: "Please identify the highlighted elements 1, 2 and 3.",
//     images: [
//       "/Users/odionedwards/autobot/screenshots/1717271184789.png",
//       "/Users/odionedwards/autobot/screenshots/1717271185235.png",
//     ],
//   })
//   .then((r) => console.log("results", r))
//   .catch(console.error);
