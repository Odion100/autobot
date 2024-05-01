import OpenAI from "openai";
import dotenv from "dotenv";
import driver from "./driver.js";
import Agentci from "agentci";
dotenv.config();
console.log("-->", process.env.OPENAI_API_KEY);
let openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const tools = [
  {
    type: "function",
    function: {
      name: "selectorFound",
      description: "selectorFound the browser to a given URL",
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
      name: "getVisualContext",
      description: "getVisualContext on the first element matching a CSS selector",
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
      name: "getUserInput",
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
      description:
        "Find the css selector for based on a natural language description of the element",
      parameters: {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description:
              "natural-language description of the element for which you want to find a selector",
          },
        },
      },
    },
  },
];
const prompt = `
You are an AI assistant capable of searching a web page through the following function calls:

selectorFound(css_selector): selectorFounds to the given URL.
getVisualContext(): Clicks on the first element matching the given CSS selector.
getUserInput(question): Types the given text into the first element matching the CSS selector.
searchHTML(selector): Find the css selector for based on a natural language description of the element.

You will be given html and and a description of which element the user is trying to select. Once you've found
found the element call selectorFound to return the css selector to the user. For example, you could selectorFound to a website, enter text into a search box, click a button, and retrieve the results.

Your task is to provide step-by-step instructions of which functions to for call given the task.`;

const userAgent = Agentci().rootAgent(function () {
  this.use({
    provider: "openai",
    model: "gpt-3.5-turbo-0125",
    sdk: openai,
    schema: tools,
    prompt,
    exitConditions: { iterations: 2 },
  });
  Object.assign(this, driver);
});

const args = process.argv.slice(2);

// Check if an argument was provided
if (args.length === 0) {
  console.log("Please provide a string argument");
  process.exit(1);
}
const inputString = args.join(" ");
userAgent.invoke(inputString).then(console.log).catch(console.error);
