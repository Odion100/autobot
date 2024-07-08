import OpenAI from "openai";
import dotenv from "dotenv";
import Agentci from "agentci";
dotenv.config();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const prompt = ({ input }) => `You will be provided with two screenshots to analyze:

First, carefully examine the full page screenshot to understand the context and purpose of the webpage. 

Next, focus on the highlighted elements in the focus screenshot. Each highlighted element is surrounded by a green box with an ID number in the right corner.

Your task is to identify the target element using the identifyElements function. Identify the element that match the following search criteria.



The identifyElements function takes an object which contains the following properties:

- elementNumber: The ID number in the right corner of the target element
- elementDescription: Describe the element visible features and identifiers including general description, colors, text, and position.
- elementPurpose: Describe the element's purpose and functionality as it relates it's larger component and to the entire page.
- elementName: A concise name or label to describe the element.

Please provide your answer in the following format:

<answer>
identifyElements(
  {
    elementNumber: 1,
    elementDescription: "This element white button...",
    elementPurpose: "This element appears to be the main navigation menu of the website, allowing users to access different sections of the site.",
    elementName: "Main Navigation Menu"
  },
)
</answer>

If the element can not be seen, or is not highlighted, in the screen shot return 0 as the elementNumber and an empty string for the remaining values.
<answer>
identifyElements(
  {
    elementNumber: 0,
    elementDescription: "",
    elementPurpose: "",
    elementName: ""
  },
)
</answer>


Provide clear and concise descriptions and names for each element based on its appearance and the context provided by the full page screenshot.
Please respond with all identifiers in one function call, with each element identifier in the array of identifiers. 
`;
const schema = [
  {
    type: "function",
    function: {
      name: "identifyElements",
      description: "Provide a description for the target element",
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
              "Describe the element's visible features and identifiers including general description, colors, text, and position.",
          },
          elementPurpose: {
            type: "string",
            description:
              "Describe the element's purpose and it's functionality as it relates to the entire page.",
          },
          elementName: {
            type: "string",
            description:
              "A concise name or label to call the element including the element functionality and type (i.e search bar, delete button, etc)",
          },
        },
      },
    },
  },
];
export default function ElementIdentifier2() {
  this.use({
    provider: "openai",
    model: "gpt-4o",
    sdk: openai,
    schema,
    prompt,
    exitConditions: { errors: 1, functionCall: "identifyElements" },
    temperature: 0.5,
  });

  this.identifyElements = async function (identifier, { state }) {
    state.identifiedElements.push(identifier);
    return state.identifiedElements;
  };
  this.before("$invoke", function ({ state }, next) {
    state.identifiedElements = [];
    next();
  });
}

// const testAgent = Agentci().rootAgent(ElementIdentifier2);

// testAgent
//   .invoke({
//     message:
//       "Please identify the link into the second listing, Everything You Need to Ace Math in One Big Fat Notebook: The Complete Mid - GOOD $4.42 Buy It Now Free shipping Free returns second.sale (3,394,342) 98.3%.",
//     images: [
//       "/Users/odionedwards/autobot/screenshots/1720106490598.png",
//       "/Users/odionedwards/autobot/screenshots/1720106834911.png",
//     ],
//   })
//   .then((r) => console.log("results", r))
//   .catch(console.error);
