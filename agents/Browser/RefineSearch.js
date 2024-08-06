import OpenAI from "openai";
import dotenv from "dotenv";
import Agentci from "agentci";
dotenv.config();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const prompt = ({
  input,
}) => `You are an AI assistant specialized in identifying elements on a web page. You will be given screenshots of a webpage in which elements have been grouped into distinct containers or components, each surrounded by a red border. These red-bordered areas represent logically related sets of elements.
  
  Please refine the search terms for the target element:
  
  **TargetElement**
  - Element Name: ${input.elementName}
  - Element Functionality: ${input.elementFunctionality}
  - Inner Text: ${input.innerText}
  
Focus only on the target element and its container. 
  
The search terms for the element must be based on what is visible in the screenshot, within the context of its red-bordered container. Only provide arguments based on what you can see within the same container as the target element.

Please call the identifyElement function to provide updated search parameters for the target element. 
- elementName: Provide a highly specific and distinguishing name or label for the element based solely on its visible content or functionality within its red-bordered container. Use exact text content or unique identifiers visible on the page, e.g., "Add to Cart button for Sony WH-1000XM4 Wireless Headphones" or "Email input field for Amazon Prime account login".
- elementFunctionality: Describe the element's specific purpose and functionality in relation to its red-bordered container and the entire page, based on visible information.
- innerText: Exact text visible within the element. Include as much specific text as possible.
- elementDescription: Describe the element's visible features in detail, including specific colors, text, position, and any unique identifiers you can see in the screenshot within its red-bordered container.
- containerText: Exact text visible ONLY within the same red-bordered container as the element. Do not include text from outside this red border. Provide as much context as possible to uniquely identify the element within its container.
- containerName: Provide a concise, highly specific label for the red-bordered container based solely on its visible content, e.g., "Sony WH-1000XM4 Wireless Headphones Product Details Panel" or "Amazon Prime Video Categories Dropdown Menu". Avoid any generic terms or assumptions about the content.
- containerFunctionality: Describe the red-bordered container's specific purpose and its functionality as it relates to this specific item on the web page. The name should be based on visible information within the container.

Guidelines:
- CRUCIAL: Gather EVERY piece of text visible within the red-bordered container of the target element. Do not omit any text, no matter how minor it may seem.
- Ensure ALL collected text comes ONLY from within the same red-bordered container as the target element. Do not include text from outside this specific container.
- Focus on making the search terms as accurate and distinctive as possible.
- If the target element is not visible in the screenshot, use the elementNotFound function to report this.

Use this process:
  
  1. Is the target element in the screenshot?
  If the element is found, use:
  identifyElement({
    containerName: "More specific container name",
    containerFunctionality: "More detailed container functionality",
    elementName: "More specific element name",
    elementFunctionality: "More detailed element functionality",
    containerText: "ALL visible text from the container | separated by pipes | include everything",
    refinementConfidence: 5 // On a scale of 1-5, where 5 is most confident
  })
  
  2. If the element is not found, use:
  elementNotFound({
    reasoning: "Detailed explanation of why the element was not found",
    certainty: 5 // On a scale of 1-5, where 5 is most certain that the element is not present
  })
  
  CRITICAL: 
    - For ALL containerName and elementName values, use highly specific, distinguishing labels that uniquely identify the container or element based solely on what is visible within the red-bordered container in the screenshot. 
    - Do not use generic terms or make assumptions about the content. 
    - Use names that precisely describe the element's unique role or content on this specific page, such as "Apple iPhone 14 Pro Max 256GB Deep Purple configuration panel" or "Thriller by Michael Jackson - Vinyl Record Product Details".
    - Remember that containers are visually distinct areas surrounded by red borders. Only consider content within these red borders when describing or referencing a container.
  
  Before submitting, verify that:
  - You have gathered as much container text as possible.
  - All container text is within same container as the target element, the red borders.
  - The containerName and elementName are highly specific and distinguishing.
  - You have not made assumptions about content outside the visible area.
  - Your refinement is based solely on what is visible in the screenshot.
  - If the element is not found, you have provided a detailed reasoning and certainty level.`;

const schema = [
  {
    type: "function",
    function: {
      name: "identifyElement",
      description:
        "Refine search terms for the target element and provide comprehensive text information",
      parameters: {
        type: "object",
        properties: {
          containerName: {
            type: "string",
            description: "More specific, distinguishing name for the container",
          },
          containerFunctionality: {
            type: "string",
            description: "More detailed description of the container's functionality",
          },
          elementName: {
            type: "string",
            description: "More specific, distinguishing name for the element",
          },
          elementFunctionality: {
            type: "string",
            description: "More detailed description of the element's functionality",
          },
          containerText: {
            type: "string",
            description:
              "ALL visible text from the container, separated by | if multiple pieces. Include EVERYTHING.",
          },
        },
        required: [
          "containerName",
          "containerFunctionality",
          "elementName",
          "elementFunctionality",
          "containerText",
        ],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "elementNotFound",
      description: "Report that the target element was not found in the screenshot",
      parameters: {
        type: "object",
        properties: {
          reasoning: {
            type: "string",
            description: "Detailed explanation of why the element was not found",
          },
          certainty: {
            type: "number",
            description:
              "Certainty that the element is not present on a scale of 1-5, where 5 is most certain",
          },
        },
        required: ["reasoning", "certainty"],
      },
    },
  },
];

export default function RefineSearch() {
  this.use({
    provider: "openai",
    model: "gpt-4o",
    sdk: openai,
    schema,
    prompt,
    exitConditions: { errors: 1, functionCall: ["identifyElement", "elementNotFound"] },
    temperature: 0,
  });

  this.identifyElement = async function (searchTerm, { state }) {
    return { searchTerm };
  };

  this.elementNotFound = async function (results, { state }) {
    return { ...results, notFound: true };
  };

  this.before("$invoke", function ({ state }, next) {
    next();
  });
}

// const testAgent = Agentci().rootAgent(RefineSearch);

// testAgent
//   .invoke({
//     message: "Refine the search terms for the target element based on the provided criteria.",
//     image: "/path/to/screenshot.png",
//     containerName: "Product Details Container",
//     containerFunctionality: "Displays product information",
//     containerText: "iPhone 14 Pro",
//     elementName: "Add to Cart Button",
//     elementFunctionality: "Adds product to shopping cart",
//     innerText: "Add to Bag",
//   })
//   .then((r) => console.log("results", r))
//   .catch(console.error);
