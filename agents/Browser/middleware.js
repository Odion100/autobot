import imageEncoder from "agentci/agentci/utils/imageEncoder.mjs";
import driver from "./utils/driver.js";

export async function insertScreenshot({ state, input, fn }, next) {
  const encodedImage = imageEncoder(await driver.getScreenShot());
  const message =
    fn === "searchContainer"
      ? "Please confirm if the correct item was selected."
      : `Please continue searching for the ${input.message}`;
  state.messages.push({
    role: "user",
    content: [
      { type: "text", text: message },
      { type: "image_url", image_url: { url: encodedImage } },
    ],
  });
  next();
}
