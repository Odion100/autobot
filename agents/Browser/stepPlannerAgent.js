import OpenAI from "openai";
import dotenv from "dotenv";
import Agentci from "agentci";
dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const prompt = `You will be provided with a screenshot and a user input.

1. Carefully examine the screenshot and user input to understand the context and purpose of the webpage in relation to the user's input or request.
2. Identify any visible elements, such as buttons, links, search bars, menus, product listings, and other elements which may be used in the plan.
3. Use the same element name or title as the page does when you mention any specific element.
4. Make sure that each steps description and detail is aligned with the use of Puppetteer. Avoid using actions not able to be done with Puppeteer like press Enter or click on a link, instead use Selectors and other Puppeteer methods.

Next, consider the user input which will specify what needs to be done on the webpage. If the users input includes search terms, determine the best search terms to use 
and use them in your instructions instead of the user's choice of keywords or phrases.

Your task is to provide a detailed plan for achieving the user's goal. The plan should include every step and the relevant details for each step including identified elements 
relevant to the step, and a description of what needs to be done in the step and be sure that all methods of action are using Puppeteer.

Please provide your answer in the following format:

<answer>
createPlan({
  userInput: "User input goes here",
  steps: [
    {
      stepNumber: 1,
      stepDescription: "Open the main navigation menu to access different sections of the site.",
      stepDetail: "Click on the hamburger icon at the top-left corner of the screen.",
      elementDescription: "The hamburger icon is the first element on the page."
    },
    {
      stepNumber: 2,
      stepDescription: "Navigate to the search bar to search for specific content.",
      stepDetail: "Locate the search bar at the top of the page and type the search terms.",
      elementDescription: "The search bar is at the top of the page next to the logo."
    },
    {
      stepNumber: 3,
      stepDescription: "Identify best match for the user's search terms.",
      stepDetail: "Scroll down to find the best match for the user's search terms, and select it.",
    }
  ]
})
</answer>

Make sure to include all necessary steps to achieve the user's goal based on the screenshot and input provided to carry out the instructions you provide.
Provide clear and concise descriptions and details for each step and DO NOT forget that the user uses Puppeteer to command the browser.`;

const schema = [
  {
    type: "function",
    function: {
      name: "createPlan",
      description: "Provide a detailed plan for achieving the user's goal based on the user input and the users intnet ot use puppetter to interact with the browser.",
      parameters: {
        type: "object",
        properties: {
          userInput: {
            type: "string",
            description: "The original user input describing the goal.",
          },
          steps: {
            type: "array",
            items: {
              type: "object",
              properties: {
                stepNumber: {
                  type: "number",
                  description: "The number of the step in the plan.",
                },
                stepDescription: {
                  type: "string",
                  description: "A description of the step's purpose and what needs to be done.",
                },
                stepDetail: {
                  type: "string",
                  description: "Specific details about how to perform the step.",
                },
                elementDescription: {
                  type: "string",
                  description: "A description of the element's relevant to the steps which is intended to help a visual agent find the element in relation to the rest of the page.",
                },
              },
              required: ["stepNumber", "stepDescription", "stepDetail", "elementDescription", "userInput"]
            }
          }
        },
      },
    },
  },
];

function StepPlannerAgent() {
  this.use({
    provider: "openai",
    model: "gpt-4o",
    sdk: openai,
    schema,
    prompt,
    exitConditions: { errors: 1, iterations: 1, functionCall: "createPlan" },
    temperature: 0.5,
  });

  this.createPlan = async function (plan, { state }) {
    //console.log("createPlan invoked with plan:", plan);
    if (!state.createdPlan) {
      state.createdPlan = plan;
      //console.log("Plan created successfully:", state.createdPlan);
    } else {
      //console.log("Plan already exists. Ignoring the additional plan creation.");
    }
    return state.createdPlan;
  };

  this.before("$invoke", function ({ state }, next) {
    //console.log("Initializing state for plan creation...");
    state.createdPlan = null;
    next();
  });

  this.after("$invoke", function ({ state }) {
    //console.log("Final state after invocation:", state.createdPlan);
    //return state.createdPlan;
  });
}

const testAgent = Agentci().rootAgent(StepPlannerAgent);

testAgent
  .invoke({
    message: "Search Amazon for the best selling laptop and add it to the cart.",
    images: ["C:/DevSpace/3912/autobot/screenshots/Screenshot2024-07-04060923.png"]
  })
  .then((r) => console.log("results", r))
  .catch(console.error);
