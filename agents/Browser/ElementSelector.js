import OpenAI from "openai";
import dotenv from "dotenv";
dotenv.config();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const prompt = ({
  input,
}) => `You are a web browsing agent. Your job is to improve the search for the target element by gathering as much text as you can see in and around the element. You will be given screenshots of a webpage in which groups of elements have been separated into red boxes. Gather as much text as you can see within the same red box of the element you want to ${input.action}.

You have access to the following 2 functions:

1. selectElement({ elementName, elementPurpose, innerText, containerText }): 
following properties to help find the element:

    - elementName: A concise name or label to describe the element.
    - elementPurpose: Describe the element's purpose and functionality as it relates it's larger component and to the entire page.
    - innerText: As much text as can be seen within the element.
    - containerText: As much text as can be seen around the element and within the same red container as the target element. The boundaries of the container are the red box in which the element is found.
 
  Please provide your answer in the following format:

  <answer>
  selectElement(
    {
      elementName: "${input.elementName}",
      elementPurpose: "${input.elementPurpose}",
      innerText: "${input.innerText}",
      containerText: "${input.containerText}", 
    }
  )
  </answer>
2. gatherThoughts({ observations }): Any information or observation you can collect to help improve the accuracy of your function calls.

The target element is ${input.elementName}
To complete this objective, break it down into a series of steps. For each step:

1. Carefully analyze the screenshots paying close attention to the the element you want to ${input.action}.

2. Gather as much text as you can see within the same red container as the element you want to select.

3. Call selectElement(...) with as much innerText and containerText as possible to complete the task.

Good luck!
`;
const selectElement = {
  type: "function",
  function: {
    name: "selectElement",
    description:
      "Selects the first element matching the element matching a search using text found within the same container or red box as the element you want to select.",
    parameters: {
      type: "object",
      properties: {
        elementName: {
          type: "string",
          description: "A concise name or label to describe the element.",
        },
        elementPurpose: {
          type: "string",
          description:
            "Describe the element's purpose and functionality as it relates it's larger component and to the entire page.",
        },
        innerText: {
          type: "string",
          description: "As much text as can be seen within the element.",
        },
        containerText: {
          type: "string",
          description:
            "As much text as can be seen around the element and within the same red container as the target element. The boundaries of the container are the red box in which the element is found",
        },
        inputText: {
          type: "string",
          description: "The text to type into the input",
        },
      },
      required: ["elementName", "elementPurpose", "innerText", "containerText"],
    },
  },
};
const gatherThoughts = {
  type: "function",
  function: {
    name: "promptUser",
    description:
      "Used this method to collect observations, thoughts or information to help improve the accuracy of your function calls.",
    parameters: {
      type: "object",
      properties: {
        text: {
          type: "string",
          observations:
            "Any information or observation you can collect to help improve the accuracy of your function calls.",
        },
      },
    },
  },
};
const schema = [selectElement, gatherThoughts];
export default function ElementSelector() {
  this.use({
    provider: "openai",
    model: "gpt-4o",
    sdk: openai,
    schema,
    prompt,
    exitConditions: { errors: 1, functionCall: "selectElement" },
    temperature: 0.5,
  });
  this.getherThoughts = ({ observations }) => {
    return observations;
  };
  this.selectElement = async function (searchData, { state }) {
    return searchData;
  };
}

// const testAgent = Agentci().rootAgent(ElementIdentifier);

// testAgent
//   .invoke({
//     message: "Please identify the highlighted elements 1, 2 and 3.",
//     images: [
//       "/Users/odionedwards/autobot/screenshots/1716826912054.png",
//       "/Users/odionedwards/autobot/screenshots/1716826781849.png",
//     ],
//   })
//   .then((r) => console.log("results", r))
//   .catch(console.error);
