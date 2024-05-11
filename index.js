import readline from "readline";
import BrowserAgent from "./agents/Browser/index.js";
const state = { messages: [] };
function startLineReader() {
  const lineReader = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const handleInput = async (input = "") => {
    if (input) {
      try {
        // console.log("state 1:", state);

        const res = await BrowserAgent.invoke(input, state);
        console.log("response", res);
        // console.log("state:", state);
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
