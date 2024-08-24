import OpenAI from "openai";
import dotenv from "dotenv";
dotenv.config();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const prompt = `You are an AI assistant specialized in creating detailed execution plans for complex web requests. Your role is to analyze user requests, break them down into objectives and subtasks, and provide clear acceptance criteria for each objective.

## Your Responsibilities:

1. Carefully analyze the user's request.
2. Identify the main objectives and specific requirements within the request.
3. Break request into multiple objectives only if each objective can be done without any knowledge of the previous objective.
3. Break down each objective into smaller, manageable subtasks.
4. Create clear and measurable acceptance criteria for which to analyze the success of each objective including specific requirements.

To complete your task you have access to the follow two functions:

promptUser({ question }): Use this function to ask any clarifying question, for more context, and to clarify acceptance criteria.

Present your execution plan by calling the executePlan function with the following parameters:

executePlan([
    {
        objective: ["A string describing the first objective"],
        steps: ["Describing each step to complete the objective"],
        acceptanceCriteria: ["An array of strings, each describing a criterion for success"],
    },
    {
        objective: ["A string describing the second objective"],
        steps: ["Describing each step to complete the objective"],
        acceptanceCriteria: ["describe each criterion for success"],
    },
])

Remember to adapt your execution plan and acceptance criteria to the specific needs and context of each user's request.
Good luck!`;
const promptUser = {
  type: "function",
  function: {
    name: "promptUser",
    description:
      "Use this function to ask any clarifying questions, for more context, and to clarify acceptance criteria.",
    parameters: {
      type: "object",
      properties: {
        text: {
          type: "string",
          question:
            "A prompt or clarifying questions you want to ask the user to better create the execution plan.",
          required: ["question"],
        },
      },
    },
  },
};
const executePlan = {
  type: "function",
  function: {
    name: "executePlan",
    description: "Provide a list of objectives for the execution of the users request.",
    parameters: {
      type: "object",
      properties: {
        Objectives: {
          type: "array",
          items: {
            type: "object",
            properties: {
              objective: {
                type: "string",
                description: "Create an objective for this step of the plan.",
              },
              steps: {
                type: "string",
                description: "Create a list of steps to complete the objective",
              },
              acceptanceCriteria: {
                type: "string",
                description:
                  "Create a list of acceptance criteria for which to evaluate the success or correctness once the objective is complete.",
              },
            },
            required: ["objective", "steps", "acceptanceCriteria"],
          },
        },
      },
    },
  },
};
const schema = [promptUser, executePlan];

export default function Executor() {
  this.use({
    provider: "openai",
    model: "gpt-4o",
    sdk: openai,
    schema,
    prompt,
    exitConditions: { errors: 1, functionCall: "executePlan" },
    temperature: 0.5,
  });

  this.executePlan = async function (
    { objectives },
    { state, agents: { BrowserController } }
  ) {
    const formattedObjectives = [];

    for (const objective of objectives) {
      const objectiveDetails = `
        Objective: ${objective.objective}
        Steps: 
          ${objective.steps.join("\n          ")}
        Acceptance Criteria:
          ${objective.acceptanceCriteria.join("\n          ")}
      `;

      output = await BrowserController.invoke(objectiveDetails);
      console.log(`The ${objective.objective} objective is complete.`);
      console.log(output);
    }

    const executionPlan = formattedObjectives.join("\n\n");

    // Return the execution plan
    return executionPlan;
  };

  this.promptUser = async function ({ question }, { state }) {
    console.log(`\n\n${question}?`);
    const response = await new Promise((resolve) => {
      state.promptUserCallBack = resolve;
    });
    return response;
  };

  this.before("$invoke", function ({ state }, next) {
    state.identifiedElements = [];
    next();
  });
}
