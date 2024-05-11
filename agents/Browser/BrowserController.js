import OpenAI from "openai";
import prompt from "./prompts/BrowserController.js";
import schema from "./schemas/BrowserController.js";
import driver from "./utils/driver.js";
import dotenv from "dotenv";
dotenv.config();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
/// -- to launch
// - update insert image middleware to responded to state
// - allowing any agent to add an image and message in the loop
// for example after ever navigate call we can insert an image
// - maybe add prompt the model to add more description when calling findAnd... methods
// - update the nls prompt to say "bullets: -
// *You can select items on the page by call searchContain.
// * You can confirm that the correct item is selected by calling elementSelected"
export default function BrowserController() {
  this.use({
    provider: "openai",
    model: "gpt-4-turbo",
    sdk: openai,
    schema,
    prompt,
    state: { driver },
    exitConditions: { shortCircuit: true, functionCall: "promptUser" },
    agents: ["NaturalLanguageSelector"],
  });

  this.click = driver.click;
  this.type = driver.type;
  this.getText = driver.getInnerText;
  this.navigate = async function ({ url }) {
    return await driver.navigate(url);
  };
  this.findAndType = async function ({ description, text }, { agents }) {
    const { NaturalLanguageSelector } = agents;
    const selector = await NaturalLanguageSelector.invoke(description, {
      elementType: "typeable",
    });
    return await driver.type(undefined, text);
  };
  this.findAndClick = async function ({ description, text }, { agents }) {
    const { NaturalLanguageSelector } = agents;
    const selector = await NaturalLanguageSelector.invoke(description, {
      elementType: "clickable",
    });
    return await driver.click();
  };
  this.findAndSelect = async function ({ description }, { agents }) {
    const { NaturalLanguageSelector } = agents;
    await NaturalLanguageSelector.invoke(description);
  };
  this.findContent = async function ({ description }, { agents }) {
    const { NaturalLanguageSelector } = agents;
    const selectors = await NaturalLanguageSelector.invoke(description);
    return await driver.getInnerText(selectors);
  };
  this.promptUser = async function ({ text }, { state }) {
    state.userPrompt = text;
    return text;
  };
  // this.after("$invoke", function (state, next) {
  //   // driver.clearContainers();
  //   // driver.clearSelection();
  //   next();
  // });
}
