import OpenAI from "openai";
import schema from "./schema";
import driver from "./driver";
import prompt from "./prompt";
import dotenv from "dotenv";
dotenv.config();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// browser driver should return a state after each function call
// the state includes
// what page
// what container or item is selected
// a list of actions taken in the browser: previousActions:['']

// I need to create a completely separate browser agent that
// This browser agent is for working with the user step by step
// it can take commands select containers which will be highlighted in green
// it and also select an item in the container
// and then take command to click or type or retrieve data into/from the selection.
// while doing this it is learning each for a site

export default function BrowserAgent() {
  this.use({
    provider: "openai",
    model: "gpt-3.5-turbo-0125",
    sdk: openai,
    schema,
    prompt,
    exitConditions: { iterations: 2, functionCall: "finished" },
    agents: ["HtmlParser"],
  });
  this.navigate = driver.navigate;
  this.findAndType = driver.findAndType;
  this.findAndClick = driver.findAndClick;
  this.searchHTML = driver.searchHTML;
  this.searchContent = driver.searchContent;
  // Object.assign(this, driver); re
}
