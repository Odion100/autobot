import imageEncoder from "agentci/agentci/utils/imageEncoder.mjs";

export async function insertScreenshot({ state }, next) {
  if (state.screenshot) {
    const encodedImage = imageEncoder(state.screenshot);
    const message = state.screenshot_message;
    console.log("adding screen shot --->", message, state.screenshot);
    state.messages.push({
      role: "user",
      content: [
        { type: "text", text: message },
        { type: "image_url", image_url: { url: encodedImage } },
      ],
    });
    state.screenshot = undefined;
    state.screenshot_message = undefined;
  }
  next();
}
