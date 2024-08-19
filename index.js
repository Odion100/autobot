import readline from "readline";
import driver from "./agents/Browser/utils/driver.js";
import BrowserAgent from "./agents/Browser/index.js";
import deleteScreenshots from "./utils/deleteScreenshots.js";
import { stat } from "fs";
const state = { messages: [] };
async function startLineReader() {
  const lineReader = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  await driver.navigate("https://amazon.com");
  // await driver.setContainers();
  // await driver.getScreenShot();
  // const r = await driver.searchPage("search bar");
  // console.log("searchPage", r, r[0].identifiedElements);
  //await driver.updateLabels({ number: 5, label: "Nav bar" }, "containers");
  const handleInput = async (input = "") => {
    if (input.trim() === "abort") {
      state.abort = true;
      return;
    }
    if (input.charAt(0) === ".") {
      const [fn, args] = input.substring(1).split(/:(.*)/);
      console.log(fn, args);
      if (typeof driver[fn] === "function") {
        try {
          const splitArgs = args.split(",").map((s) => s.trim());
          const response = await driver[fn](...splitArgs);
          console.log("response", response);
        } catch (error) {
          console.log("error:", error);
        }
      }
      return;
    }
    if (state.promptUserCallback) {
      state.promptUserCallback(input);
      return;
    }
    if (input) {
      state.abort = false;
      try {
        const response = await BrowserAgent.invoke(input, state);

        console.log("response", response);
      } catch (error) {
        console.log("error output:", error);
      }
    }
    lineReader.prompt();
  };
  lineReader.prompt();
  lineReader.on("line", handleInput);
  lineReader.on("close", () => process.exit(0));
  return lineReader;
}
deleteScreenshots();
startLineReader();
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at --->:", promise, "reason:", reason);
  // Handle the error or exit gracefully
});
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception --->:", error);
  // Perform cleanup, close browser, etc.
  // process.exit(1);
});
// import driver from "./agents/Browser/utils/driver.js";

// async function test() {
//   await driver.navigate("https://upwork.com");
//   await driver.setContainers();
//   await driver.searchContainer(8, "search bar", "typeable");
// }
// test();
