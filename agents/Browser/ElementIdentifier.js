import OpenAI from "openai";
import dotenv from "dotenv";
import Agentci from "agentci";
dotenv.config();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const prompt = ({
  input,
}) => `You are an AI assistant specialized in web UI analysis and element identification. Analyze two provided screenshots:

1. Full page screenshot: Examine carefully to understand the webpage's context and purpose.
2. Focus screenshot: Concentrate on all elements highlighted with green boxes. Each box has an ID number in its top-right corner.

Your task has two parts:
A. Identify and describe all highlighted elements.
B. Determine which element(s), if any, best match the following criteria:

- Container Name: ${input.containerName}
- Container Purpose: ${input.containerPurpose}
- Container Text: ${input.containerText}
- Element Name: ${input.elementName}
- Element Purpose: ${input.elementPurpose}
- Inner Text: ${input.innerText}

IMPORTANT: For ALL descriptions, names, and purposes, avoid generic descriptors. Instead, use specific, distinguishing features, exact text content, or unique identifiers that relate directly to the specific items visible on the web page. This applies to both containers and individual elements.

Use the identifyElements function to provide information about the container and all highlighted elements and indicate which ones match the criteria. The function expects an objects with these properties:

- containerPurpose: Describe the container's specific purpose and its functionality as it relates to this specific item on the web page. 
- containerName: Concise, specific label for the container based on its content visible on the page.
- matchesCriteria: Indicate whether this container matches the specified search criteria regarding the target container (enum: "full-match", "partial-match", "no-match").
- positionRefresh: Likelihood of the container's position changing when the page is refreshed. Use "dynamic" if the container is likely to change position, or "static" if it's likely to remain in the same place.
- identifiedElements: An array of objects describing each highlighted element within the container, each with these properties:
  - elementNumber: The highlighted element's ID number (top-right corner of the green box)
  - elementPurpose: Describe the element's specific purpose and functionality in relation to its component and the entire page. 
  - elementName: Concise, specific label for the element based on its visible details and functionality on this page.
  - matchesCriteria: Indicate whether this element matches the specified criteria (enum: "full-match", "partial-match", "no-match")

Chain of Thought Process:
1. Analyze the full page screenshot:
   - What is the specific purpose of this webpage based on its visible content?
   - What are the main sections or components visible, described using unique identifiers from the page?

2. Examine the focus screenshot:
   - How many highlighted elements are there?
   - What are their specific characteristics, avoiding generic terms and focusing on what's actually visible?

3. For each highlighted element:
   a. Describe its visual appearance and apparent functionality using specific, unique details from the page
   b. Determine if it matches any of the provided criteria:
      - How closely does it match each criterion?
      - Is it a full match, partial match, or no match?

4. After examining all elements:
   - Which element(s), if any, best match the criteria?
   - Are there multiple matches, partial matches, or no matches at all?

5. Formulate your response:
   - Create an object for each container and its highlighted elements
   - Set matchesCriteria appropriately for containers and elements based on how well they match the specified criteria
   - Ensure all descriptions and names use specific, unique identifiers from the actual page content

Provide your answer in this format:

<answer>
identifyElements([
  {
    containerName: "iPhone 14 Pro Product Configuration and Purchase Container",
    containerPurpose: "Presents the 'iPhone 14 Pro' product page, showcasing its features, color options, storage capacities, and allowing users to customize and add the product to their cart.",
    matchesCriteria: "partial-match",
    positionRefresh: "static",
    identifiedElements: [
      {
        elementNumber: 1,
        elementPurpose: "Adds the customized iPhone 14 Pro to the user's shopping cart with the selected color (Deep Purple), storage capacity (256GB), and other chosen options",
        elementName: "iPhone 14 Pro 'Add to Bag' Purchase Initiation Button",
        matchesCriteria: "full-match"
      },
      {
        elementNumber: 2,
        elementPurpose: "Allows users to select their preferred color for the iPhone 14 Pro, updating the product image and selected configuration accordingly",
        elementName: "iPhone 14 Pro Color Selection Swatch Row",
        matchesCriteria: "no-match"
      }
      // Include all other highlighted elements here, maintaining specificity to the page content
    ]
  },
  // Include other containers if present, each with specific, unique descriptions based on the page
])
</answer>

Guidelines:
1. Describe all highlighted elements and their containers, regardless of whether they match the criteria.
2. Provide clear, concise, and SPECIFIC descriptions and names for each element and container based specific details of the item and its container.
3. The element's ID number is in the top-right corner of the highlighted green box.
4. Set matchesCriteria appropriately for both containers and elements based on how well they match the specified criteria.
5. If no elements or containers fully match the criteria, consider partial matches and explain your reasoning using specific details from the page.
6. If absolutely no elements or containers match or partially match the criteria, set matchesCriteria to "no-match" for all.
7. Remember to include all highlighted elements and their containers when calling identifyElements.
8. Articulate your reasoning process as you analyze the screenshots and identify all elements and containers, using specific examples and unique identifiers from the page content.
9. Explain any ambiguities, partial matches, or difficulties in determining matches, referring to specific features or text content visible on the page.
10. Ensure that your response is comprehensive, covering all aspects of the task while maintaining clarity, conciseness, and specificity to the page content.
11. Double-check that you haven't used any generic descriptors and that all descriptions relate directly to what's visible on the page before submitting your response.`;

const schema = [
  {
    type: "function",
    function: {
      name: "identifyElements",
      description: "Provide a description for each highlighted element",
      parameters: {
        type: "object",
        properties: {
          containerPurpose: {
            type: "string",
            description:
              "Describe the container's purpose and it's functionality as it relates to this specific component the page.",
          },
          containerName: {
            type: "string",
            description: `A specific, unique name or label for the component based on its visible content or attributes. Avoid generic descriptors like "first option" or "second listing". Instead, use distinguishing features or exact text content, e.g., "Buy Now button for Wireless Headphones" or "Username input field`,
          },

          matchesCriteria: {
            type: "string",
            description:
              "Indicating whether this container matches the specified search criteria regarding the target container (enum: full-match, partial-match, no-match).",
          },
          positionRefresh: {
            type: "string",
            description: `Likelihood of the container's position changing when the page is revisited on a later date. Use "dynamic" if the container is likely to change position, or "static" if it's likely to remain in the same place. For example, a Navigation bar would be static while a search result would be dynamic.`,
          },
          identifiedElements: {
            type: "array",
            description: "A list of the highlighted elements you've identified.",
            items: {
              type: "object",
              properties: {
                elementNumber: {
                  type: "number",
                  description:
                    "The number in the right corner of the highlighted element you are describing.",
                },
                elementPurpose: {
                  type: "string",
                  description:
                    "Describe the element's purpose and it's functionality as it relates to the entire page.",
                },
                elementName: {
                  type: "string",
                  description: `A specific, unique name or label for the element based on its visible content or attributes. Avoid generic descriptors like "first option" or "second listing". Instead, use distinguishing features or exact text content, e.g., "Buy Now button for Wireless Headphones" or "Username input field"`,
                },
                matchesCriteria: {
                  type: "string",
                  description:
                    "Indicating whether this element matches the specified criteria (enum: full-match, partial-match, no-match).",
                },
              },
            },
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
    exitConditions: { errors: 1, functionCall: "identifyElements" },
    temperature: 0,
  });

  this.identifyElements = async function (results, { state }) {
    // state.identifiedElements.push(...identifiedElements);
    return results;
  };
  this.before("$invoke", function ({ state }, next) {
    // state.identifiedElements = [];
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
