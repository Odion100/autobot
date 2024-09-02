import imageEncoder from "agentci/agentci/utils/imageEncoder.mjs";
import driver from "../driver/index.js";

export async function insertScreenshot({ state }, next) {
  console.log("screenshot-->", state.screenshot_message);
  if (state.screenshot_message) {
    const screenshot = await driver.getScreenshot();
    const encodedImage = imageEncoder(screenshot);
    const message = state.screenshot_message;
    console.log("adding screen shot --->", message, screenshot);
    state.messages.push({
      role: "user",
      content: [
        { type: "text", text: message },
        { type: "image_url", image_url: { url: encodedImage } },
      ],
    });
    console.log("insertscreenshot state.messages", state.messages);
    state.screenshot_message = undefined;
  }
  next();
}
