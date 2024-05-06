import imageEncoder from "agentci/agentci/utils/imageEncoder.mjs";
import driver from "./utils/driver";

export async function insertScreenshot({ state, input }, next) {
  const encodedImage = imageEncoder(await driver.getScreenShot());

  state.messages.push({
    role: "user",
    content: [
      { type: "text", text: input.message },
      { type: "image_url", image_url: { url: encodedImage } },
    ],
  });
  next();
}
