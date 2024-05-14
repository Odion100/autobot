import OpenAI from "openai";
import schema from "./schemas/ElementSelector.js";
import prompt from "./prompts/ElementSelector.js";
import dotenv from "dotenv";
dotenv.config();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default function ElementSelector() {
  this.use({
    provider: "openai",
    model: "gpt-4-turbo",
    sdk: openai,
    schema,
    prompt,
    exitConditions: { functionCall: ["yes", "no"], errors: 1 },
    temperature: 0.5,
  });

  this.yes = async function ({ certainty }) {
    return { elementFound: true, certainty };
  };

  this.no = function () {
    return { elementFound: false };
  };
}
