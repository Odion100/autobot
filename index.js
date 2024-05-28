import readline from "readline";
import driver from "./agents/Browser/utils/driver.js";
import BrowserAgent from "./agents/Browser/index.js";
import deleteScreenshots from "./utils/deleteScreenshots.js";
const state = { messages: [] };
async function startLineReader() {
  const lineReader = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  // await driver.navigate("https://amazon.com");
  // await driver.setContainers();
  // await driver.getScreenShot();
  // const r = await driver.searchPage("search bar");
  // console.log("searchPage", r, r[0].identifiedElements);
  //await driver.updateLabels({ number: 5, label: "Nav bar" }, "containers");
  const handleInput = async (input = "") => {
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
    if (input) {
      try {
        const response = await BrowserAgent.invoke(input, state);
        console.log("response", response);
      } catch (error) {
        console.log("error:", error);
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
// import driver from "./agents/Browser/utils/driver.js";

// async function test() {
//   await driver.navigate("https://upwork.com");
//   await driver.setContainers();
//   await driver.searchContainer(8, "search bar", "typeable");
// }
// test();
