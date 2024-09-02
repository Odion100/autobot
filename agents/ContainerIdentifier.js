import OpenAI from "openai";
import dotenv from "dotenv";
import Agentci from "agentci";
dotenv.config();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const prompt = ({
  input,
}) => `You are an AI assistant specialized in web UI identifying web components. Analyze the provided screenshot and identify each highlighted components:

Your task has two parts:
A. Identify and describe all highlighted containers.
B. Determine which highlighted container(s) contains the target element, if any, based on the the following search criteria:

- Element Name: ${input.elementName || "n/a"}
- Element Functionality: ${input.elementFunctionality || "n/a"}
- Inner Text: ${input.innerText || "n/a"}

Use the identifyContainers function to provide information about each highlighted container. The function expects an array of objects, each with these properties:

- containerNumber: The highlighted container's ID number (top-right corner of the green box).
- containerName: Provide a concise, specific label for the container based on its content visible on the page, e.g., "Wireless Headphones XH-2000 Product Details and Purchase Options Panel".
- containerFunctionality: Describe the container's specific purpose and its functionality as it relates to this specific item on the web page. 
- containerText: Provide the main text content visible within the container, if any.
- matchQuality: Indicate whether this container matches the specified search criteria (enum: "full-match", "partial-match", "no-match").
- positionRefresh: Assess the likelihood of the container's position changing when the page is refreshed or revisited on another day. Use "dynamic" if the container's position is likely to change, or "static" if it's likely to remain in the same place. Consider these factors:
  - "static": Use for elements that are part of the page's permanent structure, such as headers, footers, main navigation menus, or fixed product information panels. 
    Examples: "Header Navigation Menu", "Site-wide Footer", "Fixed Sidebar", "Main Product Description Container", "Website Logo", "Primary Call-to-Action Button".
  - "dynamic": Use for elements whose position or presence may change based on user actions, server-side updates, or page refreshes. 
    Examples: "Search Results Grid", "Personalized Product Recommendations", "Live Chat Widget", "Social Media Feed", "Breaking News Ticker", "Recently Viewed Items Carousel".
- positionRefreshConfidence: Indicate your confidence in the positionRefresh assessment on a scale of 1-5, where 1 is least confident and 5 is most confident.
- containerNumber: The ID number visible in the top-right corner of the highlighted container.

CRITICAL: For ALL containerName values, use highly specific, distinguishing labels that uniquely identify the container. Avoid generic terms like "product container" or "search results". Instead, use names that precisely describe the container's unique role or content on this specific page, such as "iPhone 14 Pro configuration panel" or "Prime Video categories dropdown".

Chain of Thought Process:
1. Analyze the full page screenshot:
   - What is the specific purpose of this webpage based on its visible content?
   - What are the main sections or components visible, described using unique identifiers from the page?

2. Examine the focus screenshot:
   - How many highlighted containers are there?
   - What are their specific characteristics, avoiding generic terms and focusing on what's actually visible?

3. For each highlighted container:
   - Describe its visual appearance and apparent functionality using specific, unique details from the page
   - Note the container number from the top-right corner of the highlight box
   - Determine if it matches any of the provided criteria:
     - How closely does it match each criterion?
     - Is it a full match, partial match, or no match?

4. Determine positionRefresh for each container:
   - Apply the decision tree to assess whether the container is likely static or dynamic
   - Consider the examples provided and how they relate to the container in question
   - Explain your reasoning briefly
   - Assign a confidence level to your assessment

5. Formulate your response:
   - Create an object for each highlighted container using the identifyContainers function
   - Set matchQuality appropriately for containers based on how well they match the specified criteria
   - Ensure all descriptions and names use specific, unique identifiers from the actual page content
   - If no containers are highlighted, return an empty array

Provide your answer in this format:

<answer>
identifyContainers([
  {
    containerNumber: 4,
    containerName: "iPhone 14 Pro Product Configuration and Purchase Container",
    containerFunctionality: "Presents the 'iPhone 14 Pro' product page, showcasing its features, color options, storage capacities, and allowing users to customize and add the product to their cart.",
    containerText: "iPhone 14 Pro\nFrom $999 or $41.62/mo. for 24 mo.*\nBuy\nGet $40–$650 for your trade-in*",
    matchQuality: "partial-match",
    positionRefresh: "static",
    positionRefreshConfidence: 4,
    containerNumber: 1
  },
  // Include other containers if present, each with specific, unique descriptions based on the page
])

Confirmation: I have verified that all described containers are highlighted with green boxes and have corresponding ID numbers. All containerName descriptions are highly specific and distinguishing.
</answer>

Guidelines:
1. Describe all highlighted containers, regardless of whether they match the criteria.
2. Provide clear, concise, and SPECIFIC descriptions and names for each container based on specific details of the item and its content.
3. Set matchQuality appropriately for containers based on how well they match the specified criteria.
4. If no containers fully match the criteria, consider partial matches and explain your reasoning using specific details from the page.
5. If absolutely no containers match or partially match the criteria, set matchQuality to "no-match" for all.
6. Remember to include all highlighted containers when calling identifyContainers.
7. Articulate your reasoning process as you analyze the screenshots and identify all containers, using specific examples and unique identifiers from the page content.
8. Explain any ambiguities, partial matches, or difficulties in determining matches, referring to specific features or text content visible on the page.
9. Ensure that your response is comprehensive, covering all aspects of the task while maintaining clarity, conciseness, and specificity to the page content.
10. Double-check that you haven't used any generic descriptors and that all descriptions relate directly to what's visible on the page before submitting your response.
11. If there are no highlighted containers in the focus screenshot, return an empty array.`;

