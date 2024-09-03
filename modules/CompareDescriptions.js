import OpenAI from "openai";
import dotenv from "dotenv";
import Agentci from "agentci";
dotenv.config();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const prompt = ({
  input,
}) => `You are an AI assistant specialized in analyzing and matching web UI element descriptions. Your task is to compare the provided search criteria against a list of element descriptions and determine which, if any, best matches the criteria.

Target Element:
- Container Name: ${input.targetElement.containerName || "n/a"}
- Container Functionality: ${input.targetElement.containerFunctionality || "n/a"}
- Element Name: ${input.targetElement.elementName || "n/a"}
- Element Functionality: ${input.targetElement.elementFunctionality || "n/a"}

Element descriptions to compare against:
${input.elementDescriptions
  .map(
    (desc) => `
- Element Number: ${desc.elementNumber}
- Container Name: ${desc.containerName}
- Container Functionality: ${desc.containerFunctionality}
- Element Name: ${desc.elementName}
- Element Functionality: ${desc.elementFunctionality}
`
  )
  .join("\n")}

Your task is to analyze each element description and determine if it matches the search criteria. Use the identifyMatch function to provide information about the single best matching element. The function expects an object with these properties:

- elementNumber: The number of the matching element.
- containerName: The name of the container that matches the criteria.
- containerFunctionality: The functionality of the container that matches the criteria.
- elementName: The name of the matching element.
- elementFunctionality: The functionality of the matching element.
- matchQuality: Indicate how well this element matches the specified criteria (enum: "full-match", "partial-match").

If no elements match the criteria, use the noMatch function instead.

Chain of Thought Process:
1. Compare each element description to the search criteria:
   - How closely does the container information match?
   - How well does the element information align with the criteria?
   - Are there partial matches that should be considered?

3. For each potential match:
   - Determine if it's a full match or partial match
   - Explain your reasoning, referencing specific details from the descriptions

4. After examining all descriptions:
   - Which element best matches the criteria?
   - Is it a full match or a partial match?

5. Formulate your response:
   - If there's a matching element, use the identifyMatch function with the best match
   - If there are no matches, use the noMatch function
   - Ensure all descriptions and explanations are clear and specific

Provide your answer in this format:

<answer>
identifyMatch({
  elementNumber: 1,
  containerName: "Product Configuration Panel",
  containerFunctionality: "Allows users to customize and purchase a specific product",
  elementName: "Add to Cart Button",
  elementFunctionality: "Adds the configured product to the shopping cart",
  matchQuality: "full-match"
})

Explanation: I have identified this match based on [your reasoning here]. The Product Configuration Panel fully matches the container criteria because [explanation]. The Add to Cart Button fully matches the element criteria due to [explanation].
</answer>

OR, if there are no matches:

<answer>
noMatch({
  reason: "None of the provided element descriptions match the search criteria.",
})

Explanation: After careful analysis, I found no matches because [your reasoning here]. The closest potential match was [description], but it didn't meet the criteria due to [explanation].
</answer>

Guidelines:
1. Compare all provided element descriptions against the search criteria.
2. Provide clear, concise, and specific explanations for your matching decisions.
3. Consider both full and partial matches, explaining your reasoning using specific details from the descriptions.
4. If no elements fully match the criteria, consider partial matches and explain your reasoning.
5. If absolutely no elements match or partially match the criteria, use the noMatch function and explain why.
6. Articulate your reasoning process as you analyze the descriptions and identify the best match.
7. Explain any ambiguities or difficulties in determining the best match, referring to specific details from the descriptions.
8. Ensure that your response is comprehensive, covering all aspects of the task while maintaining clarity and conciseness.
9. Double-check your analysis and explanations before submitting your response.`;

const schema = [
  {
    type: "function",
    function: {
      name: "identifyMatch",
      description: "Provide a description for the single best matching element",
      parameters: {
        type: "object",
        properties: {
          elementNumber: {
            type: "integer",
            description: "The number of the matching element.",
          },
          containerName: {
            type: "string",
            description: "The name of the container that matches the criteria.",
          },
          containerFunctionality: {
            type: "string",
            description: "The functionality of the container that matches the criteria.",
          },
          elementName: {
            type: "string",
            description: "The name of the matching element.",
          },
          elementFunctionality: {
            type: "string",
            description: "The functionality of the matching element.",
          },
          matchQuality: {
            type: "string",
            description:
              "Indicating how well this element matches the specified criteria (enum: full-match, partial-match).",
          },
        },
        required: [
          "elementNumber",
          "containerName",
          "containerFunctionality",
          "elementName",
          "elementFunctionality",
          "matchQuality",
        ],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "noMatch",
      description: "Report when there are no matching elements",
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description: "Explanation for why no elements were matched",
          },
        },
        required: ["reason", "closestMatch"],
      },
    },
  },
];

export default function CompareDescriptions() {
  this.use({
    provider: "openai",
    model: "gpt-4o-mini",
    sdk: openai,
    schema,
    prompt,
    exitConditions: {
      errors: 1,
      functionCall: ["identifyMatch", "noMatch"],
    },
    temperature: 0,
  });

  this.identifyMatch = async function (result, { input }) {
    console.log("identifyMatch results", result);
    return input.elementDescriptions.find(
      (desc) => desc.elementNumber === result.elementNumber
    );
  };

  this.noMatch = async function (result, { state }) {
    return { matchQuality: "no-match", ...result };
  };

  this.before("$invoke", function ({ input }, next) {
    input.elementDescriptions = input.elementDescriptions.map((desc, i) => ({
      ...desc,
      elementNumber: i + 1,
    }));
    next();
  });
}

// Example usage:
// const testAgent = Agentci().rootAgent(CompareDescriptions);

// testAgent
//   .invoke({
//     message:
//       "Please identify the best matching element for adding a product to the cart.",
//     targetElement: {
//       containerName: "Product Details Panel",
//       containerFunctionality: "Displays information about a specific product",
//       containerText: "iPhone 12 Pro Max",
//       elementName: "Add to Cart Button",
//       elementFunctionality: "Adds the current product to the shopping cart",
//       innerText: "Add to Cart",
//     },
//     elementDescriptions: [
//       {
//         elementNumber: 1,
//         containerName: "Product Information Container",
//         containerFunctionality: "Displays details about a specific product",
//         containerText: "iPhone 12 Pro Max - Silver, 256GB",
//         elementName: "Purchase Button",
//         elementFunctionality: "Initiates the buying process for the product",
//         innerText: "Buy Now",
//       },
//       {
//         elementNumber: 2,
//         containerName: "Product Details Panel",
//         containerFunctionality:
//           "Shows comprehensive information about the selected product",
//         containerText: "iPhone 12 Pro Max",
//         elementName: "Add to Cart Button",
//         elementFunctionality: "Adds the displayed product to the user's shopping cart",
//         innerText: "Add to Cart",
//       },
//       {
//         elementNumber: 3,
//         containerName: "Shopping Cart Summary",
//         containerFunctionality: "Displays items currently in the user's cart",
//         containerText: "Your Shopping Cart (2 items)",
//         elementName: "Checkout Button",
//         elementFunctionality: "Proceeds to payment for items in cart",
//         innerText: "Proceed to Checkout",
//       },
//     ],
//   })
//   .then((r) => console.log("results", r))
//   .catch(console.error);
