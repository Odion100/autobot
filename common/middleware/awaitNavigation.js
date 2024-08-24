import driver from "../driver/index.js";
import { getDomainMemory, domainMemory } from "./utils/index.js";
import { wait } from "../utils/index.js";

export async function awaitNavigation({ state, agents }, next) {
  // console.log("state.navigationStarted", state.navigationStarted);
  if (state.navigationStarted) {
    while (state.navigationStarted) {
      console.log("waiting for page to load...");
      await wait(500);
    }
    console.log("page load is now complete");
    await Promise.all([getDomainMemory({ state }), driver.setContainers()]);
    state.screenshot = await driver.getScreenshot();
    state.screenshot_message = `This is an image of the page you have just navigated to. ${executionReminder} ${await domainMemory(
      state
    )}`;

    next();
  } else next();
}
