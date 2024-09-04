import driver from "../driver/index.js";
import { wait } from "../utils/index.js";
import { EXECUTION_REMINDER } from "../constants.js";
import { setDomainMemoryPrompt } from "./setDomainMemoryPrompt.js";
import { getDomainMemory } from "./getDomainMemory.js";

export async function awaitNavigation({ state }, next) {
  console.log("state.navigationStarted", state.navigationStarted);
  if (state.navigationStarted) {
    while (state.navigationStarted) {
      console.log("waiting for page to load...");
      await wait(500);
    }
    await new Promise((resolve) => getDomainMemory({ state }, resolve));
    await new Promise((resolve) => setDomainMemoryPrompt({ state }, resolve));
    console.log("page load is now complete");
    if (!state.skipContainerSetup) await driver.setContainers();
    state.screenshot_message = `This is an image of the page you have just navigated to. ${EXECUTION_REMINDER}`;
    next();
  } else next();
}
