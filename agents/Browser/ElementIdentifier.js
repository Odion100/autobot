import OpenAI from "openai";
import dotenv from "dotenv";
import Agentci from "agentci";
dotenv.config();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const prompt = ({
  input,
}) => `You are an AI assistant specialized in web UI analysis and element identification. Analyze two provided screenshots:

1. Full page screenshot: Examine carefully to understand the webpage's context and purpose.
2. Focus screenshot: Concentrate ONLY on elements highlighted with green boxes. Each box has an ID number in its top-right corner.

Your task has two parts:
A. Identify and describe all highlighted elements.
B. Determine which highlighted element(s), if any, best match the following search criteria:

- Container Name: ${input.containerName}
- Container Functionality: ${input.containerFunctionality}
- Container Text: ${input.containerText}
- Element Name: ${input.elementName}
- Element Functionality: ${input.elementFunctionality}
- Inner Text: ${input.innerText}

IMPORTANT: Only elements highlighted with green boxes and numbered should be considered as potential matches. Do not include or describe adjacent non-highlighted elements, even if they seem relevant to the search criteria.

Use the identifyElements function to provide information about the container and all highlighted elements and indicate if one match the criteria. The function expects an object with these properties:

- containerName: Provide a concise, specific label for the container based on its content visible on the page, e.g., "Wireless Headphones XH-2000 Product Details and Purchase Options Panel".
- containerFunctionality: Describe the container's specific purpose and its functionality as it relates to this specific item on the web page. 
- matchesCriteria: Indicate whether this container matches the specified search criteria regarding the target container (enum: "full-match", "partial-match", "no-match").
- positionRefresh: Assess the likelihood of the container's position changing when the page is refreshed or revisited on another day.s. Use "dynamic" if the container's position is likely to change, or "static" if it's likely to remain in the same place. Consider these factors:
  - "static": Use for elements that are part of the page's permanent structure, such as headers, footers, main navigation menus, or fixed product information panels. 
    Examples: "Header Navigation Menu", "Site-wide Footer", "Fixed Sidebar", "Main Product Description Container", "Website Logo", "Primary Call-to-Action Button".
  - "dynamic": Use for elements whose position or presence may change based on user actions, server-side updates, or page refreshes. 
    Examples: "Search Results Grid", "Personalized Product Recommendations", "Live Chat Widget", "Social Media Feed", "Breaking News Ticker", "Recently Viewed Items Carousel".
- positionRefreshConfidence: Indicate your confidence in the positionRefresh assessment on a scale of 1-5, where 1 is least confident and 5 is most confident.
- identifiedElements: An array of objects describing each highlighted element within the container, each with these properties:
  - elementNumber: The highlighted element's ID number (top-right corner of the green box). Use 0 if the highlighted area doesn't contain an actual element within its borders.
  - elementName: A distinguishing name or label for the element based on its visible content or functionality. Use "n/a" if the highlighted area doesn't contain an actual element.
  - elementFunctionality: Describe the element's specific purpose and functionality in relation to its component and the entire page. Use "n/a" if the highlighted area doesn't contain an actual element.
  - matchesCriteria: Indicate whether this element matches the specified criteria (enum: "full-match", "partial-match", "no-match"). Use "no-match" if the highlighted area doesn't contain an actual element.

If the focus screenshot does not contain any highlighted elements, use the noHighlightedElements function instead.

CRITICAL: For ALL containerName and elementName values, use highly specific, distinguishing labels that uniquely identify the container or element. Avoid generic terms like "product container", "search results", or "delete button". Instead, use names that precisely describe the element's unique role or content on this specific page, such as "iPhone 14 Pro configuration panel" or "Prime Video categories dropdown".

Chain of Thought Process:
1. Analyze the full page screenshot:
   - What is the specific purpose of this webpage based on its visible content?
   - What are the main sections or components visible, described using unique identifiers from the page?

2. Examine the focus screenshot:
   - Are there any highlighted elements?
   - If yes, how many highlighted elements are there?
   - What are their specific characteristics, avoiding generic terms and focusing on what's actually visible?

3. For each highlighted element (or area):
   a. If it contains an actual element:
      - Describe its visual appearance and apparent functionality using specific, unique details from the page
      - Determine if it matches any of the provided criteria:
        - How closely does it match each criterion?
        - Is it a full match, partial match, or no match?
   b. If it doesn't contain an actual element:
      - Use 0 for elementNumber and "n/a" for elementName, elementFunctionality, and set matchesCriteria to "no-match"

4. After examining all elements:
   - Which element(s), if any, best match the criteria?
   - Are there multiple matches, partial matches, or no matches at all?

5. Determine positionRefresh for each container:
   - Apply the decision tree to assess whether the container is likely static or dynamic
   - Consider the examples provided and how they relate to the container in question
   - Explain your reasoning briefly
   - Assign a confidence level to your assessment

6. Formulate your response:
   - If there are highlighted elements, create an object for each container and its highlighted elements using the identifyElements function
   - If there are no highlighted elements, use the noHighlightedElements function
   - Set matchesCriteria appropriately for containers and elements based on how well they match the specified criteria
   - Ensure all descriptions and names use specific, unique identifiers from the actual page content

Provide your answer in this format:

<answer>
identifyElements([
  {
    containerName: "iPhone 14 Pro Product Configuration and Purchase Container",
    containerFunctionality: "Presents the 'iPhone 14 Pro' product page, showcasing its features, color options, storage capacities, and allowing users to customize and add the product to their cart.",
    matchesCriteria: "partial-match",
    positionRefresh: "static",
    positionRefreshConfidence: 4,
    identifiedElements: [
      {
        elementNumber: 1,
        elementFunctionality: "Adds the customized iPhone 14 Pro to the user's shopping cart with the selected color (Deep Purple), storage capacity (256GB), and other chosen options",
        elementName: "iPhone 14 Pro 'Add to Bag' Purchase Initiation Button",
        matchesCriteria: "full-match"
      },
      {
        elementNumber: 2,
        elementFunctionality: "Allows users to select their preferred color for the iPhone 14 Pro, updating the product image and selected configuration accordingly",
        elementName: "iPhone 14 Pro Color Selection Swatch Row",
        matchesCriteria: "no-match"
      },
      {
        elementNumber: 0,
        elementFunctionality: "n/a",
        elementName: "n/a",
        matchesCriteria: "no-match"
      }
      // Include all other highlighted elements here, maintaining specificity to the page content
    ]
  },
  // Include other containers if present, each with specific, unique descriptions based on the page
])

Confirmation: I have verified that all described elements are highlighted with green boxes and have corresponding ID numbers. No non-highlighted elements have been included in this analysis. All containerName and elementName descriptions are highly specific and distinguishing.
</answer>

OR, if there are no highlighted elements:

<answer>
noHighlightedElements({
  reason: "The focus screenshot does not contain any elements highlighted with green boxes.",
  pageDescription: "Provide a brief description of the visible content in the full page screenshot."
})

Confirmation: I have verified that there are no elements highlighted with green boxes in the focus screenshot.
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
11. Double-check that you haven't used any generic descriptors and that all descriptions relate directly to what's visible on the page before submitting your response.
12. If there are no highlighted elements in the focus screenshot, use the noHighlightedElements function instead of identifyElements.`;