const schema = [
  {
    type: "function",
    function: {
      name: "identifyContainers",
      description: "Provide a description for each visible container",
      parameters: {
        type: "object",
        properties: {
          containers: {
            type: "array",
            items: {
              type: "object",
              properties: {
                containerNumber: {
                  type: "number",
                  description:
                    "The number in the upper right corner of the highlighted container you are describing.",
                },
                containerName: {
                  type: "string",
                  description:
                    "Provide a concise, specific label for the container based on its content visible on the page.",
                },
                containerFunctionality: {
                  type: "string",
                  description:
                    "Describe the container's purpose and its functionality as it relates to this specific component on the page.",
                },

                matchQuality: {
                  type: "string",
                  description:
                    "Indicate whether this container matches the specified search criteria (enum: full-match, partial-match, no-match).",
                },
                positionRefresh: {
                  type: "string",
                  description:
                    "Likelihood of the container's position changing when the page is revisited on a later date. Use 'dynamic' if the container is likely to change position, or 'static' if it's likely to remain in the same place.",
                },
                positionRefreshConfidence: {
                  type: "number",
                  description:
                    "Indicate your confidence in the positionRefresh assessment on a scale of 1-5, where 1 is least confident and 5 is most confident.",
                },
              },
              required: [
                "containerName",
                "containerFunctionality",
                "matchQuality",
                "positionRefresh",
                "positionRefreshConfidence",
              ],
            },
          },
        },
        required: ["containers"],
      },
    },
  },
];

export default function ContainerIdentifier() {
  this.use({
    provider: "openai",
    model: "gpt-4-vision-preview",
    sdk: openai,
    schema,
    prompt,
    exitConditions: {
      errors: 1,
      functionCall: ["identifyContainers"],
    },
    temperature: 0,
  });

  this.identifyContainers = async function ({ containers }, { state }) {
    return containers;
  };

  this.before("$invoke", function ({ state }, next) {
    next();
  });
}

// Uncomment the following lines to test the agent
// const testAgent = Agentci().rootAgent(ContainerIdentifier);

// testAgent
//   .invoke({
//     message: "Please identify the containers in these screenshots.",
//     images: [
//       "/path/to/screenshot1.png",
//       "/path/to/screenshot2.png",
//       // Add more screenshot paths as needed
//     ],
//   })
//   .then((r) => console.log("results", r))
//   .catch(console.error);
