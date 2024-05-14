import readline from "readline";
import driver from "./agents/Browser/utils/driver.js";
const state = { messages: [] };
function startLineReader() {
  const lineReader = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const handleInput = async (input = "") => {
    const [fn, args] = input.split(/:(.+)/);

    if (typeof driver[fn] === "function") {
      try {
        const splitArgs = args.split(",").map((s) => s.trim());
        const response = await driver[fn](...splitArgs);
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

startLineReader();

// import driver from "./agents/Browser/utils/driver.js";

// async function test() {
//   await driver.navigate("https://upwork.com");
//   await driver.setContainers();
//   await driver.searchContainer(8, "search bar", "typeable");
// }
// test();
