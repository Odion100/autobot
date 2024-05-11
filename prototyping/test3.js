import fs from "fs";
import dotenv from "dotenv";
dotenv.config();
import OpenAI from "openai";
import Agentci from "agentci";
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function processImageRequest(filePath) {
  const imageBuffer = fs.readFileSync(filePath);
  const base64Image = imageBuffer.toString("base64");
  const encodedImage = `data:image/jpeg;base64,{${base64Image}}`;

  const response = await openai.chat.completions.create({
    model: "gpt-4-vision-preview",
    messages: [
      {
        role: "system",
        content: `
              You are an AI browser assistant. Your job is to receive a screenshot of the webpage and identify a box number or numbers for an item or items the user is looking for on the page.
                
              `,
      },
      {
        role: "user",
        content: [
          { type: "text", text: "Which boxes container search results or listings" },
          { type: "image_url", image_url: { url: encodedImage } },
        ],
      },
    ],
    max_tokens: 1024,
  });
  console.log("response->", response);
  const responseMessage = response.choices[0].message;
  return responseMessage;
}
// processImageRequest(`${process.cwd()}/prototyping/test2.png`)
//   .then(console.log)
//   .catch(console.error);

const root = Agentci().agent("test", function BrowserAgent() {
  this.use({
    provider: "openai",
    model: "gpt-4-vision-preview",
    sdk: openai,
    prompt:
      "You are an AI browser assistant. Your job is to receive a screenshot of the webpage and identify a box number or numbers for an item or items the user is looking for on the page.",
    exitConditions: { iterations: 2 },
    agents: ["HtmlParser"],
  });

  // Object.assign(this, driver); re
});
console.log(root, root);
function test(filePath) {
  return root.invoke({
    message: "Which boxes container search results or listings",
    image: filePath,
  });
}
test(`${process.cwd()}/screenshots/1715221824956.png`)
  .then(console.log)
  .catch(console.error);
