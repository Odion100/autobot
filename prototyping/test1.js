import OpenAI from "openai";
import dotenv from "dotenv";
import driver from "./driver.js";
import Agentci from "agentci";
console.log("Agentci", Agentci);
dotenv.config();
console.log("-->", process.env.OPENAI_API_KEY);

let openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
function navigate(...args) {
  console.log("args--->", args);
}

// Get the command-line arguments
const args = process.argv.slice(2);

// Check if an argument was provided
if (args.length === 0) {
  console.log("Please provide a string argument");
  process.exit(1);
}

// Get the first argument as the input string
const inputString = args.join(" ");

console.log(`You entered: ${inputString}`);

async function runConversation() {
  // Step 1: send the conversation and available functions to the model
  const messages = [
    {
      role: "user",
      content: "Go to amazon.com",
    },
  ];

  const tools = [
    {
      type: "function",
      function: {
        name: "navigate",
        description: "Navigate the browser to a given URL",
        parameters: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "The full URL to a web page",
            },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "click",
        description: "Click on the first element matching a CSS selector",
        parameters: {
          type: "object",
          properties: {
            selector: {
              type: "string",
              description: "The CSS selector for the element to click",
            },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "typeToInput",
        description: "Type text into the first element matching a CSS selector",
        parameters: {
          type: "object",
          properties: {
            selector: {
              type: "string",
              description: "The CSS selector for the input element",
            },
            text: {
              type: "string",
              description: "The text to type into the input element",
            },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "searchHTML",
        description: "Get the text content of the first element matching a CSS selector",
        parameters: {
          type: "object",
          properties: {
            selector: {
              type: "string",
              description: "The CSS selector for the element",
            },
          },
        },
      },
    },
  ];

  const response = await openai.chat.completions.create({
    model: "gpt-3.5-turbo-0125",
    messages: [
      {
        role: "system",
        content: `
          You are an AI assistant capable of controlling a web browser through the following function calls:

          navigate(url): Navigates to the given URL.
          click(selector): Clicks on the first element matching the given CSS selector.
          typeToInput(selector, text): Types the given text into the first element matching the CSS selector.
          searchHTML(selector): Returns the text content of the first element matching the CSS selector.

          You can use these methods to automate web browsing tasks. For example, you could navigate to a website, enter text into a search box, click a button, and retrieve the results.

          Your task is to provide step-by-step instructions of which functions to for call given the task.`,
      },
      {
        role: "user",
        content: inputString,
      },
    ],
    tools: tools,
    tool_choice: "auto", // auto is default, but we'll be explicit
  });
  const responseMessage = response.choices[0].message;
  console.log("responseMessage--->", responseMessage, responseMessage.tool_calls);
  // Step 2: check if the model wanted to call a function
  const toolCalls = responseMessage.tool_calls;
  if (toolCalls) {
    messages.push(responseMessage); // extend conversation with assistant's reply
    for (const toolCall of toolCalls) {
      const fn = toolCall.function.name;

      if (driver[fn]) {
        const args = JSON.parse(toolCall.function.arguments);
        const functionResponse = await driver[fn](args);
        console.log("functionResponse:", functionResponse);
        messages.push({
          tool_call_id: toolCall.id,
          role: "tool",
          name: fn,
          content: functionResponse,
        });
      }
      // extend conversation with function response
    }
    // const secondResponse = await openai.chat.completions.create({
    //   model: "gpt-3.5-turbo-0125",
    //   messages: messages,
    // }); // get a new response from the model where it can see the function response
    // console.log("secondResponse--->", secondResponse);

    //return secondResponse.choices;
  }
}

runConversation().then(console.log).catch(console.error);