const schema = [
  {
    type: "function",
    function: {
      name: "identifyElements",
      description: "Provide a description for each highlighted element",
      parameters: {
        type: "object",
        properties: {
          containerFunctionality: {
            type: "string",
            description:
              "Describe the container's purpose and it's functionality as it relates to this specific component the page.",
          },
          containerName: {
            type: "string",
            description: `Provide a concise, specific label for the container based on its content visible on the page, e.g., "Wireless Headphones XH-2000 Product Details and Purchase Options Panel. For ALL containerName values, use highly specific, distinguishing labels that uniquely identify container. Avoid generic terms like "product container", "search results". Instead, use names that precisely describe the element's unique role or content on this specific page, such as "iPhone 14 Pro configuration panel" or "Prime Video categories dropdown".`,
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
          positionRefreshConfidence: {
            type: "number",
            description:
              "Indicate your confidence in the positionRefresh assessment on a scale of 1-5, where 1 is least confident and 5 is most confident.",
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
                    "The number in the right corner of the highlighted element you are describing. Use 0 if the highlighted area doesn't contain an actual element.",
                },
                elementFunctionality: {
                  type: "string",
                  description:
                    "Describe the element's purpose and it's functionality as it relates to the entire page. Use 'n/a' if the highlighted area doesn't contain an actual element.",
                },
                elementName: {
                  type: "string",
                  description: `Provide a specific, distinguishing name or label for the element based on its visible details or functionality. Use distinguishing functionality or exact text content. Use 'n/a' if the highlighted area doesn't contain an actual element.`,
                },
                matchesCriteria: {
                  type: "string",
                  description:
                    "Indicating whether this element matches the specified criteria (enum: full-match, partial-match, no-match). Use 'no-match' if the highlighted area doesn't contain an actual element.",
                },
              },
              required: [
                "elementNumber",
                "elementFunctionality",
                "elementName",
                "matchCriteria",
              ],
            },
          },
        },
        required: [
          "containerName",
          "containerFunctionality",
          "matchCriteria",
          "positionRefresh",
          "positionRefreshConfidence",
          "identifiedElements",
        ],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "noHighlightedElements",
      description:
        "Report when there are no highlighted elements in the focus screenshot",
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description: "Explanation for why no elements were identified",
          },
          pageDescription: {
            type: "string",
            description:
              "Brief description of the visible content in the full page screenshot",
          },
        },
        required: ["reason", "pageDescription"],
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
    exitConditions: {
      errors: 1,
      functionCall: ["identifyElements", "noHighlightedElements"],
    },
    temperature: 0,
  });

  this.identifyElements = async function (results, { state }) {
    return results;
  };

  this.noHighlightedElements = async function (results, { state }) {
    return { matchesCriteria: "no-match", identifiedElements: [] };
  };

  this.before("$invoke", function ({ state }, next) {
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
